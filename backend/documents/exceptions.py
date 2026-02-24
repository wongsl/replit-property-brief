from rest_framework.views import exception_handler
from rest_framework.response import Response


def custom_exception_handler(exc, context):
    """Normalize all DRF exception responses to { "error": "...", "requestId": "..." }."""
    response = exception_handler(exc, context)

    if response is None:
        return None

    request = context.get("request")
    request_id = request.META.get("HTTP_X_REQUEST_ID", "-") if request else "-"

    data = response.data
    if isinstance(data, dict) and "detail" in data:
        error_message = str(data["detail"])
    elif isinstance(data, dict):
        parts = []
        for field, messages in data.items():
            if isinstance(messages, list):
                parts.append(f"{field}: {', '.join(str(m) for m in messages)}")
            else:
                parts.append(f"{field}: {messages}")
        error_message = "; ".join(parts)
    elif isinstance(data, list):
        error_message = "; ".join(str(m) for m in data)
    else:
        error_message = str(data)

    response.data = {"error": error_message, "requestId": request_id}
    return response
