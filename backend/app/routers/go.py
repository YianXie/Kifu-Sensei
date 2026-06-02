import logging

from fastapi import APIRouter, HTTPException, status

from app.deps import CurrentUser
from app.schemas import GenerateCommentaryRequest, GenerateCommentaryResponse
from app.services.katago import generate_commentary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["go"])


@router.get("/health/")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/commentary/", response_model=GenerateCommentaryResponse)
def commentary(payload: GenerateCommentaryRequest, user: CurrentUser) -> GenerateCommentaryResponse:
    try:
        return generate_commentary(payload.sgf_content, user)  # type: ignore
    except Exception as exc:
        logger.exception("Failed to generate commentary")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to generate commentary: {exc}",
        ) from exc
