import os
import sys
import time
import uuid
from pathlib import Path

import pytest
from unittest.mock import patch

from cognee.api.v1.cognify.cognify import (
    MUNINN_DEFAULT_CHUNK_SIZE,
    MUNINN_MAX_ENGRAM_CONTENT_LENGTH,
    MuninnTextChunker,
)
from cognee.infrastructure.databases.vector.muninn.MuninnAdapter import MuninnAdapter
from cognee.infrastructure.databases.vector.muninn.MuninnRestClient import MuninnRestClient
from cognee.modules.data.processing.document_types.PdfDocument import PdfDocument
from cognee.tests.integration.documents.AudioDocument_test import mock_get_embedding_engine


chunk_by_sentence_module = sys.modules.get("cognee.tasks.chunks.chunk_by_sentence")


def has_muninn_live_config() -> bool:
    return bool(os.getenv("MUNINN_BASE_URL") and os.getenv("MUNINN_API_KEY"))


class DummyEmbeddingEngine:
    async def embed_text(self, data: list[str]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in data]


@patch.object(
    chunk_by_sentence_module, "get_embedding_engine", side_effect=mock_get_embedding_engine
)
@pytest.mark.asyncio
@pytest.mark.skipif(not has_muninn_live_config(), reason="No live Muninn config available")
async def test_muninn_live_pdf_ingest_writes_and_queries_engrams(mock_engine):
    pdf_path = (
        Path(__file__).resolve().parent.parent.parent.parent
        / "cognee-code"
        / "docs"
        / "1802.10233v1.pdf"
    )
    vault_name = f"test-live-pdf-{int(time.time() * 1000)}"
    collection_name = "DocumentChunk_text"

    document = PdfDocument(
        id=uuid.uuid4(),
        name=pdf_path.name,
        raw_data_location=str(pdf_path),
        external_metadata="",
        mime_type="application/pdf",
    )

    chunks = [
        chunk
        async for chunk in document.read(
            chunker_cls=MuninnTextChunker,
            max_chunk_size=MUNINN_DEFAULT_CHUNK_SIZE,
            max_text_length=MUNINN_MAX_ENGRAM_CONTENT_LENGTH,
        )
    ]

    assert chunks, "Expected PDF ingestion to produce chunks before writing to Muninn"

    adapter = MuninnAdapter(
        url=os.environ["MUNINN_BASE_URL"],
        api_key=os.environ["MUNINN_API_KEY"],
        embedding_engine=DummyEmbeddingEngine(),
        database_name=vault_name,
    )

    await adapter.create_data_points(collection_name, chunks)
    await adapter.create_chunk_sequence_links(collection_name, chunks)

    async with MuninnRestClient(
        base_url=os.environ["MUNINN_BASE_URL"], api_key=os.environ["MUNINN_API_KEY"]
    ) as client:
        page = await client.list_engrams(vault=vault_name, limit=10, offset=0)
        activation = await client.activate(
            vault=vault_name,
            context=["bert transformer"],
            max_results=5,
            threshold=0.0,
        )

    assert page.total == len(chunks)
    assert page.engrams, "Expected Muninn list_engrams to return inserted chunks"
    assert any("bert" in engram.content.lower() for engram in page.engrams)
    assert activation.activations, "Expected Muninn activate to return matching engrams"
    assert any("bert" in item.content.lower() for item in activation.activations)
    assert all(
        len(engram.content.encode("utf-8")) <= MUNINN_MAX_ENGRAM_CONTENT_LENGTH
        for engram in page.engrams
    )
