from rest_framework import serializers

from .models import Item


class ItemListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = ("id", "title", "description", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ItemDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = ("id", "title", "description", "data", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ItemCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = ("title", "description", "data")

    def create(self, validated_data: dict) -> Item:
        user = self.context["request"].user
        return Item.objects.create(user=user, **validated_data)


class ItemUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = ("title", "description", "data")
