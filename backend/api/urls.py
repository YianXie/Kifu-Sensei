from django.urls import path

from .views import GenerateCommentaryView, HealthView

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("commentary/", GenerateCommentaryView.as_view(), name="generate-commentary"),
]
