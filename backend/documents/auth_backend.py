import jwt
import requests
from jwt.algorithms import RSAAlgorithm
from django.conf import settings
from django.core.cache import cache
from rest_framework.authentication import BaseAuthentication
from django.contrib.auth import get_user_model

User = get_user_model()


class SessionAuthentication(BaseAuthentication):
    def authenticate(self, request):
        user_id = request.session.get('user_id')
        if not user_id:
            return None
        try:
            user = User.objects.select_related('team').get(pk=user_id)
            return (user, None)
        except User.DoesNotExist:
            return None


import logging as _logging
_logger = _logging.getLogger("api")

def verify_clerk_token(token: str) -> dict | None:
    """Verify a Clerk-issued JWT and return the decoded payload, or None if invalid."""
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get('kid')
        _logger.debug("clerk_token_header", extra={"kid": kid, "header": header})
    except Exception as e:
        _logger.warning("clerk_token_header_error", extra={"error": str(e)})
        return None

    cache_key = f'clerk_jwk_{kid}'
    cached_jwk = cache.get(cache_key)

    if cached_jwk:
        public_key = RSAAlgorithm.from_jwk(cached_jwk)
    else:
        public_key = None
        try:
            jwks = requests.get(settings.CLERK_JWKS_URL, timeout=5).json()
            available_kids = [k.get('kid') for k in jwks.get('keys', [])]
            _logger.debug("clerk_jwks_fetched", extra={"jwks_url": settings.CLERK_JWKS_URL, "available_kids": available_kids, "looking_for": kid})
            for key_data in jwks.get('keys', []):
                if key_data.get('kid') == kid:
                    import json as _json
                    cache.set(cache_key, _json.dumps(key_data), 3600)
                    public_key = RSAAlgorithm.from_jwk(key_data)
                    break
        except Exception as e:
            _logger.warning("clerk_jwks_fetch_error", extra={"error": str(e)})
            return None

    if not public_key:
        _logger.warning("clerk_public_key_not_found", extra={"kid": kid})
        return None

    try:
        payload = jwt.decode(token, public_key, algorithms=['RS256'], options={"verify_aud": False})
        _logger.debug("clerk_token_verified", extra={"sub": payload.get("sub")})
        return payload
    except jwt.InvalidTokenError as e:
        _logger.warning("clerk_token_invalid", extra={"error": str(e)})
        return None
