from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from typing import List, Optional
from uuid import UUID
from .models import DatasetCreate, DatasetResponse, DataItemResponse, DataAddPayload
from .services import DatasetService, DataService

router = APIRouter(prefix="/datasets", tags=["M1 Knowledge"])


# Mock Auth Dependency
def get_current_user():
    return "user_123"


@router.post("/", response_model=DatasetResponse)
async def create_dataset(dataset: DatasetCreate, user_id: str = Depends(get_current_user)):
    return await DatasetService.create_dataset(dataset, user_id)


@router.get("/", response_model=List[DatasetResponse])
async def list_datasets(user_id: str = Depends(get_current_user)):
    return await DatasetService.list_datasets(user_id)


@router.delete("/{dataset_id}")
async def delete_dataset(dataset_id: UUID, user_id: str = Depends(get_current_user)):
    success = await DatasetService.delete_dataset(dataset_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {"message": "Dataset deleted"}


# --- Data Endpoints ---


@router.get("/{dataset_id}/data", response_model=List[DataItemResponse])
async def list_data(dataset_id: UUID, user_id: str = Depends(get_current_user)):
    ds = await DatasetService.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return await DataService.list_data(dataset_id, user_id)


@router.post("/{dataset_id}/data", response_model=DataItemResponse)
async def add_data(
    dataset_id: UUID, payload: DataAddPayload, user_id: str = Depends(get_current_user)
):
    # Ensure payload dataset matches path
    payload.dataset_id = dataset_id
    ds = await DatasetService.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return await DataService.add_data(payload, user_id)


@router.post("/{dataset_id}/upload", response_model=DataItemResponse)
async def upload_file(
    dataset_id: UUID, file: UploadFile = File(...), user_id: str = Depends(get_current_user)
):
    ds = await DatasetService.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    content = await file.read()
    return await DataService.add_file(dataset_id, file.filename, content, user_id)


@router.delete("/{dataset_id}/data/{data_id}")
async def delete_data(dataset_id: UUID, data_id: UUID, user_id: str = Depends(get_current_user)):
    success = await DataService.delete_data(data_id, dataset_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Data not found")
    return {"message": "Data deleted"}
