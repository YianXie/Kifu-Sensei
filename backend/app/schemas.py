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


class TokenPairResponse(BaseModel):
    access: str
    refresh: str
    user: UserPublic


class AccessTokenResponse(BaseModel):
    access: str
    refresh: str


class UserSettingsSchema(BaseModel):
    preferences: dict


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
