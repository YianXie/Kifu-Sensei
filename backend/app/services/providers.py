"""Provider-neutral commentary client boundary.

The pipeline owns prompt construction, progress, partial failures, and usage
aggregation.  Providers only turn one system/user prompt pair into text and
return the upstream usage object for the pipeline to normalize.
"""

from collections.abc import Callable
from typing import Any, Protocol

import httpx
from anthropic import Anthropic

from app.errors import UpstreamAuthError, UpstreamError, UpstreamRateLimitedError

#: Where OpenAI-compatible requests go when the account configuration has no
#: ``base_url``. vLLM and Ollama deployments pass their own endpoint instead.
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

#: httpx's default (5 s) is far too short for a multi-hundred-token generation, and
#: the transport has no retry of its own — a single slow generation must not fail
#: outright.
_PROVIDER_TIMEOUT_SECONDS = 120.0


class CommentaryProvider(Protocol):
    def complete(
        self, *, model: str, max_tokens: int, system_prompt: str, user_prompt: str
    ) -> tuple[str, Any]: ...


class ClaudeProvider:
    """Anthropic implementation kept behind the provider boundary."""

    def __init__(self, api_key: str, *, client_factory: Callable[..., Any] = Anthropic):
        self.client = client_factory(api_key=api_key)

    def complete(
        self, *, model: str, max_tokens: int, system_prompt: str, user_prompt: str
    ) -> tuple[str, Any]:
        message = self.client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(block.text for block in message.content if block.type == "text")
        return text, message.usage


def _retry_after_seconds(response: httpx.Response) -> int | None:
    """Read the ``retry-after`` header off a chat-completions response, in seconds.

    The RFC also allows an HTTP-date, which we do not translate — returning ``None``
    lets the client fall back to generic wording rather than show a nonsense countdown.
    """
    raw = response.headers.get("retry-after")
    if raw is None:
        return None
    try:
        return max(0, int(float(raw)))
    except (TypeError, ValueError):
        return None


class OpenAICompatibleProvider:
    """OpenAI Chat Completions-compatible transport.

    Serves OpenAI, vLLM, and Ollama alike: they all speak
    ``POST {base_url}/chat/completions`` with Bearer auth when a key exists, a
    ``model``, ``messages``, and ``max_tokens``. Failures — HTTP 401/403, 429,
    timeouts, connection errors, 5xx, malformed responses — are normalized here, at
    the boundary, into Kifu-Sensei's stable commentary error categories so the
    pipeline and routers treat every provider identically.
    """

    def __init__(
        self,
        api_key: str | None,
        *,
        base_url: str | None = None,
        timeout: float = _PROVIDER_TIMEOUT_SECONDS,
    ) -> None:
        base_url = (base_url or DEFAULT_OPENAI_BASE_URL).rstrip("/")
        # Bearer auth only when a credential exists: a local server (Ollama, a
        # development vLLM) may need no key at all.
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.Client(base_url=base_url, headers=headers, timeout=timeout)

    def complete(
        self, *, model: str, max_tokens: int, system_prompt: str, user_prompt: str
    ) -> tuple[str, Any]:
        try:
            response = self._client.post(
                "/chat/completions",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "max_tokens": max_tokens,
                },
            )
        except httpx.TimeoutException as exc:
            raise UpstreamError("The AI provider timed out. Please try again.") from exc
        except httpx.HTTPError as exc:
            raise UpstreamError("The AI provider could not be reached. Please try again.") from exc

        if response.status_code in (401, 403):
            raise UpstreamAuthError("The AI provider rejected this API key.")
        if response.status_code == 429:
            raise UpstreamRateLimitedError(
                "The AI provider is rate-limiting this API key.",
                retry_after=_retry_after_seconds(response),
            )
        if response.status_code != 200:
            # Covers 4xx the user cannot fix and every 5xx.
            raise UpstreamError("The AI provider failed. Please try again.")

        try:
            data = response.json()
        except ValueError as exc:
            raise UpstreamError("The AI provider returned a malformed response.") from exc
        if data.get("error"):
            raise UpstreamError("The AI provider returned an error.")

        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise UpstreamError("The AI provider returned a malformed response.") from exc

        # Normalize OpenAI usage onto the shape the pipeline already accumulates.
        usage = data.get("usage") or {}
        normalized = {
            "input_tokens": usage.get("prompt_tokens") or 0,
            "output_tokens": usage.get("completion_tokens") or 0,
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
        }
        return text, normalized


__all__ = [
    "ClaudeProvider",
    "CommentaryProvider",
    "DEFAULT_OPENAI_BASE_URL",
    "OpenAICompatibleProvider",
]
