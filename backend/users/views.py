from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import UserSettings
from .serializers import (
    CustomTokenObtainPairSerializer,
    RegisterSerializer,
    UpdateEmailSerializer,
    UpdatePasswordSerializer,
    UserSettingsSerializer,
)


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response({"detail": "Account created."}, status=status.HTTP_201_CREATED)


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class UserSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        settings, _ = UserSettings.objects.get_or_create(user=request.user)
        serializer = UserSettingsSerializer(settings)
        return Response(serializer.data)

    def put(self, request: Request) -> Response:
        settings, _ = UserSettings.objects.get_or_create(user=request.user)
        serializer = UserSettingsSerializer(settings, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data)


class UpdateEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = UpdateEmailSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user: User = request.user  # type: ignore[assignment]
        if not user.check_password(serializer.validated_data["password"]):
            return Response(
                {"password": ["Incorrect password."]}, status=status.HTTP_400_BAD_REQUEST
            )

        new_email = serializer.validated_data["email"]
        user.email = new_email
        user.username = new_email
        user.save()
        return Response({"detail": "Email updated."})


class UpdatePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = UpdatePasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user: User = request.user  # type: ignore[assignment]
        if not user.check_password(serializer.validated_data["current_password"]):
            return Response(
                {"current_password": ["Incorrect password."]}, status=status.HTTP_400_BAD_REQUEST
            )

        user.set_password(serializer.validated_data["new_password"])
        user.save()
        return Response({"detail": "Password updated."})


class DeleteAccountView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request: Request) -> Response:
        user: User = request.user  # type: ignore[assignment]
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
