from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class TokenObtainRequest(BaseModel):
    email: EmailStr
    password: str


class TokenRefreshRequest(BaseModel):
    refresh: str


class UserPublic(BaseModel):
    id: int
    email: str
    preferences: dict
    has_claude_api_key: bool = False

    class Config:
        form_attributes = True


class TokenPairResponse(BaseModel):
    access: str
    refresh: str
    user: UserPublic


class AccessTokenResponse(BaseModel):
    access: str
    refresh: str


class UserSettingsSchema(BaseModel):
    preferences: dict
    has_claude_api_key: bool = False


class UpdateClaudeApiKeyRequest(BaseModel):
    claude_api_key: str = Field(min_length=1)


class UpdateEmailRequest(BaseModel):
    email: EmailStr
    password: str


class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class DeleteAccountRequest(BaseModel):
    password: str


class DetailResponse(BaseModel):
    detail: str


class GenerateCommentaryRequest(BaseModel):
    sgf_content: str = Field(min_length=1)
    sgf_file_name: str = Field(min_length=5)
    model: Literal["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"] = "claude-haiku-4-5"
    language: Literal["english", "chinese (simplified)", "japanese", "korean"] = "english"
    num_comments: int = Field(default=20, ge=1, le=100)
    max_token: int = Field(default=1024, ge=256, le=8192)
    custom_instruction: str = Field(default="", max_length=1000)


class CommentaryItemSchema(BaseModel):
    turn: int
    comment: str


class GenerateCommentaryResponse(BaseModel):
    board_size: int
    sgf_file_name: str
    language: Literal["english", "chinese (simplified)", "japanese", "korean"]
    moves: list[list]
    initial_stones: list[list]
    comments: list[CommentaryItemSchema]
    annotated_sgf_content: str | None


class UserCommentaryHistory(BaseModel):
    commentaries: list[GenerateCommentaryResponse]
