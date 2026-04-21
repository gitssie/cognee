from cognee.shared.logging_utils import get_logger
from uuid import NAMESPACE_OID, UUID, uuid5

from cognee.tasks.chunks import chunk_by_paragraph
from cognee.modules.chunking.Chunker import Chunker
from .models.DocumentChunk import DocumentChunk

logger = get_logger()

# Sequential associations between consecutive chunks allow muninndb to surface
# neighboring chunks during BFS-based recall (e.g. chunk N+1 is pulled in when
# chunk N is the best semantic match for a query).
CHUNK_SEQUENCE_WEIGHT = 0.3


def _positional_chunk_id(document_id: UUID, chunk_index: int) -> UUID:
    """Return the deterministic chunk UUID for the given document and index."""
    return uuid5(NAMESPACE_OID, f"{document_id}-{chunk_index}")


class TextChunker(Chunker):
    async def read(self):
        paragraph_chunks = []
        accumulated_text_length = 0

        def get_text_size(text: str) -> int:
            if self.max_text_length is None:
                return len(text)
            return len(text.encode("utf-8"))

        async for content_text in self.get_text():
            for chunk_data in chunk_by_paragraph(
                content_text,
                self.max_chunk_size,
                max_text_length=self.max_text_length,
                batch_paragraphs=True,
            ):
                next_text_length = accumulated_text_length + get_text_size(chunk_data["text"])
                if self.chunk_size + chunk_data["chunk_size"] <= self.max_chunk_size and (
                    self.max_text_length is None or next_text_length <= self.max_text_length
                ):
                    paragraph_chunks.append(chunk_data)
                    self.chunk_size += chunk_data["chunk_size"]
                    accumulated_text_length = next_text_length
                else:
                    if len(paragraph_chunks) == 0:
                        # Oversized single paragraph: ID is content-based, so we cannot
                        # reliably compute neighbor IDs — omit sequential links.
                        yield DocumentChunk(
                            id=chunk_data["chunk_id"],
                            text=chunk_data["text"],
                            chunk_size=chunk_data["chunk_size"],
                            is_part_of=self.document,
                            chunk_index=self.chunk_index,
                            cut_type=chunk_data["cut_type"],
                            contains=[],
                            metadata={
                                "index_fields": ["text"],
                            },
                        )
                        paragraph_chunks = []
                        self.chunk_size = 0
                        accumulated_text_length = 0
                    else:
                        chunk_text = "".join(chunk["text"] for chunk in paragraph_chunks)
                        chunk_index = self.chunk_index
                        doc_id = self.document.id
                        try:
                            yield DocumentChunk(
                                id=_positional_chunk_id(doc_id, chunk_index),
                                text=chunk_text,
                                chunk_size=self.chunk_size,
                                is_part_of=self.document,
                                chunk_index=chunk_index,
                                cut_type=paragraph_chunks[len(paragraph_chunks) - 1]["cut_type"],
                                contains=[],
                                previous_chunk_id=(
                                    _positional_chunk_id(doc_id, chunk_index - 1)
                                    if chunk_index > 0
                                    else None
                                ),
                                next_chunk_id=_positional_chunk_id(doc_id, chunk_index + 1),
                                metadata={
                                    "index_fields": ["text"],
                                },
                            )
                        except Exception as e:
                            logger.error(str(e))
                            raise e
                        paragraph_chunks = [chunk_data]
                        self.chunk_size = chunk_data["chunk_size"]
                        accumulated_text_length = get_text_size(chunk_data["text"])

                    self.chunk_index += 1

        if len(paragraph_chunks) > 0:
            chunk_index = self.chunk_index
            doc_id = self.document.id
            try:
                yield DocumentChunk(
                    id=_positional_chunk_id(doc_id, chunk_index),
                    text="".join(chunk["text"] for chunk in paragraph_chunks),
                    chunk_size=self.chunk_size,
                    is_part_of=self.document,
                    chunk_index=chunk_index,
                    cut_type=paragraph_chunks[len(paragraph_chunks) - 1]["cut_type"],
                    contains=[],
                    previous_chunk_id=(
                        _positional_chunk_id(doc_id, chunk_index - 1) if chunk_index > 0 else None
                    ),
                    # This is the final chunk — there is no successor.
                    next_chunk_id=None,
                    metadata={"index_fields": ["text"]},
                )
            except Exception as e:
                logger.error(str(e))
                raise e
