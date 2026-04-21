from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional
from uuid import UUID

from cognee.infrastructure.databases.exceptions import MissingQueryParameterError
from cognee.infrastructure.databases.vector.models.ScoredResult import ScoredResult
from cognee.infrastructure.databases.vector.vector_db_interface import VectorDBInterface
from cognee.infrastructure.engine import DataPoint
from cognee.infrastructure.engine.utils import parse_id

from ..embeddings.EmbeddingEngine import EmbeddingEngine
from .MuninnRestClient import MuninnRestClient
from .MuninnRestClient import MuninnRestError


class MuninnAdapter(VectorDBInterface):
    name = "MuninnDB"
    COGNEE_ID_TAG_PREFIX = "cognee:id:"
    BELONGS_TO_SET_TAG_PREFIX = "belongs_to_set:"
    DATA_ID_TAG_PREFIX = "data:"
    MAX_CONTENT_LENGTH = 16384

    def __init__(
        self,
        url: Optional[str],
        api_key: Optional[str],
        embedding_engine: EmbeddingEngine,
        database_name: Optional[str] = None,
    ):
        self.url = (url or "http://localhost:8476").rstrip("/")
        self.api_key = api_key or None
        self.embedding_engine = embedding_engine
        self.database_name = (database_name or "").strip()

    @asynccontextmanager
    async def _client(self) -> AsyncIterator[Any]:
        async with MuninnRestClient(base_url=self.url, api_key=self.api_key) as client:
            yield client

    def _vault_name(self, collection_name: str) -> str:
        # One vault per dataset — collection_name is stored as a tag, not encoded in the vault.
        if not self.database_name:
            raise ValueError(
                "MuninnAdapter requires an explicit vault name for dataset-scoped operations. "
                "Configure DatasetDatabase.vector_database_name for the dataset first."
            )
        return self.database_name

    def _collection_tag(self, collection_name: str) -> str:
        return f"collection:{collection_name}"

    def _extract_belongs_to_set(self, tags: list[str] | None) -> list[str]:
        if not tags:
            return []
        return [
            tag[len(self.BELONGS_TO_SET_TAG_PREFIX) :]
            for tag in tags
            if tag.startswith(self.BELONGS_TO_SET_TAG_PREFIX)
        ]

    def _extract_cognee_id(self, tags: list[str] | None, fallback_id: str) -> str:
        if tags:
            for tag in tags:
                if tag.startswith(self.COGNEE_ID_TAG_PREFIX):
                    return tag[len(self.COGNEE_ID_TAG_PREFIX) :]

        return fallback_id

    def _build_tags(self, collection_name: str, data_point: DataPoint) -> list[str]:
        tags = [f"collection:{collection_name}", f"{self.COGNEE_ID_TAG_PREFIX}{data_point.id}"]

        if data_point.data_id is not None:
            tags.append(f"{self.DATA_ID_TAG_PREFIX}{data_point.data_id}")

        belongs_to_set = data_point.belongs_to_set or []
        for item in belongs_to_set:
            if isinstance(item, str):
                tags.append(f"belongs_to_set:{item}")
            elif isinstance(item, DataPoint):
                item_name = item.model_dump().get("name") or getattr(item, "type", None)
                if isinstance(item_name, str):
                    tags.append(f"belongs_to_set:{item_name}")

        return tags

    def _parse_cognee_uuid(self, tags: list[str] | None, fallback_id: str) -> UUID:
        parsed_id = parse_id(self._extract_cognee_id(tags, fallback_id))
        if isinstance(parsed_id, UUID):
            return parsed_id

        return UUID(str(parsed_id))

    def _build_payload(
        self,
        *,
        engram_id: str,
        concept: str | None,
        content: str,
        tags: list[str] | None = None,
        type_label: str | None = None,
    ) -> dict[str, Any]:
        cognee_id = self._extract_cognee_id(tags, engram_id)
        payload: dict[str, Any] = {
            "id": cognee_id,
            "text": content,
        }

        if concept:
            payload["concept"] = concept

        if type_label:
            payload["type"] = type_label

        belongs_to_set = self._extract_belongs_to_set(tags)
        if belongs_to_set:
            payload["belongs_to_set"] = belongs_to_set

        return payload

    def _validate_content_length(self, data_point: DataPoint, content: str) -> None:
        content_size = len(content.encode("utf-8"))
        if content_size <= self.MAX_CONTENT_LENGTH:
            return

        raise RuntimeError(
            "Muninn content exceeds max length 16384 for "
            f"{type(data_point).__name__} {data_point.id} (got {content_size})"
        )

    def _matches_requested_ids(self, tags: list[str] | None, requested_ids: set[str]) -> bool:
        if not tags:
            return False
        for tag in tags:
            if (
                tag.startswith(self.COGNEE_ID_TAG_PREFIX)
                and tag[len(self.COGNEE_ID_TAG_PREFIX) :] in requested_ids
            ):
                return True
        return False

    async def _get_vault_size(self, vault: str) -> int:
        async with self._client() as client:
            page = await client.list_engrams(vault=vault, limit=1, offset=0)
            return page.total

    async def _list_matching_engrams(
        self,
        vault: str,
        *,
        requested_ids: set[str] | None = None,
    ) -> list[Any]:
        requested_ids = requested_ids or set()
        offset = 0
        limit = 100
        matches: list[Any] = []

        async with self._client() as client:
            while True:
                page = await client.list_engrams(vault=vault, limit=limit, offset=offset)
                if not page.engrams:
                    break

                for engram in page.engrams:
                    if not requested_ids or self._matches_requested_ids(engram.tags, requested_ids):
                        matches.append(engram)

                offset += len(page.engrams)
                if offset >= page.total:
                    break

        return matches

    async def has_collection(self, collection_name: str) -> bool:
        # With single-vault-per-dataset design, a "collection" exists when the vault
        # exists AND contains at least one engram tagged with the collection tag.
        vault_name = self._vault_name(collection_name)
        tag = self._collection_tag(collection_name)
        async with self._client() as client:
            try:
                page = await client.list_engrams_by_tag(vault=vault_name, tag=tag, limit=1)
            except MuninnRestError as error:
                if error.status_code in {401, 403, 404}:
                    return False
                raise
            return len(page.engrams) > 0

    async def create_collection(self, collection_name: str, payload_schema: Optional[Any] = None):
        return None

    async def create_data_points(self, collection_name: str, data_points: list[DataPoint]):
        if not data_points:
            return

        vault_name = self._vault_name(collection_name)
        async with self._client() as client:
            for start in range(0, len(data_points), 50):
                batch = data_points[start : start + 50]
                engrams = []
                for data_point in batch:
                    content = str(DataPoint.get_embeddable_data(data_point) or "")
                    self._validate_content_length(data_point, content)
                    engrams.append(
                        {
                            "vault": vault_name,
                            "concept": type(data_point).__name__,
                            "content": content,
                            "tags": self._build_tags(collection_name, data_point),
                            "idempotent_id": f"{vault_name}:{data_point.id}",
                        }
                    )
                response = await client.write_batch(
                    vault=vault_name,
                    engrams=engrams,
                )

                failed_writes = [result for result in response.results if result.status != "ok"]
                if failed_writes:
                    failure_messages = ", ".join(
                        result.error or f"batch index {result.index} failed"
                        for result in failed_writes
                    )
                    raise RuntimeError(f"Muninn batch write failed: {failure_messages}")

    async def retrieve(self, collection_name: str, data_point_ids: list[str]):
        if not data_point_ids:
            return []

        vault_name = self._vault_name(collection_name)
        matches = await self._list_matching_engrams(
            vault_name, requested_ids={str(data_point_id) for data_point_id in data_point_ids}
        )

        results: list[ScoredResult] = []
        for engram in matches:
            cognee_id = self._parse_cognee_uuid(engram.tags, engram.id)
            results.append(
                ScoredResult(
                    id=cognee_id,
                    payload=self._build_payload(
                        engram_id=engram.id,
                        concept=engram.concept,
                        content=engram.content,
                        tags=engram.tags,
                    ),
                    score=0,
                )
            )

        return results

    async def search(
        self,
        collection_name: str,
        query_text: Optional[str] = None,
        query_vector: Optional[list[float]] = None,
        limit: Optional[int] = None,
        with_vector: bool = False,
        include_payload: bool = False,
        node_name: Optional[list[str]] = None,
        recall_mode: Optional[str] = None,
        threshold: Optional[float] = None,
    ):
        if query_text is None and query_vector is None:
            raise MissingQueryParameterError()

        if query_text is None:
            raise ValueError("MuninnAdapter does not support vector-only search.")

        vault_name = self._vault_name(collection_name)
        search_limit = limit if limit is not None else await self._get_vault_size(vault_name)
        if search_limit <= 0:
            return []

        if node_name:
            search_limit = max(search_limit * 5, search_limit)

        async with self._client() as client:
            activation = await client.activate(
                vault=vault_name,
                context=[query_text],
                max_results=search_limit,
                threshold=threshold,
                mode=recall_mode or "balanced",
            )

            results: list[ScoredResult] = []
            for item in activation.activations:
                read_result = await client.read(item.id, vault=vault_name)
                tags = read_result.tags

                belongs_to_set = self._extract_belongs_to_set(tags)
                if node_name and not set(belongs_to_set).intersection(node_name):
                    continue

                payload = None
                if include_payload:
                    payload = self._build_payload(
                        engram_id=item.id,
                        concept=item.concept,
                        content=item.content,
                        tags=tags,
                        type_label=item.type_label,
                    )

                cognee_id = self._parse_cognee_uuid(tags, item.id)
                results.append(
                    ScoredResult(
                        id=cognee_id,
                        payload=payload,
                        score=max(0.0, float(item.score)),
                    )
                )

                if limit is not None and len(results) >= limit:
                    break

            return results

    async def batch_search(
        self,
        collection_name: str,
        query_texts: list[str],
        limit: Optional[int],
        with_vectors: bool = False,
        include_payload: bool = False,
        node_name: Optional[list[str]] = None,
    ):
        return [
            await self.search(
                collection_name=collection_name,
                query_text=query_text,
                query_vector=None,
                limit=limit,
                with_vector=with_vectors,
                include_payload=include_payload,
                node_name=node_name,
            )
            for query_text in query_texts
        ]

    async def create_chunk_sequence_links(
        self,
        collection_name: str,
        chunks: list,
        weight: float = 0.3,
    ):
        """Write followed_by / preceded_by associations between consecutive chunks.

        For each chunk that has a ``next_chunk_id``, this emits:
          - chunk → next_chunk  (rel_type 9 = RelFollowedBy)
          - next_chunk → chunk  (rel_type 8 = RelPrecededBy)

        Only chunks with deterministic positional IDs (i.e. where both
        ``chunk.id`` and ``chunk.next_chunk_id`` are non-None) are linked.
        Oversized single-paragraph chunks that were assigned content-based IDs
        have ``next_chunk_id=None`` and are silently skipped.

        Engrams that do not yet exist in the vault (e.g. the very last chunk's
        forward reference, or a partially-ingested document) are skipped
        gracefully — the link call will return 404 which we catch and ignore.
        """
        from cognee.modules.chunking.models.DocumentChunk import DocumentChunk

        # Collect the set of cognee UUIDs we need to resolve to muninndb ULIDs.
        needed: set[str] = set()
        pairs: list[tuple[str, str]] = []  # (chunk_cognee_id, next_cognee_id)
        for chunk in chunks:
            if not isinstance(chunk, DocumentChunk):
                continue
            if chunk.next_chunk_id is None:
                continue
            needed.add(str(chunk.id))
            needed.add(str(chunk.next_chunk_id))
            pairs.append((str(chunk.id), str(chunk.next_chunk_id)))

        if not pairs:
            return

        vault_name = self._vault_name(collection_name)

        # Batch-resolve cognee UUID → muninndb ULID by scanning the vault once.
        engram_id_map: dict[str, str] = {}  # cognee_uuid_str → muninndb_ulid
        matches = await self._list_matching_engrams(vault_name, requested_ids=needed)
        for engram in matches:
            cognee_id = self._extract_cognee_id(engram.tags, engram.id)
            engram_id_map[cognee_id] = engram.id

        async with self._client() as client:
            for chunk_uuid, next_uuid in pairs:
                source_ulid = engram_id_map.get(chunk_uuid)
                target_ulid = engram_id_map.get(next_uuid)
                if source_ulid is None or target_ulid is None:
                    # One or both engrams not yet in the vault — skip silently.
                    continue
                try:
                    # chunk → next  (followed_by, rel_type=9)
                    await client.link(
                        source_id=source_ulid,
                        target_id=target_ulid,
                        vault=vault_name,
                        rel_type=9,
                        weight=weight,
                    )
                    # next → chunk  (preceded_by, rel_type=8)
                    await client.link(
                        source_id=target_ulid,
                        target_id=source_ulid,
                        vault=vault_name,
                        rel_type=8,
                        weight=weight,
                    )
                except Exception:
                    # Non-fatal: a missing engram or transient error must not
                    # abort the ingestion pipeline.
                    pass

    async def delete_data_points(self, collection_name: str, data_point_ids: list[UUID]):
        if not data_point_ids:
            return

        vault_name = self._vault_name(collection_name)
        matches = await self._list_matching_engrams(
            vault_name, requested_ids={str(data_point_id) for data_point_id in data_point_ids}
        )

        async with self._client() as client:
            for engram in matches:
                await client.forget(engram.id, vault=vault_name, hard=True)

    async def delete_data_points_by_data_id(self, collection_name: str, data_id: UUID):
        """Delete all engrams in a vault that belong to the given data_id.

        This is an O(n_document) operation — it uses the ``data:<data_id>`` tag emitted
        at write time to locate only the relevant engrams, avoiding a full vault scan.
        Falls back to a no-op if no engrams carry the tag (e.g. ingested before tagging
        was introduced).
        """
        vault_name = self._vault_name(collection_name)
        tag = f"{self.DATA_ID_TAG_PREFIX}{data_id}"

        async with self._client() as client:
            # Page through all matching engrams in case there are more than the default limit.
            offset = 0
            page_size = 1000
            while True:
                page = await client.list_engrams_by_tag(vault=vault_name, tag=tag, limit=page_size)
                if not page.engrams:
                    break
                for engram in page.engrams:
                    await client.forget(engram.id, vault=vault_name, hard=True)
                # If we got fewer results than the page size, we've consumed all pages.
                if len(page.engrams) < page_size:
                    break
                offset += len(page.engrams)

    async def prune(self):
        return None

    async def embed_data(self, data: list[str]) -> list[list[float]]:
        return await self.embedding_engine.embed_text(data)

    async def create_vector_index(self, index_name: str, index_property_name: str):
        return None

    async def index_data_points(
        self, index_name: str, index_property_name: str, data_points: list[DataPoint]
    ):
        # Pass the original data points directly.  create_data_points will call
        # DataPoint.get_embeddable_data which reads the correct index field from
        # the data point's own metadata.  Building a bare DataPoint wrapper here
        # is wrong because DataPoint.__init__ always overwrites the `type` field
        # with the class name, which would destroy whatever text value we stored there.
        valid_points = [
            dp for dp in data_points if getattr(dp, index_property_name, None) is not None
        ]
        if valid_points:
            await self.create_data_points(f"{index_name}_{index_property_name}", valid_points)

    async def delete_vault_prefix(self, prefix: str):
        async with self._client() as client:
            vaults = await client.list_vaults()
            for vault in vaults:
                if not vault.startswith(prefix):
                    continue

                offset = 0
                limit = 100
                while True:
                    page = await client.list_engrams(vault=vault, limit=limit, offset=offset)
                    if not page.engrams:
                        break

                    for engram in page.engrams:
                        await client.forget(engram.id, vault=vault, hard=True)

                    offset += len(page.engrams)
                    if offset >= page.total:
                        break
