from django.contrib.auth import authenticate as django_authenticate
from django.contrib.auth.models import User
from rest_framework import serializers
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.settings import api_settings

from .models import UserSettings


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    email = serializers.EmailField(required=True)

    class Meta:
        model = User
        fields = ("email", "password")

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value.lower()

    def create(self, validated_data: dict) -> User:
        user = User.objects.create_user(
            username=validated_data["email"],
            email=validated_data["email"],
            password=validated_data["password"],
        )
        UserSettings.objects.create(user=user)
        return user


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Embeds user metadata and preferences into the JWT payload."""

    username_field = "email"

    def validate(self, attrs: dict) -> dict:
        email = attrs.get("email", "").lower()
        password = attrs.get("password", "")

        # Look up the user by email first, then authenticate with username.
        # Django's ModelBackend only recognises the `username` kwarg; passing
        # `email=` directly always returns None and causes "no active account".
        try:
            user_obj = User.objects.get(email=email)
        except User.DoesNotExist:
            raise AuthenticationFailed(
                self.error_messages["no_active_account"],
                "no_active_account",
            )

        self.user = django_authenticate(
            request=self.context.get("request"),
            username=user_obj.username,
            password=password,
        )

        if not api_settings.USER_AUTHENTICATION_RULE(self.user):
            raise AuthenticationFailed(
                self.error_messages["no_active_account"],
                "no_active_account",
            )

        refresh = self.get_token(self.user)
        data: dict = {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
        }

        try:
            user_settings = self.user.settings
            preferences = user_settings.preferences
        except UserSettings.DoesNotExist:
            user_settings = UserSettings.objects.create(user=self.user)
            preferences = user_settings.preferences

        data["user"] = {
            "id": self.user.pk,
            "email": self.user.email,
            "preferences": preferences,
        }
        return data

    @classmethod
    def get_token(cls, user: User):  # type: ignore[override]
        token = super().get_token(user)
        token["email"] = user.email
        return token


class UserSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserSettings
        fields = ("preferences",)


class UpdateEmailSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate_email(self, value: str) -> str:
        user = self.context["request"].user
        if User.objects.exclude(pk=user.pk).filter(email=value).exists():
            raise serializers.ValidationError("This email is already in use.")
        return value.lower()


class UpdatePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)
