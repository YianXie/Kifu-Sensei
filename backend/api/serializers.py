from rest_framework import serializers


class GenerateCommentarySerializer(serializers.Serializer):
    sgf_content = serializers.CharField(
        allow_blank=False,
        trim_whitespace=False,
        help_text="Raw SGF string to parse and send to KataGo.",
    )
