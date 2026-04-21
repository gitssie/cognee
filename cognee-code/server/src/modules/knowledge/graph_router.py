from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.data.methods import get_authorized_existing_datasets
from cognee.modules.users.methods import get_authenticated_user
from cognee.modules.users.models import DatasetDatabase, User


@dataclass
class MuninnEntityNode:
    id: str
    type: str | None = None


@dataclass
class MuninnEntityEdge:
    from_id: str
    to_id: str
    rel_type: str
    weight: float


class GraphNodeDTO(BaseModel):
    id: str
    label: str
    type: str


class GraphEdgeDTO(BaseModel):
    source: str
    target: str
    label: str
    weight: float


class DatasetGraphDTO(BaseModel):
    nodes: list[GraphNodeDTO]
    edges: list[GraphEdgeDTO]


async def _get_dataset_database(dataset_id: UUID, user: User) -> DatasetDatabase | None:
    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        stmt = select(DatasetDatabase).where(
            DatasetDatabase.dataset_id == dataset_id,
            DatasetDatabase.owner_id == user.id,
        )
        return await session.scalar(stmt)


async def _fetch_muninn_entity_graph(dataset_db: DatasetDatabase) -> DatasetGraphDTO:
    base_url = str(dataset_db.vector_database_url or "").rstrip("/")
    if not base_url:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Muninn vector database URL is not configured for this dataset.",
        )

    vault_name = str(dataset_db.vector_database_name or "").strip()
    if not vault_name:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Muninn vault name is not configured for this dataset.",
        )

    api_url = f"{base_url}/api/admin/entity-graph"
    headers: dict[str, str] = {}
    api_key = str(dataset_db.vector_database_key or "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(headers=headers, timeout=timeout) as session:
        async with session.get(api_url, params={"vault": vault_name}) as response:
            if response.status == status.HTTP_401_UNAUTHORIZED:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Muninn vault key is missing or invalid for entity graph access.",
                )
            if response.status >= 400:
                detail = await response.text()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Muninn entity graph request failed: {detail}",
                )
            payload = await response.json()

    raw_nodes = payload.get("nodes") or []
    raw_edges = payload.get("edges") or []

    nodes = [
        GraphNodeDTO(
            id=str(item.get("id", "")),
            label=str(item.get("id", "")),
            type=str(item.get("type") or "entity"),
        )
        for item in raw_nodes
        if item.get("id")
    ]
    edges = [
        GraphEdgeDTO(
            source=str(item.get("from", "")),
            target=str(item.get("to", "")),
            label=str(item.get("rel_type") or "related"),
            weight=float(item.get("weight") or 0.0),
        )
        for item in raw_edges
        if item.get("from") and item.get("to")
    ]
    return DatasetGraphDTO(nodes=nodes, edges=edges)


def get_graph_router() -> APIRouter:
    router = APIRouter()

    @router.get("/{dataset_id}/graph", response_model=DatasetGraphDTO)
    async def get_dataset_graph(
        dataset_id: UUID,
        user: User = Depends(get_authenticated_user),
    ) -> DatasetGraphDTO:
        authorized = await get_authorized_existing_datasets([dataset_id], "read", user)
        if not authorized:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dataset {dataset_id} not found or insufficient permissions.",
            )

        dataset_db = await _get_dataset_database(dataset_id, user)
        if dataset_db is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Dataset database binding was not found for this dataset.",
            )

        if str(dataset_db.vector_database_provider).lower() != "muninn":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Dataset graph visualization currently supports Muninn only.",
            )

        return await _fetch_muninn_entity_graph(dataset_db)

    return router
