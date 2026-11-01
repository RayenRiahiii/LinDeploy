from django.urls import path
from . import views
from . import auth_views

urlpatterns = [
    # Authentication endpoints
    path("auth/google/", auth_views.auth_google),
    path("auth/login/", auth_views.auth_login),
    path("auth/register/", auth_views.auth_register),
    path("auth/me/", auth_views.auth_me),

    # Application routes
    path("dashboard/", views.dashboard_summary),
    path("mirror/", views.mirror_status),
    path("mirror/prewarm/", views.prewarm_mirror),
    path("hosts/", views.hosts_list_create),
    path("hosts/<int:id>/", views.host_detail),
    path("hosts/<int:id>/detect/", views.detect_host_state),
    path("hosts/<int:id>/orphans/", views.detect_host_orphans),
    path("credentials/", views.credentials_list),
    path("credentials/<int:id>/", views.credential_detail),
    path("templates/", views.templates_list),
    path("openshift/secrets/", views.create_openshift_secret_bundle),
    path("openshift/configuration/", views.openshift_configuration),
    path("installations/", views.installations_list),
    path("installations/active/", views.active_installation),
    path("installations/clear-history/", views.clear_installation_history),
    path("installations/<int:id>/", views.installation_detail),
    path("installations/<int:id>/cancel/", views.cancel_installation),
    path("installations/<int:id>/console/", views.stream_vm_console),
    path("installations/<int:id>/retry-openshift/", views.retry_openshift_installation),
    path("installations/precheck/", views.precheck_installation_hosts),
    path("installations/launch/", views.launch_installation),
]
