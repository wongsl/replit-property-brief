from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'folders', views.FolderViewSet, basename='folder')
router.register(r'documents', views.DocumentViewSet, basename='document')
router.register(r'permissions', views.DocumentPermissionViewSet, basename='permission')

urlpatterns = [
    path('auth/register/', views.register),
    path('auth/login/', views.login),
    path('auth/logout/', views.logout),
    path('auth/me/', views.me),
    path('teams/', views.teams_list),
    path('admin/users/', views.admin_users),
    path('admin/users/<int:user_id>/', views.admin_update_user),
    path('admin/users/<int:user_id>/delete/', views.admin_delete_user),
    path('', include(router.urls)),
]
