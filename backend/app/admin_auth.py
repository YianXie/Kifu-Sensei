from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request

from app.config import settings

_ADMIN_SESSION_KEY = "admin_authenticated"


class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        form = await request.form()
        if (
            form.get("username") == settings.admin_username
            and form.get("password") == settings.admin_password
        ):
            request.session[_ADMIN_SESSION_KEY] = True
            return True
        return False

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        return request.session.get(_ADMIN_SESSION_KEY) is True
