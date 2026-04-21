from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import aiohttp


@dataclass
class MuninnBatchWriteResult:
    index: int
    status: str
    id: str | None = None
    error: str | None = None


@dataclass
class MuninnBatchWriteResponse:
    results: list[MuninnBatchWriteResult]


@dataclass
class MuninnActivationItem:
    id: str
    concept: str | None
    content: str
    score: float
    confidence: float = 0.0
    type_label: str | None = None


@dataclass
class MuninnActivateResponse:
    activations: list[MuninnActivationItem]
    total_found: int = 0


@dataclass
class MuninnReadResponse:
    id: str
    concept: str | None
    content: str
    tags: list[str]
    confidence: float = 0.0
    relevance: float = 0.0
    stability: float = 0.0
    access_count: int = 0
    state: Any = None
    created_at: int = 0
    updated_at: int = 0
    last_access: int | None = None


@dataclass
class MuninnEngramItem:
    id: str
    concept: str | None
    content: str
    tags: list[str]
    type_label: str | None = None


@dataclass
class MuninnListEngramsResponse:
    engrams: list[MuninnEngramItem]
    total: int
    limit: int
    offset: int


class MuninnRestError(RuntimeError):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(message)


class MuninnRestClient:
    def __init__(self, base_url: str, api_key: str | None, timeout: float = 10.0):
        normalized_url = base_url.rstrip("/")
        if not normalized_url.endswith("/api"):
            normalized_url = f"{normalized_url}/api"

        self.base_url = normalized_url
        self.api_key = api_key
        self.timeout = timeout
        self._session: aiohttp.ClientSession | None = None

    async def __aenter__(self) -> MuninnRestClient:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        self._session = aiohttp.ClientSession(
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=self.timeout),
        )
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def list_vaults(self) -> list[str]:
        response = await self._request("GET", "/vaults")
        if isinstance(response, list):
            return [vault for vault in response if isinstance(vault, str)]
        return response.get("vaults", [])

    async def list_engrams(
        self, vault: str, limit: int = 20, offset: int = 0
    ) -> MuninnListEngramsResponse:
        response = await self._request(
            "GET",
            "/engrams",
            params={"vault": vault, "limit": str(limit), "offset": str(offset)},
        )

        return MuninnListEngramsResponse(
            engrams=[
                MuninnEngramItem(
                    id=item.get("id", ""),
                    concept=item.get("concept"),
                    content=item.get("content", ""),
                    tags=item.get("tags") or [],
                    type_label=item.get("type_label"),
                )
                for item in response.get("engrams", [])
            ],
            total=response.get("total", 0),
            limit=response.get("limit", limit),
            offset=response.get("offset", offset),
        )

    async def list_engrams_by_tag(
        self, vault: str, tag: str, limit: int = 1000
    ) -> MuninnListEngramsResponse:
        """Return all engrams in a vault that match the given tag (AND filter)."""
        response = await self._request(
            "GET",
            "/engrams",
            params={"vault": vault, "limit": str(limit), "offset": "0", "tags": tag},
        )

        return MuninnListEngramsResponse(
            engrams=[
                MuninnEngramItem(
                    id=item.get("id", ""),
                    concept=item.get("concept"),
                    content=item.get("content", ""),
                    tags=item.get("tags") or [],
                    type_label=item.get("type_label"),
                )
                for item in response.get("engrams", [])
            ],
            total=response.get("total", 0),
            limit=response.get("limit", limit),
            offset=response.get("offset", 0),
        )

    async def write_batch(
        self, vault: str, engrams: list[dict[str, Any]]
    ) -> MuninnBatchWriteResponse:
        sanitized_engrams = []
        for engram in engrams:
            sanitized_engrams.append(
                {
                    key: value
                    for key, value in engram.items()
                    if key
                    in {
                        "vault",
                        "concept",
                        "content",
                        "tags",
                        "confidence",
                        "stability",
                        "memory_type",
                        "type_label",
                        "summary",
                        "entities",
                        "relationships",
                        "idempotent_id",
                    }
                    and value is not None
                }
            )

        try:
            response = await self._request(
                "POST",
                "/engrams/batch",
                params={"vault": vault},
                json={"vault": vault, "engrams": sanitized_engrams},
            )
            return MuninnBatchWriteResponse(
                results=[
                    MuninnBatchWriteResult(
                        index=result.get("index", index),
                        id=result.get("id"),
                        status=result.get("status", "error"),
                        error=result.get("error"),
                    )
                    for index, result in enumerate(response.get("results", []))
                ]
            )
        except MuninnRestError as error:
            if self._is_invalid_vault_body_error(error):
                return await self._write_individually(vault, sanitized_engrams)

            if error.status_code not in {404, 405}:
                raise

        return await self._write_individually(vault, sanitized_engrams)

    def _is_invalid_vault_body_error(self, error: MuninnRestError) -> bool:
        return error.status_code == 400 and (
            "INVALID_VAULT_REQUEST" in str(error)
            or "failed to read request body for vault routing" in str(error)
        )

    async def _write_individually(
        self, vault: str, sanitized_engrams: list[dict[str, Any]]
    ) -> MuninnBatchWriteResponse:
        results: list[MuninnBatchWriteResult] = []
        for index, engram in enumerate(sanitized_engrams):
            try:
                response = await self._request(
                    "POST",
                    "/engrams",
                    params={"vault": engram.get("vault", vault)},
                    json=engram,
                )
                results.append(
                    MuninnBatchWriteResult(
                        index=index,
                        id=response.get("id"),
                        status="ok",
                    )
                )
            except MuninnRestError as error:
                results.append(
                    MuninnBatchWriteResult(
                        index=index,
                        status="error",
                        error=str(error),
                    )
                )

        return MuninnBatchWriteResponse(results=results)

    async def activate(
        self,
        vault: str,
        context: list[str],
        max_results: int,
        threshold: float | None = None,
        mode: str | None = None,
    ) -> MuninnActivateResponse:
        payload = {
            "vault": vault,
            "context": context,
            "max_results": max_results,
        }
        if threshold is not None:
            payload["threshold"] = threshold
        if mode:
            payload["mode"] = mode

        response = await self._request(
            "POST",
            "/activate",
            params={"vault": vault},
            json=payload,
        )

        return MuninnActivateResponse(
            activations=[
                MuninnActivationItem(
                    id=item.get("id", ""),
                    concept=item.get("concept"),
                    content=item.get("content", ""),
                    score=float(item.get("score", 0.0)),
                    confidence=float(item.get("confidence", 0.0)),
                    type_label=item.get("type_label"),
                )
                for item in response.get("activations", [])
            ],
            total_found=response.get("total_found", 0),
        )

    async def read(self, id: str, vault: str) -> MuninnReadResponse:
        response = await self._request("GET", f"/engrams/{id}", params={"vault": vault})
        return MuninnReadResponse(
            id=response.get("id", ""),
            concept=response.get("concept"),
            content=response.get("content", ""),
            tags=response.get("tags") or [],
            confidence=float(response.get("confidence", 0.0)),
            relevance=float(response.get("relevance", 0.0)),
            stability=float(response.get("stability", 0.0)),
            access_count=int(response.get("access_count", 0)),
            state=response.get("state"),
            created_at=int(response.get("created_at", 0)),
            updated_at=int(response.get("updated_at", 0)),
            last_access=response.get("last_access"),
        )

    async def link(
        self,
        source_id: str,
        target_id: str,
        vault: str,
        rel_type: int = 9,
        weight: float = 0.3,
    ) -> None:
        """Create or strengthen a directional association between two engrams.

        rel_type 9 = RelFollowedBy (chunk N → chunk N+1).
        rel_type 8 = RelPrecededBy (chunk N ← chunk N+1).
        """
        await self._request(
            "POST",
            "/link",
            json={
                "source_id": source_id,
                "target_id": target_id,
                "rel_type": rel_type,
                "weight": weight,
                "vault": vault,
            },
        )

    async def forget(self, id: str, vault: str, hard: bool = False) -> bool:
        if hard:
            await self._request(
                "POST",
                f"/engrams/{id}/forget",
                params={"vault": vault, "hard": "true"},
            )
            return True

        await self._request("DELETE", f"/engrams/{id}", params={"vault": vault})
        return True

    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        if self._session is None:
            raise RuntimeError("MuninnRestClient must be used within an async context manager.")

        async with self._session.request(
            method,
            f"{self.base_url}{path}",
            params=params,
            json=json,
        ) as response:
            if response.status >= 400:
                raise MuninnRestError(response.status, await response.text())

            if response.status == 204:
                return {}

            return await response.json()
