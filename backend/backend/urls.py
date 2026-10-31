from django.contrib import admin
from django.urls import path, include
from auto_K8S import auth_views

urlpatterns = [
    path('admin/', admin.site.urls),
    # Authentication endpoints
    path('api/auth/google/', auth_views.auth_google),
    path('api/auth/login/', auth_views.auth_login),
    path('api/auth/register/', auth_views.auth_register),
    path('api/auth/me/', auth_views.auth_me),
    path('api/', include('auto_K8S.urls')),
]
