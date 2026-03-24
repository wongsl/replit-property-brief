import json
import re
import time
import logging

logger = logging.getLogger("api")

# Built-in LogRecord attributes to exclude from the JSON output
_LOG_RECORD_BUILTINS = frozenset({
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "taskName",
})


class JsonFormatter(logging.Formatter):
    def format(self, record):
        record.message = record.getMessage()
        data = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "source": "django",
        }
        for key, value in record.__dict__.items():
            if key not in _LOG_RECORD_BUILTINS:
                data[key] = value
        if record.exc_info:
            data["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(data)


_UUID_RE = re.compile(r'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I)
_ID_RE = re.compile(r'/\d+')


def path_to_event(path: str) -> str:
    """Derive a log event name from a URL path, e.g. /api/auth/reset-password/ → auth_reset_password."""
    path = _UUID_RE.sub('', path)
    path = _ID_RE.sub('', path)
    path = re.sub(r'^/api/', '', path).rstrip('/')
    path = re.sub(r'[-/]', '_', path)
    return path or 'unknown'


class RequestLoggingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.monotonic()
        request_id = request.META.get("HTTP_X_REQUEST_ID", "-")

        response = self.get_response(request)

        duration_ms = int((time.monotonic() - start) * 1000)
        user_id = request.session.get("user_id", "-") if hasattr(request, "session") else "-"
        username = getattr(request.user, "username", "-") if hasattr(request, "user") and request.user.is_authenticated else "-"

        logger.info(
            "request",
            extra={
                "event": path_to_event(request.path),
                "request_id": request_id,
                "method": request.method,
                "path": request.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "user_id": user_id,
                "username": username,
            },
        )

        return response
