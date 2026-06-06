from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqladmin import Admin, ModelView

from app.config import settings
from app.database import engine, init_db
from app.errors import register_exception_handlers
from app.models import Commentary, User
from app.routers import auth, go
from app.services.katago import close_http_client


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield
    close_http_client()


app = FastAPI(title="Kifu-Sensei API", version="0.1.0", lifespan=lifespan)
admin = Admin(app, engine)

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


class CommentaryAdmin(ModelView, model=Commentary):
    column_list = [
        Commentary.id,
        Commentary.board_size,
        Commentary.moves,
        Commentary.initial_stones,
        Commentary.comments,
        Commentary.annotated_sgf_content,
        Commentary.created_at,
    ]


admin.add_view(UserAdmin)
admin.add_view(CommentaryAdmin)
