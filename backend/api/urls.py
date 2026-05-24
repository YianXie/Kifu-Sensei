from django.urls import path

from .views import HealthView, ItemDetailView, ItemListView

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("items/", ItemListView.as_view(), name="item_list"),
    path("items/<uuid:item_id>/", ItemDetailView.as_view(), name="item_detail"),
]
