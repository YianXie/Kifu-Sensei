// Mirrors the `Field(ge=..., le=..., max_length=...)` bounds on
// `GenerateCommentaryRequest` in `backend/app/schemas.py`, which is the source of
// truth. The extension keeps its own copy in `extension/src/shared/commentary.ts`
// (separate build, no shared module) — change all three together.
export const NUM_COMMENTS_MIN = 1;
export const NUM_COMMENTS_MAX = 100;
export const MAX_TOKEN_MIN = 256;
export const MAX_TOKEN_MAX = 8192;
export const CUSTOM_INSTRUCTION_MAX = 1000;
