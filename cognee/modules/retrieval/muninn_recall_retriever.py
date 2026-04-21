from typing import Any, List, Optional, Union

from cognee.infrastructure.databases.unified import get_unified_engine
from cognee.infrastructure.databases.vector.exceptions.exceptions import CollectionNotFoundError
from cognee.modules.retrieval.base_retriever import BaseRetriever
from cognee.modules.retrieval.exceptions.exceptions import NoDataError
from cognee.shared.logging_utils import get_logger

logger = get_logger("MuninnRecallRetriever")


class MuninnRecallRetriever(BaseRetriever):
    def __init__(
        self,
        top_k: Optional[int] = 10,
        node_name: Optional[List[str]] = None,
        recall_mode: str = "balanced",
        threshold: float = 0.0,
    ):
        self.top_k = top_k
        self.node_name = node_name
        self.recall_mode = recall_mode
        self.threshold = threshold

    async def get_retrieved_objects(self, query: str) -> Any:
        unified = await get_unified_engine()
        vector_engine = unified.vector

        try:
            return await vector_engine.search(
                "DocumentChunk_text",
                query,
                limit=self.top_k,
                include_payload=True,
                node_name=self.node_name,
                recall_mode=self.recall_mode,
                threshold=self.threshold,
            )
        except CollectionNotFoundError as error:
            logger.error("Muninn recall search collection not found in vector database")
            raise NoDataError("No data found in the system, please add data first.") from error

    async def get_context_from_objects(self, query: str, retrieved_objects: Any) -> str:
        if retrieved_objects:
            return "\n".join(found_item.payload["text"] for found_item in retrieved_objects)
        return ""

    async def get_completion_from_context(
        self, query: str, retrieved_objects: Any, context: Any
    ) -> Union[List[str], List[dict]]:
        if retrieved_objects:
            return [found_item.payload for found_item in retrieved_objects]
        return []
