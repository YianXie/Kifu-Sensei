import uuid

from django.contrib.auth.models import User
from django.db import models


class Item(models.Model):
    """Generic resource model — rename and extend for your domain."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="items")
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title
