"""
Comprehensive tests for the documents Django app.
Covers: auth views, folder views, document views, team views, admin views,
        credit views, combined analysis, permissions, cache utils,
        middleware, exception handler, share feature, and share-with-user feature.
"""
import uuid
import logging
from django.test import TestCase, RequestFactory
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework.exceptions import AuthenticationFailed

from .models import (
    User, Team, Folder, Document, Tag, TeamJoinRequest,
    AdminRequest, CreditRequest, CreditTransaction, CombinedAnalysis,
    DocumentPermission,
)
from .permissions import IsAdmin, IsAdminOrTeamLeader
from .cache_utils import (
    _docs_key, _folders_key, _teams_key, _user_key, _admin_users_key, _shared_key,
    get_cached, set_cached, invalidate_docs, invalidate_folders,
    invalidate_user, invalidate_teams, invalidate_all_for_user,
)
from .middleware import RequestLoggingMiddleware
from .exceptions import custom_exception_handler
from .auth_backend import SessionAuthentication


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_user(username="user", password="pass123", role="user", team=None):
    return User.objects.create(
        username=username,
        password=make_password(password),
        email=f"{username}@test.com",
        role=role,
        team=team,
        credits=40,
    )


def make_doc(owner, name="test.pdf", ai_analysis=None, folder=None):
    return Document.objects.create(name=name, owner=owner, ai_analysis=ai_analysis, folder=folder)


def make_folder(owner, name="Folder", parent=None):
    return Folder.objects.create(name=name, owner=owner, parent=parent)


SAMPLE_ANALYSIS = {
    "addressNumber": "123",
    "streetName": "Main",
    "suffix": "St",
    "city": "Springfield",
    "county": "Shelby",
    "zipcode": "12345",
    "document_type": "Home Inspection Report",
    "inspection_date": "2026-01-01",
    "summary": {
        "Roof": {"condition": "Good", "issues": [], "age": "5 years", "recommendation": "None"},
        "Electrical": {"condition": "Fair", "issues": ["Old panel"], "recommendation": "Upgrade"},
    },
}


# ===========================================================================
# Cache Utils Tests
# ===========================================================================

class CacheKeyTests(TestCase):
    def test_docs_key_mine(self):
        self.assertEqual(_docs_key(1, "mine"), "docs:1:mine")

    def test_docs_key_team(self):
        self.assertEqual(_docs_key(1, "team", team_id=5), "docs:team:5")

    def test_docs_key_team_without_team_id_falls_back_to_mine(self):
        self.assertEqual(_docs_key(1, "team"), "docs:1:mine")

    def test_folders_key_active(self):
        self.assertEqual(_folders_key(7), "folders:7:active")

    def test_folders_key_active_explicit(self):
        self.assertEqual(_folders_key(7, archived=False), "folders:7:active")

    def test_folders_key_archived(self):
        self.assertEqual(_folders_key(7, archived=True), "folders:7:archived")

    def test_folders_key_different_users(self):
        self.assertNotEqual(_folders_key(1), _folders_key(2))

    def test_folders_key_archived_differs_from_active(self):
        self.assertNotEqual(_folders_key(1, archived=True), _folders_key(1, archived=False))

    def test_teams_key(self):
        self.assertEqual(_teams_key(), "teams:all")

    def test_user_key(self):
        self.assertEqual(_user_key(42), "user:42")

    def test_admin_users_key(self):
        self.assertEqual(_admin_users_key(), "admin:users")

    def test_shared_key(self):
        self.assertEqual(_shared_key(99), "shared:99")

    def test_shared_key_different_users(self):
        self.assertNotEqual(_shared_key(1), _shared_key(2))


class CacheGetSetTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_get_cached_miss_returns_none(self):
        self.assertIsNone(get_cached("nonexistent"))

    def test_set_and_get_cached(self):
        set_cached("mykey", {"value": 1})
        self.assertEqual(get_cached("mykey"), {"value": 1})

    def test_invalidate_docs_clears_mine_key(self):
        set_cached(_docs_key(1, "mine"), [{"id": 1}])
        invalidate_docs(1)
        self.assertIsNone(get_cached(_docs_key(1, "mine")))

    def test_invalidate_docs_clears_team_key(self):
        set_cached(_docs_key(1, "team", 5), [{"id": 1}])
        invalidate_docs(1, team_id=5)
        self.assertIsNone(get_cached(_docs_key(1, "team", 5)))

    def test_invalidate_folders_clears_active_key(self):
        set_cached(_folders_key(1, archived=False), [{"id": 1}])
        invalidate_folders(1)
        self.assertIsNone(get_cached(_folders_key(1, archived=False)))

    def test_invalidate_folders_clears_archived_key(self):
        set_cached(_folders_key(1, archived=True), [{"id": 10}])
        invalidate_folders(1)
        self.assertIsNone(get_cached(_folders_key(1, archived=True)))

    def test_invalidate_folders_clears_both_keys(self):
        set_cached(_folders_key(1, archived=False), [{"id": 1}])
        set_cached(_folders_key(1, archived=True), [{"id": 2}])
        invalidate_folders(1)
        self.assertIsNone(get_cached(_folders_key(1, archived=False)))
        self.assertIsNone(get_cached(_folders_key(1, archived=True)))

    def test_invalidate_user(self):
        set_cached(_user_key(1), {"id": 1})
        set_cached(_admin_users_key(), [{"id": 1}])
        invalidate_user(1)
        self.assertIsNone(get_cached(_user_key(1)))
        self.assertIsNone(get_cached(_admin_users_key()))

    def test_invalidate_teams(self):
        set_cached(_teams_key(), [])
        invalidate_teams()
        self.assertIsNone(get_cached(_teams_key()))

    def test_invalidate_all_for_user(self):
        set_cached(_docs_key(1, "mine"), [])
        set_cached(_folders_key(1), [])
        set_cached(_user_key(1), {})
        invalidate_all_for_user(1)
        self.assertIsNone(get_cached(_docs_key(1, "mine")))
        self.assertIsNone(get_cached(_folders_key(1)))
        self.assertIsNone(get_cached(_user_key(1)))


