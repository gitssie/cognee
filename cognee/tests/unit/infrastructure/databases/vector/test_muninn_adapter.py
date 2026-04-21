from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import NAMESPACE_OID, uuid4, uuid5

import pytest

from cognee.infrastructure.databases.vector.muninn.MuninnAdapter import MuninnAdapter
from cognee.infrastructure.engine import DataPoint


class TestPoint(DataPoint):
    text: str
    metadata: dict = {"index_fields": ["text"]}


class DummyEmbeddingEngine:
    async def embed_text(self, data: list[str]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in data]


class FakeMuninnClient:
    def __init__(self):
        self.vaults: dict[str, dict[str, dict]] = {}
        self.links: list[dict] = []  # recorded link() calls
        self.last_activate_request: dict | None = None

    async def write_batch(self, vault: str = "default", engrams: list[dict] | None = None):
        vault_store = self.vaults.setdefault(vault, {})
        results = []

        for index, engram in enumerate(engrams or []):
            engram_id = engram.get("idempotent_id") or f"{vault}:{index}"
            vault_store[engram_id] = {
                "id": engram_id,
                "concept": engram.get("concept"),
                "content": engram["content"],
                "tags": list(engram.get("tags") or []),
                "type_label": engram.get("type_label"),
            }
            results.append(SimpleNamespace(index=index, id=engram_id, status="ok", error=None))

        return SimpleNamespace(results=results)

    async def list_engrams(self, vault: str = "default", limit: int = 20, offset: int = 0):
        engrams = list(self.vaults.get(vault, {}).values())
        page = engrams[offset : offset + limit]
        return SimpleNamespace(
            engrams=[SimpleNamespace(**engram) for engram in page],
            total=len(engrams),
            limit=limit,
            offset=offset,
        )

    async def list_engrams_by_tag(self, vault: str = "default", tag: str = "", limit: int = 1000):
        all_engrams = list(self.vaults.get(vault, {}).values())
        matched = [e for e in all_engrams if tag in e["tags"]]
        page = matched[:limit]
        return SimpleNamespace(
            engrams=[SimpleNamespace(**e) for e in page],
            total=len(matched),
            limit=limit,
            offset=0,
        )

    async def activate(
        self,
        vault: str = "default",
        context: list[str] | None = None,
        max_results: int = 10,
        threshold: float = 0.0,
        mode: str | None = None,
    ):
        self.last_activate_request = {
            "vault": vault,
            "context": context,
            "max_results": max_results,
            "threshold": threshold,
            "mode": mode,
        }
        query = " ".join(context or []).lower()
        matches = []

        for engram in self.vaults.get(vault, {}).values():
            haystack = (
                f"{engram.get('concept') or ''} {engram['content']} {' '.join(engram['tags'])}"
            ).lower()
            score = 1.0 if query and query in haystack else 0.25
            if score < threshold:
                continue

            matches.append(
                SimpleNamespace(
                    id=engram["id"],
                    concept=engram["concept"],
                    content=engram["content"],
                    score=score,
                    confidence=1.0,
                    type_label=engram["type_label"],
                )
            )

        matches.sort(key=lambda item: item.score, reverse=True)
        return SimpleNamespace(activations=matches[:max_results], total_found=len(matches))

    async def read(self, id: str, vault: str = "default"):
        engram = self.vaults[vault][id]
        return SimpleNamespace(tags=list(engram["tags"]))

    async def forget(self, id: str, vault: str = "default", hard: bool = False):
        self.vaults.get(vault, {}).pop(id, None)
        return True

    async def link(
        self,
        source_id: str,
        target_id: str,
        vault: str,
        rel_type: int = 9,
        weight: float = 0.3,
    ) -> None:
        self.links.append(
            {
                "source_id": source_id,
                "target_id": target_id,
                "vault": vault,
                "rel_type": rel_type,
                "weight": weight,
            }
        )

    async def list_vaults(self):
        return list(self.vaults.keys())


