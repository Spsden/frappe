"""OpenAI-compatible embedding and executive-summary provider for analytics."""

from __future__ import annotations

import json
from typing import Any

import openai
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from worktrace_api.schemas import AnalyticsResult
from worktrace_api.settings import Settings
from worktrace_api.workflow_analytics import EMBEDDING_DIMENSIONS


class AnalyticsProviderError(Exception):
    pass


class AnalyticsProviderUnavailable(AnalyticsProviderError):
    pass


class _ExecutiveSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sentences: list[str] = Field(min_length=3, max_length=3)


class AnalyticsProvider:
    """One provider boundary for analytics; orchestration never touches the SDK."""

    def __init__(
        self,
        settings: Settings,
        *,
        base_url: str | None = None,
        chat_model: str | None = None,
        api_key: str | None = None,
        embedding_model: str | None = None,
    ):
        self.base_url = base_url or settings.openai_base_url
        self.chat_model = chat_model or settings.openai_model
        self.api_key = api_key or settings.openai_api_key
        configured_embedding = embedding_model or settings.analytics_embedding_model
        self.embedding_model = self._provider_embedding_model(configured_embedding)

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def embed(self, texts: list[str], batch_size: int = 128) -> list[list[float]]:
        if not texts:
            return []
        client = self._client()
        embeddings: list[list[float]] = []
        try:
            for start in range(0, len(texts), batch_size):
                response = client.embeddings.create(
                    model=self.embedding_model,
                    input=texts[start : start + batch_size],
                    dimensions=EMBEDDING_DIMENSIONS,
                    extra_headers=self._headers(),
                )
                ordered = sorted(response.data, key=lambda item: item.index)
                embeddings.extend([list(item.embedding) for item in ordered])
        except Exception as exc:
            raise AnalyticsProviderError("Embedding request failed") from exc
        if len(embeddings) != len(texts):
            raise AnalyticsProviderError("Embedding provider returned an incomplete batch")
        if any(len(vector) != EMBEDDING_DIMENSIONS for vector in embeddings):
            raise AnalyticsProviderError(
                f"Embedding provider must return {EMBEDDING_DIMENSIONS} dimensions"
            )
        return embeddings

    def summarize(self, workflow_name: str, result: AnalyticsResult) -> list[str]:
        client = self._client()
        aggregate = {
            "workflow_name": workflow_name,
            "overview": result.overview.model_dump(mode="json"),
            "completion_ranking": [
                item.model_dump(mode="json") for item in result.completion_ranking
            ],
            "fastest_vs_average": [
                item.model_dump(mode="json") for item in result.fastest_vs_average
            ],
        }
        try:
            response = client.chat.completions.create(
                model=self.chat_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You explain workflow comparison evidence to an executive. "
                            "Return strict JSON with a `sentences` array containing exactly "
                            "three plain-English sentences: what was compared, the clearest "
                            "time/path difference, and one evidence-based opportunity. Do not "
                            "claim causation, rank employees, or invent facts."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(aggregate, separators=(",", ":")),
                    },
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
                max_tokens=500,
                extra_headers=self._headers(),
            )
        except Exception as exc:
            raise AnalyticsProviderError("Executive summary request failed") from exc
        if not response.choices or not response.choices[0].message.content:
            raise AnalyticsProviderError("Executive summary provider returned no content")
        try:
            parsed = _ExecutiveSummary.model_validate_json(
                response.choices[0].message.content
            )
        except ValidationError as exc:
            raise AnalyticsProviderError("Executive summary did not match its schema") from exc
        sentences = [sentence.strip() for sentence in parsed.sentences]
        if any(not sentence or len(sentence) > 500 for sentence in sentences):
            raise AnalyticsProviderError("Executive summary contained an invalid sentence")
        return sentences

    def _client(self) -> openai.OpenAI:
        if not self.available:
            raise AnalyticsProviderUnavailable("No LLM API key is configured for analytics")
        return openai.OpenAI(base_url=self.base_url, api_key=self.api_key)

    def _headers(self) -> dict[str, Any] | None:
        if "openrouter.ai" not in self.base_url:
            return None
        return {
            "HTTP-Referer": "https://worktrace.ai",
            "X-Title": "WorkTrace",
        }

    def _provider_embedding_model(self, configured: str) -> str:
        if "openrouter.ai" in self.base_url and "/" not in configured:
            return f"openai/{configured}"
        return configured
