import logging

from fastapi import APIRouter, HTTPException, status

from app.deps import CurrentUser, SessionDep
from app.models import Commentary
from app.schemas import GenerateCommentaryRequest, GenerateCommentaryResponse
from app.services.katago import generate_commentary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["go"])


@router.get("/health/")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/commentary/", response_model=GenerateCommentaryResponse)
def commentary(
    payload: GenerateCommentaryRequest,
    user: CurrentUser,
    session: SessionDep,
) -> GenerateCommentaryResponse:
    try:
        commentary = generate_commentary(
            payload.sgf_content,
            user,
            model=payload.model,
            sgf_file_name=payload.sgf_file_name,
            language=payload.language,
            num_comments=payload.num_comments,
            max_token=payload.max_token,
            custom_instruction=payload.custom_instruction,
        )
        session.add(
            Commentary(
                user_id=user.id,
                board_size=commentary["board_size"],
                sgf_file_name=commentary["sgf_file_name"],
                language=commentary["language"],
                model=commentary["model"],
                usage=commentary["usage"],
                moves=commentary["moves"],
                initial_stones=commentary["initial_stones"],
                comments=commentary["comments"],
                annotated_sgf_content=commentary["annotated_sgf_content"],
            )
        )
        session.commit()
        return commentary
    except Exception as exc:
        logger.exception("Failed to generate commentary")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to generate commentary: {exc}",
        ) from exc
