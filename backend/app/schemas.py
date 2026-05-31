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


class DetailResponse(BaseModel):
    detail: str


class GenerateCommentaryRequest(BaseModel):
    sgf_content: str = Field(min_length=1)


class CommentaryItemSchema(BaseModel):
    turn: int
    comment: str


class GenerateCommentaryResponse(BaseModel):
    board_size: int
    moves: list[list]
    initial_stones: list[list]
    comments: list[CommentaryItemSchema]