@pytest.mark.asyncio
async def test_muninn_adapter_create_search_retrieve_and_delete(monkeypatch):
    fake_client = FakeMuninnClient()
    adapter = MuninnAdapter(
        url="http://localhost:8476",
        api_key="token",
        embedding_engine=DummyEmbeddingEngine(),
        database_name="dataset-test",
    )

    @asynccontextmanager
    async def fake_client_context():
        yield fake_client

    monkeypatch.setattr(adapter, "_client", fake_client_context)

    point_a = TestPoint(text="Quantum computing basics", belongs_to_set=["science"])
    point_b = TestPoint(text="Natural language processing guide", belongs_to_set=["language"])

    await adapter.create_data_points("DocumentChunk_text", [point_a, point_b])

    stored_engrams = list(fake_client.vaults[adapter._vault_name("DocumentChunk_text")].values())
    assert all(engram["concept"] == "TestPoint" for engram in stored_engrams)
    assert all(engram["type_label"] is None for engram in stored_engrams)

    retrieved = await adapter.retrieve("DocumentChunk_text", [str(point_a.id), str(point_b.id)])
    assert {str(item.id) for item in retrieved} == {str(point_a.id), str(point_b.id)}
    assert {item.payload["text"] for item in retrieved} == {
        "Quantum computing basics",
        "Natural language processing guide",
    }
    assert all(item.payload["concept"] == "TestPoint" for item in retrieved)
    assert all("type" not in item.payload for item in retrieved)

    search_results = await adapter.search(
        "DocumentChunk_text",
        query_text="Quantum",
        query_vector=None,
        limit=1,
        include_payload=True,
    )
    assert len(search_results) == 1
    assert str(search_results[0].id) == str(point_a.id)
    assert search_results[0].payload["text"] == "Quantum computing basics"
    assert search_results[0].payload["belongs_to_set"] == ["science"]
    assert search_results[0].score == pytest.approx(1.0)
    assert fake_client.last_activate_request == {
        "vault": adapter._vault_name("DocumentChunk_text"),
        "context": ["Quantum"],
        "max_results": 1,
        "threshold": None,
        "mode": "balanced",
    }

    filtered_results = await adapter.search(
        "DocumentChunk_text",
        query_text="guide",
        query_vector=None,
        limit=None,
        include_payload=True,
        node_name=["language"],
    )
    assert len(filtered_results) == 1
    assert str(filtered_results[0].id) == str(point_b.id)


@pytest.mark.asyncio
async def test_muninn_adapter_passes_explicit_recall_mode_and_threshold(monkeypatch):
    fake_client = FakeMuninnClient()
    adapter = MuninnAdapter(
        url="http://localhost:8476",
        api_key="token",
        embedding_engine=DummyEmbeddingEngine(),
        database_name="dataset-test",
    )

    @asynccontextmanager
    async def fake_client_context():
        yield fake_client

    monkeypatch.setattr(adapter, "_client", fake_client_context)

    point = TestPoint(text="Recent memory", belongs_to_set=["timeline"])
    await adapter.create_data_points("DocumentChunk_text", [point])

    await adapter.search(
        "DocumentChunk_text",
        query_text="Recent",
        limit=5,
        include_payload=True,
        recall_mode="recent",
        threshold=0.15,
    )

    assert fake_client.last_activate_request == {
        "vault": adapter._vault_name("DocumentChunk_text"),
        "context": ["Recent"],
        "max_results": 5,
        "threshold": 0.15,
        "mode": "recent",
    }

    await adapter.delete_data_points("DocumentChunk_text", [str(point_a.id)])

    remaining = await adapter.retrieve("DocumentChunk_text", [str(point_a.id), str(point_b.id)])
    assert [str(item.id) for item in remaining] == [str(point_b.id)]


@pytest.mark.asyncio
async def test_muninn_adapter_data_id_tag_and_bulk_delete(monkeypatch):
    """Engrams written with a data_id carry the data: tag, and
    delete_data_points_by_data_id removes exactly those engrams."""

    fake_client = FakeMuninnClient()
    adapter = MuninnAdapter(
        url="http://localhost:8476",
        api_key="token",
        embedding_engine=DummyEmbeddingEngine(),
        database_name="test",
    )

    @asynccontextmanager
    async def fake_client_context():
        yield fake_client

    monkeypatch.setattr(adapter, "_client", fake_client_context)

    pdf_data_id = uuid4()
    other_data_id = uuid4()

    # Three engrams belonging to the PDF under deletion.
    pdf_chunks = [TestPoint(text=f"PDF chunk {i}", data_id=pdf_data_id) for i in range(3)]
    # One engram from a different document — must not be deleted.
    other_chunk = TestPoint(text="Other document chunk", data_id=other_data_id)

    collection = "DocumentChunk_text"
    await adapter.create_data_points(collection, pdf_chunks + [other_chunk])

    vault = adapter._vault_name(collection)
    all_engrams = list(fake_client.vaults[vault].values())

    # Verify data: tags were written.
    pdf_tag = f"data:{pdf_data_id}"
    other_tag = f"data:{other_data_id}"
    for chunk in pdf_chunks:
        engram_id = f"{vault}:{vault}:{chunk.id}"
        tagged = any(pdf_tag in e["tags"] for e in all_engrams if e["id"] == f"{vault}:{chunk.id}")
        assert tagged, f"Expected data tag '{pdf_tag}' on engram for chunk {chunk.id}"

    # Delete all PDF engrams by data_id.
    await adapter.delete_data_points_by_data_id(collection, pdf_data_id)

    remaining = list(fake_client.vaults[vault].values())

    # PDF engrams are gone.
    remaining_tags = [tag for e in remaining for tag in e["tags"]]
    assert pdf_tag not in remaining_tags, "PDF engrams should have been deleted"

    # Other-document engram is still present.
    assert any(other_tag in e["tags"] for e in remaining), (
        "Other document's engram should NOT have been deleted"
    )
    assert len(remaining) == 1