# ===========================================================================
# Permissions Tests
# ===========================================================================

class PermissionsTests(TestCase):
    def _make_request(self, user):
        factory = RequestFactory()
        req = factory.get("/")
        req.user = user
        return req

    def test_is_admin_allows_admin_user(self):
        user = make_user("admin1", role="admin")
        perm = IsAdmin()
        self.assertTrue(perm.has_permission(self._make_request(user), None))

    def test_is_admin_denies_regular_user(self):
        user = make_user("user1", role="user")
        perm = IsAdmin()
        self.assertFalse(perm.has_permission(self._make_request(user), None))

    def test_is_admin_denies_team_leader(self):
        user = make_user("lead1", role="team_leader")
        perm = IsAdmin()
        self.assertFalse(perm.has_permission(self._make_request(user), None))

    def test_is_admin_denies_viewer(self):
        user = make_user("viewer1", role="viewer")
        perm = IsAdmin()
        self.assertFalse(perm.has_permission(self._make_request(user), None))

    def test_is_admin_or_team_leader_allows_admin(self):
        user = make_user("admin2", role="admin")
        perm = IsAdminOrTeamLeader()
        self.assertTrue(perm.has_permission(self._make_request(user), None))

    def test_is_admin_or_team_leader_allows_team_leader(self):
        user = make_user("lead2", role="team_leader")
        perm = IsAdminOrTeamLeader()
        self.assertTrue(perm.has_permission(self._make_request(user), None))

    def test_is_admin_or_team_leader_denies_viewer(self):
        user = make_user("viewer2", role="viewer")
        perm = IsAdminOrTeamLeader()
        self.assertFalse(perm.has_permission(self._make_request(user), None))

    def test_is_admin_or_team_leader_denies_regular_user(self):
        user = make_user("user2", role="user")
        perm = IsAdminOrTeamLeader()
        self.assertFalse(perm.has_permission(self._make_request(user), None))


# ===========================================================================
# Middleware Tests
# ===========================================================================

class MiddlewareTests(TestCase):
    def test_middleware_passes_response_through(self):
        from django.http import HttpResponse

        def get_response(request):
            return HttpResponse("ok", status=200)

        mw = RequestLoggingMiddleware(get_response)
        factory = RequestFactory()
        req = factory.get("/test/")
        req.session = {}
        response = mw(req)
        self.assertEqual(response.status_code, 200)

    def test_middleware_logs_request_id(self):
        from django.http import HttpResponse

        def get_response(request):
            return HttpResponse("ok", status=201)

        mw = RequestLoggingMiddleware(get_response)
        factory = RequestFactory()
        req = factory.get("/api/test/")
        req.META["HTTP_X_REQUEST_ID"] = "req-123"
        req.session = {}

        with self.assertLogs("api", level="INFO") as cm:
            mw(req)

        self.assertTrue(any("req-123" in msg for msg in cm.output))
        self.assertTrue(any("201" in msg for msg in cm.output))

    def test_middleware_uses_dash_when_no_request_id(self):
        from django.http import HttpResponse

        def get_response(request):
            return HttpResponse("ok")

        mw = RequestLoggingMiddleware(get_response)
        factory = RequestFactory()
        req = factory.get("/")
        req.session = {}

        with self.assertLogs("api", level="INFO") as cm:
            mw(req)

        self.assertTrue(any("[-]" in msg for msg in cm.output))


# ===========================================================================
# Exception Handler Tests
# ===========================================================================

class ExceptionHandlerTests(TestCase):
    def _make_context(self, request_id=None):
        factory = RequestFactory()
        req = factory.get("/")
        if request_id:
            req.META["HTTP_X_REQUEST_ID"] = request_id
        return {"request": req}

    def test_returns_none_for_non_drf_exception(self):
        result = custom_exception_handler(ValueError("boom"), self._make_context())
        self.assertIsNone(result)

    def test_normalizes_detail_error(self):
        from rest_framework.exceptions import NotFound
        exc = NotFound("Resource not found")
        result = custom_exception_handler(exc, self._make_context())
        self.assertIsNotNone(result)
        self.assertEqual(result.data["error"], "Resource not found")

    def test_includes_request_id(self):
        from rest_framework.exceptions import PermissionDenied
        exc = PermissionDenied("No access")
        result = custom_exception_handler(exc, self._make_context(request_id="abc-123"))
        self.assertEqual(result.data["requestId"], "abc-123")

    def test_uses_dash_when_no_request_id(self):
        from rest_framework.exceptions import NotFound
        exc = NotFound()
        result = custom_exception_handler(exc, self._make_context())
        self.assertEqual(result.data["requestId"], "-")


