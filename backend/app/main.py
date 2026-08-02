from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqladmin import Admin, ModelView

from app.admin_auth import AdminAuth
from app.config import settings
from app.database import engine, init_db
from app.errors import CatchUnhandledErrors, MaxBodySizeMiddleware, register_exception_handlers
from app.models import Commentary, User
from app.routers import auth, go
from app.routers.go import close_pipeline_executor, reap_abandoned_jobs
from app.services.katago import close_http_client


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    reap_abandoned_jobs()
    yield
    close_http_client()
    close_pipeline_executor()


app = FastAPI(title="Kifu-Sensei API", version="0.1.0", lifespan=lifespan)

# Order matters, and these calls cannot be reordered freely: ``add_middleware`` puts
# the most recently added middleware outermost, so CORS must be added last to wrap
# everything below it and stamp CORS headers onto whatever response comes back —
# including the error responses the other two generate directly. Added any other way,
# those responses would reach the browser without an Access-Control-Allow-Origin
# header and be reported as a CORS failure instead of the real 413/500.
app.add_middleware(MaxBodySizeMiddleware, max_bytes=settings.max_request_body_bytes)
app.add_middleware(CatchUnhandledErrors)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(auth.router)
app.include_router(go.router)


class UserAdmin(ModelView, model=User):
    column_list = [User.id, User.email, User.preferences, User.created_at]
    # ``form_excluded_columns`` only affects the create/edit forms — the details view
    # renders every column by default, so both fields need excluding there too or the
    # whole point of encrypting the API key and hashing the password (crypto.py,
    # security.py) is undone by the admin's own UI.
    form_excluded_columns = [User.hashed_password, User.claude_api]
    column_details_exclude_list = [User.hashed_password, User.claude_api]
    can_edit = False
    can_delete = False


class CommentaryAdmin(ModelView, model=Commentary):
    column_list = [
        Commentary.id,
        Commentary.user_id,
        # Commentary.board_size,
        Commentary.sgf_file_name,
        # Commentary.moves,
        Commentary.initial_stones,
        # Commentary.comments,
        # Commentary.annotated_sgf_content,
        Commentary.created_at,
    ]
    can_edit = False
    can_delete = False


# Off by default (see Settings.enable_admin) — an operator has to opt in before the
# dashboard is reachable at all, rather than relying on the shared password alone.
if settings.enable_admin:
    admin = Admin(app, engine, authentication_backend=AdminAuth(secret_key=settings.secret_key))
    admin.add_view(UserAdmin)
    admin.add_view(CommentaryAdmin)
