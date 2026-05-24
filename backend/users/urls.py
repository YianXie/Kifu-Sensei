from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    CustomTokenObtainPairView,
    DeleteAccountView,
    RegisterView,
    UpdateEmailView,
    UpdatePasswordView,
    UserSettingsView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("token/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("user/settings/", UserSettingsView.as_view(), name="user_settings"),
    path("user/update-email/", UpdateEmailView.as_view(), name="update_email"),
    path("user/update-password/", UpdatePasswordView.as_view(), name="update_password"),
    path("user/delete/", DeleteAccountView.as_view(), name="delete_account"),
]
