from django.contrib.auth.models import User
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import DEFAULT_USER_PREFERENCES, UserSettings


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
        attrs["username"] = attrs.get("email", "")
        data = super().validate(attrs)

        try:
            settings = self.user.settings
            preferences = settings.preferences
        except UserSettings.DoesNotExist:
            settings = UserSettings.objects.create(user=self.user)
            preferences = settings.preferences

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
