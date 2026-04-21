import pytest
from uuid import uuid4

from cognee.api.v1.cognify.cognify import (
    MUNINN_ASCII_HEAVY_CHUNK_SIZE,
    MUNINN_DEFAULT_CHUNK_SIZE,
    MUNINN_DEFAULT_CHUNK_OVERLAP_RATIO,
    MUNINN_MAX_ENGRAM_CONTENT_LENGTH,
    MuninnTextChunker,
    _get_muninn_adaptive_chunk_size,
    get_default_tasks,
    get_temporal_tasks,
)
from cognee.modules.chunking.TextChunker import TextChunker
from cognee.modules.chunking.text_chunker_with_overlap import TextChunkerWithOverlap
from cognee.modules.data.processing.document_types import Document


@pytest.mark.asyncio
async def test_get_default_tasks_uses_muninn_pipeline_branch():
    tasks = await get_default_tasks(vector_db_config={"vector_db_provider": "muninn"})

    assert [task.executable.__name__ for task in tasks] == [
        "classify_documents",
        "extract_chunks_from_documents",
        "index_data_points",
    ]

    chunk_task = tasks[1]
    assert chunk_task.default_params["kwargs"]["max_chunk_size"] == MUNINN_DEFAULT_CHUNK_SIZE
    assert (
        chunk_task.default_params["kwargs"]["max_text_length"] == MUNINN_MAX_ENGRAM_CONTENT_LENGTH
    )
    assert chunk_task.default_params["kwargs"]["chunker"] is MuninnTextChunker


@pytest.mark.asyncio
async def test_get_temporal_tasks_uses_muninn_pipeline_branch():
    tasks = await get_temporal_tasks(vector_db_config={"vector_db_provider": "muninn"})

    assert [task.executable.__name__ for task in tasks] == [
        "classify_documents",
        "extract_chunks_from_documents",
        "index_data_points",
    ]

    chunk_task = tasks[1]
    assert chunk_task.default_params["kwargs"]["max_chunk_size"] == MUNINN_DEFAULT_CHUNK_SIZE
    assert (
        chunk_task.default_params["kwargs"]["max_text_length"] == MUNINN_MAX_ENGRAM_CONTENT_LENGTH
    )
    assert chunk_task.default_params["kwargs"]["chunker"] is MuninnTextChunker


@pytest.mark.asyncio
async def test_get_default_tasks_preserves_explicit_muninn_chunk_size():
    tasks = await get_default_tasks(
        vector_db_config={"vector_db_provider": "muninn"},
        chunk_size=256,
    )

    chunk_task = tasks[1]
    assert chunk_task.default_params["kwargs"]["max_chunk_size"] == 256
    assert (
        chunk_task.default_params["kwargs"]["max_text_length"] == MUNINN_MAX_ENGRAM_CONTENT_LENGTH
    )
    assert chunk_task.default_params["kwargs"]["chunker"] is MuninnTextChunker


def test_muninn_text_chunker_uses_small_default_overlap():
    chunker = MuninnTextChunker(document=None, get_text=lambda: None, max_chunk_size=1000)

    assert issubclass(MuninnTextChunker, TextChunkerWithOverlap)
    assert chunker.chunk_overlap_ratio == MUNINN_DEFAULT_CHUNK_OVERLAP_RATIO
    assert chunker.chunk_overlap == int(1000 * MUNINN_DEFAULT_CHUNK_OVERLAP_RATIO)


def test_get_muninn_adaptive_chunk_size_keeps_default_for_cjk_text():
    assert _get_muninn_adaptive_chunk_size("这是一本中文小说，包含大量汉字内容。", 4096) == 4096


def test_get_muninn_adaptive_chunk_size_increases_for_ascii_heavy_text():
    english_text = "Apache Calcite is a dynamic data management framework. " * 20
    assert (
        _get_muninn_adaptive_chunk_size(english_text, MUNINN_DEFAULT_CHUNK_SIZE)
        == MUNINN_ASCII_HEAVY_CHUNK_SIZE
    )


@pytest.mark.asyncio
async def test_get_default_tasks_preserves_custom_chunker_for_muninn():
    tasks = await get_default_tasks(
        vector_db_config={"vector_db_provider": "muninn"},
        chunker=TextChunkerWithOverlap,
    )

    assert tasks[1].default_params["kwargs"]["chunker"] is TextChunkerWithOverlap


@pytest.mark.asyncio
async def test_get_default_tasks_replaces_plain_text_chunker_for_muninn():
    tasks = await get_default_tasks(
        vector_db_config={"vector_db_provider": "muninn"},
        chunker=TextChunker,
    )

    assert tasks[1].default_params["kwargs"]["chunker"] is MuninnTextChunker


@pytest.mark.asyncio
async def test_get_default_tasks_preserves_explicit_muninn_overlap_and_text_limit():
    tasks = await get_default_tasks(
        vector_db_config={"vector_db_provider": "muninn"},
        chunk_overlap_ratio=0.12,
        max_text_length=12000,
    )

    chunk_task = tasks[1]
    chunker_cls = chunk_task.default_params["kwargs"]["chunker"]
    configured_chunker = chunker_cls(document=None, get_text=lambda: None, max_chunk_size=1000)

    assert chunk_task.default_params["kwargs"]["max_text_length"] == 12000
    assert configured_chunker.chunk_overlap_ratio == 0.12
    assert configured_chunker.chunk_overlap == 120


@pytest.mark.asyncio
async def test_muninn_text_chunker_respects_max_text_length_with_overlap():
    text = "甲" * 20000
    document = Document(
        id=uuid4(),
        name="test_document",
        raw_data_location="/test/path",
        external_metadata=None,
        mime_type="text/plain",
    )

    async def get_text():
        yield text

    chunker = MuninnTextChunker(document, get_text, max_chunk_size=MUNINN_DEFAULT_CHUNK_SIZE)
    chunker.max_text_length = MUNINN_MAX_ENGRAM_CONTENT_LENGTH

    chunks = [chunk async for chunk in chunker.read()]

    assert len(chunks) > 1
    assert all(
        len(chunk.text.encode("utf-8")) <= MUNINN_MAX_ENGRAM_CONTENT_LENGTH for chunk in chunks
    )
    assert "".join(chunk.text for chunk in chunks) == text