@pytest.mark.asyncio
async def test_chunk_sequence_links_written(monkeypatch):
    """create_chunk_sequence_links writes followed_by and preceded_by links
    between consecutive DocumentChunk engrams, and skips the last chunk's
    forward reference (next_chunk_id=None)."""
    from cognee.modules.chunking.models.DocumentChunk import DocumentChunk
    from cognee.modules.data.processing.document_types.Document import Document

    fake_client = FakeMuninnClient()
    adapter = MuninnAdapter(
        url="http://localhost:8476",
        api_key="token",
        embedding_engine=DummyEmbeddingEngine(),
        database_name="test",
    )

    @asynccontextmanager
    async def fake_client_context():
        yield fake_client

    monkeypatch.setattr(adapter, "_client", fake_client_context)

    doc_id = uuid4()
    doc = Document(
        id=doc_id,
        name="test.pdf",
        raw_data_location="/tmp/test.pdf",
        external_metadata=None,
        mime_type="application/pdf",
    )

    def pos_id(idx: int):
        return uuid5(NAMESPACE_OID, f"{doc_id}-{idx}")

    # Three chunks: 0 → 1 → 2 (last has next_chunk_id=None)
    chunk0 = DocumentChunk(
        id=pos_id(0),
        text="First chunk",
        chunk_size=11,
        is_part_of=doc,
        chunk_index=0,
        cut_type="paragraph",
        contains=[],
        previous_chunk_id=None,
        next_chunk_id=pos_id(1),
        metadata={"index_fields": ["text"]},
    )
    chunk1 = DocumentChunk(
        id=pos_id(1),
        text="Second chunk",
        chunk_size=12,
        is_part_of=doc,
        chunk_index=1,
        cut_type="paragraph",
        contains=[],
        previous_chunk_id=pos_id(0),
        next_chunk_id=pos_id(2),
        metadata={"index_fields": ["text"]},
    )
    chunk2 = DocumentChunk(
        id=pos_id(2),
        text="Third chunk",
        chunk_size=11,
        is_part_of=doc,
        chunk_index=2,
        cut_type="paragraph",
        contains=[],
        previous_chunk_id=pos_id(1),
        next_chunk_id=None,  # Last chunk — no successor.
        metadata={"index_fields": ["text"]},
    )

    collection = "DocumentChunk_text"
    await adapter.create_data_points(collection, [chunk0, chunk1, chunk2])

    # No links yet.
    assert fake_client.links == []

    await adapter.create_chunk_sequence_links(collection, [chunk0, chunk1, chunk2])

    # chunk0→chunk1 and chunk1→chunk0 (preceded_by), plus chunk1→chunk2 and chunk2→chunk1.
    # chunk2 has next_chunk_id=None so NO link from chunk2 onward.
    assert len(fake_client.links) == 4

    vault = adapter._vault_name(collection)

    # Build a set of (source_cognee_id, target_cognee_id, rel_type) for assertion.
    def cognee_id_for(ulid: str) -> str:
        """Reverse-map muninndb ULID back to the cognee UUID via tags."""
        engram = fake_client.vaults[vault].get(ulid)
        if engram is None:
            return ulid
        for tag in engram["tags"]:
            if tag.startswith("cognee:id:"):
                return tag[len("cognee:id:") :]
        return ulid

    link_set = {
        (cognee_id_for(lnk["source_id"]), cognee_id_for(lnk["target_id"]), lnk["rel_type"])
        for lnk in fake_client.links
    }

    assert (str(pos_id(0)), str(pos_id(1)), 9) in link_set, "chunk0 → chunk1 followed_by missing"
    assert (str(pos_id(1)), str(pos_id(0)), 8) in link_set, "chunk1 → chunk0 preceded_by missing"
    assert (str(pos_id(1)), str(pos_id(2)), 9) in link_set, "chunk1 → chunk2 followed_by missing"
    assert (str(pos_id(2)), str(pos_id(1)), 8) in link_set, "chunk2 → chunk1 preceded_by missing"

    # Verify no link involves pos_id(3) (non-existent next of the last chunk).
    str_pos3 = str(pos_id(3))
    for lnk in fake_client.links:
        assert cognee_id_for(lnk["source_id"]) != str_pos3
        assert cognee_id_for(lnk["target_id"]) != str_pos3


@pytest.mark.asyncio
async def test_muninn_adapter_rejects_oversized_content_before_write(monkeypatch):
    fake_client = FakeMuninnClient()
    adapter = MuninnAdapter(
        url="http://localhost:8476",
        api_key="token",
        embedding_engine=DummyEmbeddingEngine(),
        database_name="dataset-test",
    )

    @asynccontextmanager
    async def fake_client_context():
        yield fake_client

    monkeypatch.setattr(adapter, "_client", fake_client_context)

    oversized = TestPoint(text="x" * 16385)

    with pytest.raises(RuntimeError, match="content exceeds max length 16384"):
        await adapter.create_data_points("DocumentChunk_text", [oversized])
