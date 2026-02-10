from typing import List, Optional
from uuid import UUID, uuid4
from datetime import datetime, timezone
from .models import DatasetCreate, DatasetResponse, DataItemResponse, DataAddPayload

# Mock Database
mock_datasets: List[DatasetResponse] = []
mock_data_items: List[DataItemResponse] = []


class DatasetService:
    @staticmethod
    async def create_dataset(data: DatasetCreate, user_id: str) -> DatasetResponse:
        for ds in mock_datasets:
            if ds.name == data.name and ds.owner_id == user_id:
                return ds

        new_dataset = DatasetResponse(
            id=uuid4(),
            name=data.name,
            owner_id=user_id,
            tenant_id="default",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        mock_datasets.append(new_dataset)
        return new_dataset

    @staticmethod
    async def list_datasets(user_id: str) -> List[DatasetResponse]:
        return [ds for ds in mock_datasets if ds.owner_id == user_id]

    @staticmethod
    async def get_dataset(dataset_id: UUID) -> Optional[DatasetResponse]:
        for ds in mock_datasets:
            if ds.id == dataset_id:
                return ds
        return None

    @staticmethod
    async def delete_dataset(dataset_id: UUID, user_id: str) -> bool:
        global mock_datasets
        initial_len = len(mock_datasets)
        mock_datasets = [
            ds for ds in mock_datasets if not (ds.id == dataset_id and ds.owner_id == user_id)
        ]
        # Cascade delete data
        global mock_data_items
        mock_data_items = [d for d in mock_data_items if d.dataset_id != dataset_id]
        return len(mock_datasets) < initial_len


class DataService:
    @staticmethod
    async def list_data(dataset_id: UUID, user_id: str) -> List[DataItemResponse]:
        # In real world, check dataset permission first
        return [d for d in mock_data_items if d.dataset_id == dataset_id and d.owner_id == user_id]

    @staticmethod
    async def add_data(payload: DataAddPayload, user_id: str) -> DataItemResponse:
        new_item = DataItemResponse(
            id=uuid4(),
            name="Text Input" if payload.text else (payload.url or "Unknown"),
            dataset_id=payload.dataset_id,
            owner_id=user_id,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            mime_type="text/plain",
        )
        mock_data_items.append(new_item)
        return new_item

    @staticmethod
    async def add_file(
        dataset_id: UUID, filename: str, content: bytes, user_id: str
    ) -> DataItemResponse:
        new_item = DataItemResponse(
            id=uuid4(),
            name=filename,
            dataset_id=dataset_id,
            owner_id=user_id,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            mime_type="application/octet-stream",
        )
        mock_data_items.append(new_item)
        return new_item

    @staticmethod
    async def delete_data(data_id: UUID, dataset_id: UUID, user_id: str) -> bool:
        global mock_data_items
        initial = len(mock_data_items)
        mock_data_items = [
            d
            for d in mock_data_items
            if not (d.id == data_id and d.dataset_id == dataset_id and d.owner_id == user_id)
        ]
        return len(mock_data_items) < initial
