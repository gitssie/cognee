from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
from uuid import UUID, uuid4


class DatasetBase(BaseModel):
    name: str = Field(..., description="Name of the dataset")


class DatasetCreate(DatasetBase):
    pass


class DatasetUpdate(DatasetBase):
    pass


class DatasetResponse(DatasetBase):
    id: UUID
    owner_id: str
    tenant_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# DataItem models
class DataItemBase(BaseModel):
    name: str
    content_hash: Optional[str] = None


class DataItemResponse(DataItemBase):
    id: UUID
    dataset_id: UUID
    mime_type: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    owner_id: str


class DataAddPayload(BaseModel):
    dataset_id: UUID
    text: Optional[str] = None
    url: Optional[str] = None
