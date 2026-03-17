from rest_framework.permissions import BasePermission


class IsAdmin(BasePermission):
    """Allow access only to users with role == 'admin'."""
    message = "Admin only"

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.role == "admin"
        )


class IsAdminOrTeamLeader(BasePermission):
    """Allow access to admins and team leaders."""
    message = "Team leader or admin only"

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.role in ("admin", "team_leader")
        )
