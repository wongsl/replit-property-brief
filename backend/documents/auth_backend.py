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
