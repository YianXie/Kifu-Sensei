import copy

from django.contrib.auth.models import User
from django.db import models

DEFAULT_USER_PREFERENCES: dict = {
    "theme": "system",
    "notifications_enabled": True,
    "language": "en",
}


class UserSettings(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="settings")
    preferences = models.JSONField(default=dict)

    class Meta:
        verbose_name = "User Settings"
        verbose_name_plural = "User Settings"

    def save(self, *args, **kwargs) -> None:  # type: ignore[override]
        if not self.preferences:
            self.preferences = copy.deepcopy(DEFAULT_USER_PREFERENCES)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"Settings for {self.user.email}"
