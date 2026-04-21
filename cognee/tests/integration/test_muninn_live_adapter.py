import os
import time

import pytest

from cognee.infrastructure.databases.vector.muninn.MuninnAdapter import MuninnAdapter
from cognee.infrastructure.databases.vector.muninn.MuninnRestClient import MuninnRestClient
from cognee.infrastructure.engine import DataPoint


def has_muninn_live_config() -> bool:
    return bool(os.getenv("MUNINN_BASE_URL") and os.getenv("MUNINN_API_KEY"))


class TestPoint(DataPoint):
    text: str
    metadata: dict = {"index_fields": ["text"]}


class DummyEmbeddingEngine:
    async def embed_text(self, data: list[str]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in data]


@pytest.mark.asyncio
@pytest.mark.skipif(not has_muninn_live_config(), reason="No live Muninn config available")
async def test_muninn_live_adapter_uses_isolated_vault_prefix():
    base_url = os.environ["MUNINN_BASE_URL"]
    api_key = os.environ["MUNINN_API_KEY"]
    database_name = f"test-live-{int(time.time() * 1000)}"
    collection_name = "DocumentChunk_text"

    adapter = MuninnAdapter(
        url=base_url,
        api_key=api_key,
        embedding_engine=DummyEmbeddingEngine(),
        database_name=database_name,
    )

    point_a = TestPoint(text="Muninn live quantum note", belongs_to_set=["live-test-a"])
    point_b = TestPoint(text="Muninn live language note", belongs_to_set=["live-test-b"])

    await adapter.create_data_points(collection_name, [point_a, point_b])

    retrieved = await adapter.retrieve(collection_name, [str(point_a.id), str(point_b.id)])
    assert {str(item.id) for item in retrieved} == {str(point_a.id), str(point_b.id)}

    search_results = await adapter.search(
        collection_name,
        query_text="quantum",
        query_vector=None,
        limit=2,
        include_payload=True,
    )
    assert any(str(item.id) == str(point_a.id) for item in search_results)

    await adapter.delete_data_points(collection_name, [point_a.id, point_b.id])

    remaining = await adapter.retrieve(collection_name, [str(point_a.id), str(point_b.id)])
    assert remaining == []

    async with MuninnRestClient(base_url=base_url, api_key=api_key) as client:
        vaults = await client.list_vaults()

    assert "default" in vaults
    assert any(vault.startswith(database_name) for vault in vaults)
    assert all(vault == "default" or not vault.startswith("dataset-") for vault in ["default"])
