from typing import List, Optional, Union
from uuid import UUID

from cognee.infrastructure.engine import DataPoint
from cognee.infrastructure.engine.models.Edge import Edge
from cognee.modules.data.processing.document_types import Document
from cognee.modules.engine.models import Entity
from cognee.tasks.temporal_graph.models import Event


class DocumentChunk(DataPoint):
    """
    Represents a chunk of text from a document with associated metadata.

    Public methods include:

    - No public methods defined in the provided code.

    Instance variables include:

    - text: The textual content of the chunk.
    - chunk_size: The size of the chunk.
    - chunk_index: The index of the chunk in the original document.
    - cut_type: The type of cut that defined this chunk.
    - is_part_of: The document to which this chunk belongs.
    - contains: A list of entities or events contained within the chunk (default is None).
    - previous_chunk_id: UUID of the preceding chunk in this document (None for first chunk).
    - next_chunk_id: UUID of the following chunk in this document (always set; last chunk's
      next may not be stored in the vector store yet).
    - metadata: A dictionary to hold meta information related to the chunk, including index
      fields.
    """

    text: str
    chunk_size: int
    chunk_index: int
    cut_type: str
    is_part_of: Document
    contains: List[Union[Entity, Event, tuple[Edge, Entity]]] = None
    previous_chunk_id: Optional[UUID] = None
    next_chunk_id: Optional[UUID] = None
    metadata: dict = {"index_fields": ["text"]}
