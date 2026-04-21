import os
import sys
import uuid
import pytest
import pathlib
from pypdf import PdfReader
from unittest.mock import patch

from cognee.api.v1.cognify.cognify import (
    MUNINN_DEFAULT_CHUNK_SIZE,
    MUNINN_MAX_ENGRAM_CONTENT_LENGTH,
    MuninnTextChunker,
)
from cognee.modules.chunking.TextChunker import TextChunker
from cognee.modules.data.processing.document_types.PdfDocument import PdfDocument
from cognee.tests.integration.documents.AudioDocument_test import mock_get_embedding_engine
from cognee.tests.integration.documents.async_gen_zip import async_gen_zip

chunk_by_sentence_module = sys.modules.get("cognee.tasks.chunks.chunk_by_sentence")


GROUND_TRUTH = [
    {"word_count": 909, "len_text": 5697, "cut_type": "sentence_end"},
    {"word_count": 989, "len_text": 6473, "cut_type": "sentence_end"},
]


@patch.object(
    chunk_by_sentence_module, "get_embedding_engine", side_effect=mock_get_embedding_engine
)
@pytest.mark.asyncio
async def test_PdfDocument(mock_engine):
    test_file_path = os.path.join(
        pathlib.Path(__file__).parent.parent.parent,
        "test_data",
        "artificial-intelligence.pdf",
    )
    document = PdfDocument(
        id=uuid.uuid4(),
        name="Test document.pdf",
        raw_data_location=test_file_path,
        external_metadata="",
        mime_type="",
    )

    async for ground_truth, paragraph_data in async_gen_zip(
        GROUND_TRUTH, document.read(chunker_cls=TextChunker, max_chunk_size=1024)
    ):
        assert ground_truth["word_count"] == paragraph_data.chunk_size, (
            f'{ground_truth["word_count"] = } != {paragraph_data.chunk_size = }'
        )
        assert abs(ground_truth["len_text"] - len(paragraph_data.text)) <= 5, (
            f'{ground_truth["len_text"] = } != {len(paragraph_data.text) = }'
        )
        assert ground_truth["cut_type"] == paragraph_data.cut_type, (
            f'{ground_truth["cut_type"] = } != {paragraph_data.cut_type = }'
        )


@patch.object(
    chunk_by_sentence_module, "get_embedding_engine", side_effect=mock_get_embedding_engine
)
@pytest.mark.asyncio
async def test_PdfDocument_with_muninn_chunker_respects_content_limit(mock_engine):
    test_file_path = os.path.join(
        pathlib.Path(__file__).parent.parent.parent.parent.parent,
        "cognee-code",
        "docs",
        "1802.10233v1.pdf",
    )
    document = PdfDocument(
        id=uuid.uuid4(),
        name="1802.10233v1.pdf",
        raw_data_location=test_file_path,
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

    assert len(chunks) > 0, "PDF should yield at least one chunk"
    assert all(chunk.text.strip() for chunk in chunks), "Extracted chunks should not be empty"
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert all(
        len(chunk.text.encode("utf-8")) <= MUNINN_MAX_ENGRAM_CONTENT_LENGTH for chunk in chunks
    ), "Every chunk must stay within the Muninn engram content limit"

    full_text = "".join(chunk.text for chunk in chunks).lower()
    assert "bert" in full_text, "Expected the extracted PDF text to contain the paper title"

    overlap_found = False
    for previous, current in zip(chunks, chunks[1:]):
        previous_words = set(previous.text.lower().split())
        current_words = set(current.text.lower().split())
        if previous_words.intersection(current_words):
            overlap_found = True
            break

    assert overlap_found, "Muninn chunker should preserve some overlap across consecutive chunks"


@patch.object(
    chunk_by_sentence_module, "get_embedding_engine", side_effect=mock_get_embedding_engine
)
@pytest.mark.asyncio
async def test_chinese_pdf_first_20_pages_stay_well_below_muninn_content_limit(mock_engine):
    source_pdf_path = os.path.join(
        pathlib.Path(__file__).parent.parent.parent.parent.parent,
        "cognee-code",
        "docs",
        "chinese_ebook.pdf",
    )

    class FirstTwentyPagesPdfDocument(PdfDocument):
        async def read(self, chunker_cls, max_chunk_size: int, max_text_length: int | None = None):
            with open(self.raw_data_location, "rb") as stream:
                file = PdfReader(stream, strict=False)

                async def get_text():
                    for page in file.pages[:20]:
                        page_text = page.extract_text() or ""
                        if page_text:
                            yield page_text

                chunker = chunker_cls(self, get_text=get_text, max_chunk_size=max_chunk_size)
                chunker.max_text_length = max_text_length

                async for chunk in chunker.read():
                    yield chunk

    document = FirstTwentyPagesPdfDocument(
        id=uuid.uuid4(),
        name="chinese_ebook.pdf",
        raw_data_location=source_pdf_path,
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

    byte_lengths = [len(chunk.text.encode("utf-8")) for chunk in chunks]

    assert len(chunks) > 0, "Expected the first 20 pages of the Chinese PDF to produce chunks"
    assert all(size < MUNINN_MAX_ENGRAM_CONTENT_LENGTH for size in byte_lengths)
    assert max(byte_lengths) > 10000, "Chinese chunks should make better use of the 16KB budget"
