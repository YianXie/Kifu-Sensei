from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Item
from .serializers import (
    ItemCreateSerializer,
    ItemDetailSerializer,
    ItemListSerializer,
    ItemUpdateSerializer,
)


class HealthView(APIView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


class ItemListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        items = Item.objects.filter(user=request.user)
        serializer = ItemListSerializer(items, many=True)
        return Response(serializer.data)

    def post(self, request: Request) -> Response:
        serializer = ItemCreateSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        item = serializer.save()
        return Response(ItemDetailSerializer(item).data, status=status.HTTP_201_CREATED)


class ItemDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_item(self, request: Request, item_id: str) -> Item:
        return get_object_or_404(Item, id=item_id, user=request.user)

    def get(self, request: Request, item_id: str) -> Response:
        item = self._get_item(request, item_id)
        serializer = ItemDetailSerializer(item)
        return Response(serializer.data)

    def patch(self, request: Request, item_id: str) -> Response:
        item = self._get_item(request, item_id)
        serializer = ItemUpdateSerializer(item, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(ItemDetailSerializer(item).data)

    def delete(self, request: Request, item_id: str) -> Response:
        item = self._get_item(request, item_id)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
