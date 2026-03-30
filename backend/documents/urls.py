from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'folders', views.FolderViewSet, basename='folder')
router.register(r'documents', views.DocumentViewSet, basename='document')
router.register(r'permissions', views.DocumentPermissionViewSet, basename='permission')
router.register(r'combined-analyses', views.CombinedAnalysisViewSet, basename='combined-analysis')

urlpatterns = [
    path('auth/sync/', views.clerk_sync),
    path('auth/logout/', views.logout),
    path('auth/me/', views.me),
    path('teams/', views.teams_list),
    path('teams/join-request/', views.team_join_request),
    path('teams/join-requests/', views.team_join_requests_list),
    path('teams/join-requests/<int:request_id>/resolve/', views.team_join_request_resolve),
    path('teams/leave/', views.team_leave),
    path('teams/<int:team_id>/members/', views.team_members),
    path('admin/users/', views.admin_users),
    path('admin/users/<int:user_id>/', views.admin_update_user),
    path('admin/users/<int:user_id>/delete/', views.admin_delete_user),
    path('admin/apply/', views.admin_apply),
    path('admin/applications/', views.admin_applications_list),
    path('admin/applications/<int:application_id>/resolve/', views.admin_application_resolve),
    path('admin/users/<int:user_id>/grant-credits/', views.admin_grant_credits),
    path('admin/credit-requests/', views.admin_credit_requests),
    path('admin/credit-requests/<int:request_id>/resolve/', views.admin_credit_request_resolve),
    path('admin/documents/', views.admin_documents),
    path('credits/', views.my_credits),
    path('credits/request/', views.credit_request),
    path('credits/request/cancel/', views.credit_request_cancel),
    path('credits/packages/', views.credit_packages),
    path('credits/checkout/', views.create_checkout_session),
    path('stripe/webhook/', views.stripe_webhook),
    path('stripe/verify-session/', views.verify_stripe_session),
    path('feature-flags/', views.feature_flags_public),
    path('admin/feature-flags/', views.admin_feature_flags),
    path('admin/feature-flags/<str:key>/', views.admin_feature_flag_toggle),
    path('share/<uuid:token>/', views.share_view),
    path('', include(router.urls)),
]
