import time
import logging

logger = logging.getLogger("api")


class RequestLoggingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.monotonic()
        request_id = request.META.get("HTTP_X_REQUEST_ID", "-")

        response = self.get_response(request)

        duration_ms = int((time.monotonic() - start) * 1000)
        user_id = request.session.get("user_id", "-") if hasattr(request, "session") else "-"

        logger.info(
            "[%s] %s %s %d %dms user=%s",
            request_id,
            request.method,
            request.path,
            response.status_code,
            duration_ms,
            user_id,
        )

        return response