# ===========================================================================
# Auth Backend Tests
# ===========================================================================

class AuthBackendTests(TestCase):
    def test_authenticate_with_valid_session(self):
        user = make_user("sessuser")
        backend = SessionAuthentication()
        factory = RequestFactory()
        req = factory.get("/")
        req.session = {"user_id": user.id}
        result_user, _ = backend.authenticate(req)
        self.assertEqual(result_user.id, user.id)

    def test_authenticate_returns_none_without_session(self):
        backend = SessionAuthentication()
        factory = RequestFactory()
        req = factory.get("/")
        req.session = {}
        result = backend.authenticate(req)
        self.assertIsNone(result)

    def test_authenticate_returns_none_for_nonexistent_user(self):
        backend = SessionAuthentication()
        factory = RequestFactory()
        req = factory.get("/")
        req.session = {"user_id": 99999}
        result = backend.authenticate(req)
        self.assertIsNone(result)


# ===========================================================================
# Auth View Tests
# ===========================================================================

class RegisterTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_register_creates_user(self):
        res = self.client.post("/api/auth/register/", {"username": "newuser", "password": "pass123", "email": "new@test.com"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["username"], "newuser")

    def test_register_sets_default_40_credits(self):
        res = self.client.post("/api/auth/register/", {"username": "credits_user", "password": "pass123", "email": "c@test.com"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["credits"], 40)

    def test_register_fails_without_username(self):
        res = self.client.post("/api/auth/register/", {"password": "pass123", "email": "x@test.com"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("error", res.data)

    def test_register_fails_without_email(self):
        res = self.client.post("/api/auth/register/", {"username": "u", "password": "pass123"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_register_fails_duplicate_username(self):
        make_user("existing")
        res = self.client.post("/api/auth/register/", {"username": "existing", "password": "pass123", "email": "e@test.com"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Username taken", res.data["error"])

    def test_register_fails_duplicate_email(self):
        make_user("u1")
        res = self.client.post("/api/auth/register/", {"username": "u2", "password": "pass123", "email": "u1@test.com"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("email", res.data["error"].lower())


class LoginTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("loginuser", password="pass123")

    def test_login_success(self):
        res = self.client.post("/api/auth/login/", {"username": "loginuser", "password": "pass123"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["username"], "loginuser")

    def test_login_wrong_password(self):
        res = self.client.post("/api/auth/login/", {"username": "loginuser", "password": "wrong"}, format="json")
        self.assertEqual(res.status_code, 401)

    def test_login_unknown_user(self):
        res = self.client.post("/api/auth/login/", {"username": "nobody", "password": "pass"}, format="json")
        self.assertEqual(res.status_code, 401)


class LogoutTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("logoutuser")
        self.client.force_authenticate(user=self.user)

    def test_logout_succeeds(self):
        res = self.client.post("/api/auth/logout/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("Logged out", res.data["message"])


class MeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("meuser")
        self.client.force_authenticate(user=self.user)
        cache.clear()

    def test_me_returns_current_user(self):
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["username"], "meuser")

    def test_me_requires_auth(self):
        unauthed = APIClient()
        res = unauthed.get("/api/auth/me/")
        self.assertEqual(res.status_code, 403)

    def test_me_uses_cache_on_second_call(self):
        self.client.get("/api/auth/me/")
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["id"], self.user.id)


class ChangePasswordTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("cpuser", password="oldpass")
        self.client.force_authenticate(user=self.user)

    def test_change_password_success(self):
        res = self.client.post("/api/auth/change-password/", {"current_password": "oldpass", "new_password": "newpass123"}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_change_password_wrong_current(self):
        res = self.client.post("/api/auth/change-password/", {"current_password": "wrong", "new_password": "newpass123"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("incorrect", res.data["error"])

    def test_change_password_too_short(self):
        res = self.client.post("/api/auth/change-password/", {"current_password": "oldpass", "new_password": "abc"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("6 characters", res.data["error"])

    def test_change_password_missing_fields(self):
        res = self.client.post("/api/auth/change-password/", {}, format="json")
        self.assertEqual(res.status_code, 400)


# ===========================================================================
# Folder Tests
# ===========================================================================

class FolderCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("folderuser")
        self.client.force_authenticate(user=self.user)
        cache.clear()

    def test_create_folder(self):
        res = self.client.post("/api/folders/", {"name": "My Folder"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["name"], "My Folder")

    def test_list_folders_returns_only_own(self):
        other = make_user("other_folder_user")
        make_folder(other, "Other's Folder")
        make_folder(self.user, "My Folder")
        res = self.client.get("/api/folders/")
        self.assertEqual(res.status_code, 200)
        names = [f["name"] for f in res.data]
        self.assertIn("My Folder", names)
        self.assertNotIn("Other's Folder", names)

    def test_delete_folder(self):
        folder = make_folder(self.user, "ToDelete")
        res = self.client.delete(f"/api/folders/{folder.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Folder.objects.filter(pk=folder.id).exists())

    def test_cannot_set_circular_parent(self):
        parent = make_folder(self.user, "Parent")
        child = make_folder(self.user, "Child", parent=parent)
        res = self.client.patch(f"/api/folders/{parent.id}/", {"parent": child.id}, format="json")
        self.assertIn(res.status_code, [400, 422])

    def test_folder_reorder(self):
        f1 = make_folder(self.user, "F1")
        f2 = make_folder(self.user, "F2")
        res = self.client.post("/api/folders/reorder/", {"order": [f2.id, f1.id]}, format="json")
        self.assertEqual(res.status_code, 200)
        f2.refresh_from_db()
        f1.refresh_from_db()
        self.assertEqual(f2.position, 0)
        self.assertEqual(f1.position, 1)

    def test_archive_folder(self):
        folder = make_folder(self.user, "ToArchive")
        res = self.client.post(f"/api/folders/{folder.id}/toggle_archive/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["is_archived"])
        folder.refresh_from_db()
        self.assertTrue(folder.is_archived)

    def test_unarchive_folder(self):
        folder = make_folder(self.user, "AlreadyArchived")
        folder.is_archived = True
        folder.save()
        res = self.client.post(f"/api/folders/{folder.id}/toggle_archive/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["is_archived"])

    def test_archived_folder_list(self):
        active = make_folder(self.user, "Active")
        archived = make_folder(self.user, "Archived")
        archived.is_archived = True
        archived.save()
        res = self.client.get("/api/folders/?archived=true")
        names = [f["name"] for f in res.data]
        self.assertIn("Archived", names)
        self.assertNotIn("Active", names)

    def test_active_folder_list_excludes_archived(self):
        active = make_folder(self.user, "Active")
        archived = make_folder(self.user, "Archived")
        archived.is_archived = True
        archived.save()
        res = self.client.get("/api/folders/")
        names = [f["name"] for f in res.data]
        self.assertIn("Active", names)
        self.assertNotIn("Archived", names)

    def test_archived_and_active_use_different_cache_keys(self):
        # Warm the active cache
        self.client.get("/api/folders/")
        # Warm the archived cache
        self.client.get("/api/folders/?archived=true")
        # They should be stored under different keys
        active_cached = get_cached(_folders_key(self.user.id, archived=False))
        archived_cached = get_cached(_folders_key(self.user.id, archived=True))
        # Both should be cached independently
        self.assertIsNotNone(active_cached)
        self.assertIsNotNone(archived_cached)


# ===========================================================================
# Document Tests
# ===========================================================================

class DocumentCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("docuser")
        self.client.force_authenticate(user=self.user)
        cache.clear()

    def test_create_document(self):
        res = self.client.post("/api/documents/", {"name": "file.pdf", "storage_path": "objects/file.pdf"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["name"], "file.pdf")

    def test_list_documents_returns_only_own(self):
        other = make_user("other_doc_user")
        make_doc(other, "other.pdf")
        make_doc(self.user, "mine.pdf")
        res = self.client.get("/api/documents/")
        names = [d["name"] for d in res.data]
        self.assertIn("mine.pdf", names)
        self.assertNotIn("other.pdf", names)

    def test_delete_document(self):
        doc = make_doc(self.user, "to_delete.pdf")
        res = self.client.delete(f"/api/documents/{doc.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Document.objects.filter(pk=doc.id).exists())

    def test_add_and_remove_tag(self):
        doc = make_doc(self.user)
        res = self.client.post(f"/api/documents/{doc.id}/add_tag/", {"name": "urgent"}, format="json")
        self.assertEqual(res.status_code, 200)
        doc.refresh_from_db()
        self.assertIn("urgent", [t.name for t in doc.tags.all()])

        res = self.client.post(f"/api/documents/{doc.id}/remove_tag/", {"name": "urgent"}, format="json")
        self.assertEqual(res.status_code, 200)
        doc.refresh_from_db()
        self.assertNotIn("urgent", [t.name for t in doc.tags.all()])

    def test_toggle_favorite(self):
        doc = make_doc(self.user)
        res = self.client.post(f"/api/documents/{doc.id}/toggle_favorite/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["is_favorited"])

        res = self.client.post(f"/api/documents/{doc.id}/toggle_favorite/")
        self.assertFalse(res.data["is_favorited"])

    def test_move_document_to_folder(self):
        doc = make_doc(self.user)
        folder = make_folder(self.user, "Target")
        res = self.client.post(f"/api/documents/{doc.id}/move/", {"folder_id": folder.id}, format="json")
        self.assertEqual(res.status_code, 200)
        doc.refresh_from_db()
        self.assertEqual(doc.folder_id, folder.id)

    def test_document_reorder(self):
        d1 = make_doc(self.user, "a.pdf")
        d2 = make_doc(self.user, "b.pdf")
        res = self.client.post("/api/documents/reorder/", {"order": [d2.id, d1.id]}, format="json")
        self.assertEqual(res.status_code, 200)
        d2.refresh_from_db()
        d1.refresh_from_db()
        self.assertEqual(d2.position, 0)
        self.assertEqual(d1.position, 1)

    def test_analyze_deducts_credit(self):
        doc = make_doc(self.user)
        initial_credits = self.user.credits
        res = self.client.post(f"/api/documents/{doc.id}/analyze/", {"ai_analysis": SAMPLE_ANALYSIS}, format="json")
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.credits, initial_credits - 1)

    def test_analyze_saves_analysis(self):
        doc = make_doc(self.user)
        self.client.post(f"/api/documents/{doc.id}/analyze/", {"ai_analysis": SAMPLE_ANALYSIS}, format="json")
        doc.refresh_from_db()
        self.assertEqual(doc.ai_analysis, SAMPLE_ANALYSIS)

    def test_analyze_fails_with_no_credits(self):
        self.user.credits = 0
        self.user.save()
        doc = make_doc(self.user)
        res = self.client.post(f"/api/documents/{doc.id}/analyze/", {"ai_analysis": SAMPLE_ANALYSIS}, format="json")
        self.assertEqual(res.status_code, 402)

    def test_analyze_fails_without_data(self):
        doc = make_doc(self.user)
        res = self.client.post(f"/api/documents/{doc.id}/analyze/", {}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cannot_analyze_other_users_doc(self):
        other = make_user("other_analyze")
        doc = make_doc(other)
        res = self.client.post(f"/api/documents/{doc.id}/analyze/", {"ai_analysis": SAMPLE_ANALYSIS}, format="json")
        self.assertEqual(res.status_code, 404)


# ===========================================================================
# Share (Public Link) Tests
# ===========================================================================

class ShareActionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("shareuser")
        self.client.force_authenticate(user=self.user)

    def test_share_requires_authentication(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        unauthed = APIClient()
        res = unauthed.post(f"/api/documents/{doc.id}/share/")
        self.assertEqual(res.status_code, 403)

    def test_share_document_without_analysis_returns_400(self):
        doc = make_doc(self.user)
        res = self.client.post(f"/api/documents/{doc.id}/share/")
        self.assertEqual(res.status_code, 400)

    def test_share_document_with_analysis_returns_token(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        res = self.client.post(f"/api/documents/{doc.id}/share/")
        self.assertEqual(res.status_code, 200)
        uuid.UUID(res.data["share_token"])

    def test_share_generates_token_and_persists(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        res = self.client.post(f"/api/documents/{doc.id}/share/")
        doc.refresh_from_db()
        self.assertEqual(str(doc.share_token), res.data["share_token"])

    def test_share_is_idempotent(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        res1 = self.client.post(f"/api/documents/{doc.id}/share/")
        res2 = self.client.post(f"/api/documents/{doc.id}/share/")
        self.assertEqual(res1.data["share_token"], res2.data["share_token"])

    def test_cannot_share_another_users_document(self):
        other = make_user("other_share")
        doc = make_doc(other, ai_analysis=SAMPLE_ANALYSIS)
        res = self.client.post(f"/api/documents/{doc.id}/share/")
        self.assertEqual(res.status_code, 404)

    def test_share_token_returned_in_document_serializer(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        self.client.post(f"/api/documents/{doc.id}/share/")
        res = self.client.get(f"/api/documents/{doc.id}/")
        self.assertIn("share_token", res.data)
        self.assertIsNotNone(res.data["share_token"])


class ShareViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("shareview_user")

    def test_share_view_returns_analysis_for_valid_token(self):
        token = uuid.uuid4()
        doc = make_doc(self.user, name="report.pdf", ai_analysis=SAMPLE_ANALYSIS)
        doc.share_token = token
        doc.save(update_fields=["share_token"])
        res = self.client.get(f"/api/share/{token}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["name"], "report.pdf")
        self.assertEqual(res.data["ai_analysis"], SAMPLE_ANALYSIS)

    def test_share_view_returns_404_for_unknown_token(self):
        res = self.client.get(f"/api/share/{uuid.uuid4()}/")
        self.assertEqual(res.status_code, 404)

    def test_share_view_returns_404_for_malformed_token(self):
        res = self.client.get("/api/share/not-a-uuid/")
        self.assertEqual(res.status_code, 404)

    def test_share_view_does_not_require_authentication(self):
        token = uuid.uuid4()
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        doc.share_token = token
        doc.save(update_fields=["share_token"])
        res = APIClient().get(f"/api/share/{token}/")
        self.assertEqual(res.status_code, 200)

    def test_share_view_only_returns_safe_fields(self):
        token = uuid.uuid4()
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        doc.share_token = token
        doc.storage_path = "/secret/path/file.pdf"
        doc.save(update_fields=["share_token", "storage_path"])
        res = self.client.get(f"/api/share/{token}/")
        self.assertNotIn("storage_path", res.data)
        self.assertNotIn("owner", res.data)
        self.assertNotIn("email_draft", res.data)
        self.assertIn("name", res.data)
        self.assertIn("ai_analysis", res.data)

    def test_share_view_returns_404_when_doc_has_no_analysis(self):
        token = uuid.uuid4()
        doc = make_doc(self.user, ai_analysis=None)
        doc.share_token = token
        doc.save(update_fields=["share_token"])
        res = self.client.get(f"/api/share/{token}/")
        self.assertEqual(res.status_code, 404)


# ===========================================================================
# Share With User Tests (Admin)
# ===========================================================================

class ShareWithUserTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_user("admin_share", role="admin")
        self.recipient = make_user("recipient")
        self.other = make_user("other_user")
        self.client.force_authenticate(user=self.admin)
        cache.clear()

    def test_admin_can_share_document_with_user(self):
        doc = make_doc(self.admin, ai_analysis=SAMPLE_ANALYSIS)
        res = self.client.post(
            f"/api/documents/{doc.id}/share_with_user/",
            {"user_id": self.recipient.id},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["shared"])
        self.assertEqual(res.data["username"], "recipient")

    def test_share_with_user_creates_permission_record(self):
        doc = make_doc(self.admin, ai_analysis=SAMPLE_ANALYSIS)
        self.client.post(
            f"/api/documents/{doc.id}/share_with_user/",
            {"user_id": self.recipient.id},
            format="json",
        )
        self.assertTrue(
            DocumentPermission.objects.filter(document=doc, user=self.recipient).exists()
        )

    def test_share_with_user_is_idempotent(self):
        doc = make_doc(self.admin, ai_analysis=SAMPLE_ANALYSIS)
        self.client.post(f"/api/documents/{doc.id}/share_with_user/", {"user_id": self.recipient.id}, format="json")
        self.client.post(f"/api/documents/{doc.id}/share_with_user/", {"user_id": self.recipient.id}, format="json")
        count = DocumentPermission.objects.filter(document=doc, user=self.recipient).count()
        self.assertEqual(count, 1)

    def test_non_admin_cannot_share_with_user(self):
        self.client.force_authenticate(user=self.other)
        doc = make_doc(self.other)
        res = self.client.post(
            f"/api/documents/{doc.id}/share_with_user/",
            {"user_id": self.recipient.id},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_share_with_user_requires_user_id(self):
        doc = make_doc(self.admin)
        res = self.client.post(f"/api/documents/{doc.id}/share_with_user/", {}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_share_with_user_returns_404_for_unknown_user(self):
        doc = make_doc(self.admin)
        res = self.client.post(
            f"/api/documents/{doc.id}/share_with_user/",
            {"user_id": 99999},
            format="json",
        )
        self.assertEqual(res.status_code, 404)

    def test_share_with_user_invalidates_shared_cache(self):
        doc = make_doc(self.admin, ai_analysis=SAMPLE_ANALYSIS)
        set_cached(_shared_key(self.recipient.id), [])
        self.client.post(
            f"/api/documents/{doc.id}/share_with_user/",
            {"user_id": self.recipient.id},
            format="json",
        )
        self.assertIsNone(get_cached(_shared_key(self.recipient.id)))

    def test_admin_can_unshare_document(self):
        doc = make_doc(self.admin)
        DocumentPermission.objects.create(document=doc, user=self.recipient, permission="view")
        res = self.client.delete(f"/api/documents/{doc.id}/share_with_user/{self.recipient.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(
            DocumentPermission.objects.filter(document=doc, user=self.recipient).exists()
        )

    def test_unshare_returns_404_for_unknown_user(self):
        doc = make_doc(self.admin)
        res = self.client.delete(f"/api/documents/{doc.id}/share_with_user/99999/")
        self.assertEqual(res.status_code, 404)


class SharedWithMeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_user("admin_swm", role="admin")
        self.user = make_user("swm_user")
        self.other = make_user("swm_other")
        cache.clear()

    def test_shared_with_me_returns_shared_documents(self):
        doc = make_doc(self.admin, "shared.pdf", ai_analysis=SAMPLE_ANALYSIS)
        DocumentPermission.objects.create(document=doc, user=self.user, permission="view")
        self.client.force_authenticate(user=self.user)
        res = self.client.get("/api/documents/shared_with_me/")
        self.assertEqual(res.status_code, 200)
        names = [d["name"] for d in res.data]
        self.assertIn("shared.pdf", names)

    def test_shared_with_me_excludes_unshared_documents(self):
        make_doc(self.admin, "not_shared.pdf", ai_analysis=SAMPLE_ANALYSIS)
        self.client.force_authenticate(user=self.user)
        res = self.client.get("/api/documents/shared_with_me/")
        self.assertEqual(res.status_code, 200)
        names = [d["name"] for d in res.data]
        self.assertNotIn("not_shared.pdf", names)

    def test_shared_with_me_is_user_specific(self):
        doc = make_doc(self.admin, "only_for_user.pdf")
        DocumentPermission.objects.create(document=doc, user=self.user, permission="view")
        # other user should NOT see it
        self.client.force_authenticate(user=self.other)
        res = self.client.get("/api/documents/shared_with_me/")
        names = [d["name"] for d in res.data]
        self.assertNotIn("only_for_user.pdf", names)

    def test_shared_with_me_requires_authentication(self):
        res = APIClient().get("/api/documents/shared_with_me/")
        self.assertEqual(res.status_code, 403)

    def test_shared_with_me_returns_empty_list_when_nothing_shared(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.get("/api/documents/shared_with_me/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])

    def test_shared_with_me_caches_result(self):
        self.client.force_authenticate(user=self.user)
        self.client.get("/api/documents/shared_with_me/")
        cached = get_cached(_shared_key(self.user.id))
        self.assertIsNotNone(cached)


# ===========================================================================
# Team Tests
# ===========================================================================

class TeamTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_user("teamadmin", role="admin")
        self.user = make_user("teamuser", role="user")

    def test_list_teams_unauthenticated(self):
        Team.objects.create(name="Open Team")
        res = APIClient().get("/api/teams/")
        self.assertEqual(res.status_code, 200)

    def test_admin_can_create_team(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post("/api/teams/", {"name": "New Team"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["name"], "New Team")

    def test_non_admin_cannot_create_team(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.post("/api/teams/", {"name": "New Team"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_duplicate_team_name_rejected(self):
        Team.objects.create(name="Existing")
        self.client.force_authenticate(user=self.admin)
        res = self.client.post("/api/teams/", {"name": "Existing"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_join_request_create(self):
        team = Team.objects.create(name="JoinMe")
        self.client.force_authenticate(user=self.user)
        res = self.client.post("/api/teams/join-request/", {"team_id": team.id}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(TeamJoinRequest.objects.filter(user=self.user, team=team).exists())

    def test_join_request_cancel(self):
        team = Team.objects.create(name="CancelTeam")
        req = TeamJoinRequest.objects.create(user=self.user, team=team, status="pending")
        self.client.force_authenticate(user=self.user)
        res = self.client.delete("/api/teams/join-request/", {"team_id": team.id}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(TeamJoinRequest.objects.filter(pk=req.pk).exists())

    def test_team_leave(self):
        team = Team.objects.create(name="LeaveTeam")
        self.user.team = team
        self.user.save()
        self.client.force_authenticate(user=self.user)
        res = self.client.post("/api/teams/leave/")
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.team)

    def test_team_leave_when_not_in_team(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.post("/api/teams/leave/")
        self.assertEqual(res.status_code, 400)

    def test_team_join_request_resolve_approve(self):
        team = Team.objects.create(name="ApproveTeam")
        leader = make_user("leader", role="team_leader", team=team)
        join_req = TeamJoinRequest.objects.create(user=self.user, team=team, status="pending")
        self.client.force_authenticate(user=leader)
        res = self.client.post(f"/api/teams/join-requests/{join_req.id}/resolve/", {"action": "approve"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.team, team)

    def test_team_join_request_resolve_reject(self):
        team = Team.objects.create(name="RejectTeam")
        leader = make_user("leader2", role="team_leader", team=team)
        join_req = TeamJoinRequest.objects.create(user=self.user, team=team, status="pending")
        self.client.force_authenticate(user=leader)
        res = self.client.post(f"/api/teams/join-requests/{join_req.id}/resolve/", {"action": "reject"}, format="json")
        self.assertEqual(res.status_code, 200)
        join_req.refresh_from_db()
        self.assertEqual(join_req.status, "rejected")

    def test_cannot_join_team_already_in(self):
        team = Team.objects.create(name="AlreadyIn")
        self.user.team = team
        self.user.save()
        self.client.force_authenticate(user=self.user)
        res = self.client.post("/api/teams/join-request/", {"team_id": team.id}, format="json")
        self.assertEqual(res.status_code, 400)


# ===========================================================================
# Admin View Tests
# ===========================================================================

class AdminViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_user("sysadmin", role="admin")
        self.user = make_user("regularuser")
        self.client.force_authenticate(user=self.admin)
        cache.clear()

    def test_admin_can_list_users(self):
        res = self.client.get("/api/admin/users/")
        self.assertEqual(res.status_code, 200)
        self.assertIsInstance(res.data, list)

    def test_non_admin_cannot_list_users(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.get("/api/admin/users/")
        self.assertEqual(res.status_code, 403)

    def test_admin_can_update_user_role(self):
        res = self.client.patch(f"/api/admin/users/{self.user.id}/", {"role": "viewer"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, "viewer")

    def test_admin_rejects_invalid_role(self):
        res = self.client.patch(f"/api/admin/users/{self.user.id}/", {"role": "superuser"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_admin_cannot_delete_self(self):
        res = self.client.delete(f"/api/admin/users/{self.admin.id}/delete/", format="json")
        self.assertEqual(res.status_code, 400)

    def test_admin_can_delete_user(self):
        target = make_user("to_delete_admin")
        res = self.client.delete(f"/api/admin/users/{target.id}/delete/", format="json")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(User.objects.filter(pk=target.id).exists())

    def test_admin_delete_with_keep_files_transfers_docs(self):
        target = make_user("file_owner")
        make_doc(target, "important.pdf")
        res = self.client.delete(
            f"/api/admin/users/{target.id}/delete/",
            data={"keep_files": True},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertFalse(User.objects.filter(pk=target.id).exists())
        self.assertTrue(Document.objects.filter(owner=self.admin, name="important.pdf").exists())

    def test_admin_grant_credits(self):
        initial = self.user.credits
        res = self.client.post(f"/api/admin/users/{self.user.id}/grant-credits/", {"amount": 5}, format="json")
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.credits, initial + 5)

    def test_admin_grant_credits_invalid_amount(self):
        res = self.client.post(f"/api/admin/users/{self.user.id}/grant-credits/", {"amount": 0}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_admin_application_approve(self):
        app = AdminRequest.objects.create(user=self.user)
        res = self.client.post(f"/api/admin/applications/{app.id}/resolve/", {"action": "approve"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, "admin")

    def test_admin_application_reject(self):
        app = AdminRequest.objects.create(user=self.user)
        res = self.client.post(f"/api/admin/applications/{app.id}/resolve/", {"action": "reject"}, format="json")
        self.assertEqual(res.status_code, 200)
        app.refresh_from_db()
        self.assertEqual(app.status, "rejected")


# ===========================================================================
# Credit View Tests
# ===========================================================================

class CreditViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("credituser")
        self.admin = make_user("creditadmin", role="admin")
        self.client.force_authenticate(user=self.user)

    def test_my_credits_returns_balance(self):
        res = self.client.get("/api/credits/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("credits", res.data)
        self.assertEqual(res.data["credits"], 40)

    def test_my_credits_returns_transactions(self):
        CreditTransaction.objects.create(user=self.user, type="analyze", amount=-1, note="test")
        res = self.client.get("/api/credits/")
        self.assertEqual(len(res.data["transactions"]), 1)

    def test_submit_credit_request(self):
        res = self.client.post("/api/credits/request/", {"amount": 5}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(CreditRequest.objects.filter(user=self.user, status="pending").exists())

    def test_credit_request_out_of_range(self):
        res = self.client.post("/api/credits/request/", {"amount": 11}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cannot_submit_two_credit_requests(self):
        CreditRequest.objects.create(user=self.user, amount=3)
        res = self.client.post("/api/credits/request/", {"amount": 5}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cancel_credit_request(self):
        CreditRequest.objects.create(user=self.user, amount=3)
        res = self.client.delete("/api/credits/request/cancel/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(CreditRequest.objects.filter(user=self.user, status="pending").exists())

    def test_admin_can_approve_credit_request(self):
        req = CreditRequest.objects.create(user=self.user, amount=5)
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(f"/api/admin/credit-requests/{req.id}/resolve/", {"action": "approve"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.credits, 45)

    def test_admin_can_reject_credit_request(self):
        req = CreditRequest.objects.create(user=self.user, amount=5)
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(f"/api/admin/credit-requests/{req.id}/resolve/", {"action": "reject"}, format="json")
        self.assertEqual(res.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, "rejected")
        self.user.refresh_from_db()
        self.assertEqual(self.user.credits, 40)


# ===========================================================================
# Combined Analysis Tests
# ===========================================================================

class CombinedAnalysisTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("causer")
        self.client.force_authenticate(user=self.user)
        self.folder = make_folder(self.user, "Reports")

    def test_save_combined_requires_two_docs(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        res = self.client.post("/api/combined-analyses/save/", {
            "folder_id": self.folder.id,
            "document_ids": [doc.id],
            "combined_analysis": SAMPLE_ANALYSIS,
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_save_combined_deducts_credit(self):
        doc1 = make_doc(self.user, "a.pdf", ai_analysis=SAMPLE_ANALYSIS)
        doc2 = make_doc(self.user, "b.pdf", ai_analysis=SAMPLE_ANALYSIS)
        initial = self.user.credits
        res = self.client.post("/api/combined-analyses/save/", {
            "folder_id": self.folder.id,
            "document_ids": [doc1.id, doc2.id],
            "combined_analysis": SAMPLE_ANALYSIS,
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.user.refresh_from_db()
        self.assertEqual(self.user.credits, initial - 1)

    def test_save_combined_fails_with_no_credits(self):
        self.user.credits = 0
        self.user.save()
        doc1 = make_doc(self.user, "a.pdf", ai_analysis=SAMPLE_ANALYSIS)
        doc2 = make_doc(self.user, "b.pdf", ai_analysis=SAMPLE_ANALYSIS)
        res = self.client.post("/api/combined-analyses/save/", {
            "folder_id": self.folder.id,
            "document_ids": [doc1.id, doc2.id],
            "combined_analysis": SAMPLE_ANALYSIS,
        }, format="json")
        self.assertEqual(res.status_code, 402)

    def test_delete_combined_analysis(self):
        doc1 = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        doc2 = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        ca = CombinedAnalysis.objects.create(
            folder=self.folder, owner=self.user, combined_analysis=SAMPLE_ANALYSIS
        )
        ca.source_documents.set([doc1, doc2])
        res = self.client.delete(f"/api/combined-analyses/{ca.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(CombinedAnalysis.objects.filter(pk=ca.id).exists())
