"""
Router for per-dataset Muninn vault key provisioning.

POST /api/v1/datasets/{dataset_id}/vault-key
    Provision (or update) the DatasetDatabase record for a Muninn-backed dataset
    using the caller-supplied per-dataset API key.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, model_validator

from cognee.modules.users.models import User
from cognee.modules.users.methods import get_authenticated_user
from cognee.modules.data.methods import get_authorized_existing_datasets

from src.modules.projects.service import _provision_muninn_dataset_database


class VaultKeyPayload(BaseModel):
    vault_api_key: str

    @model_validator(mode="after")
    def validate_fields(self):
        if not self.vault_api_key.strip():
            raise ValueError("vault_api_key is required")
        return self


def get_vault_key_router() -> APIRouter:
    router = APIRouter()

    @router.post(
        "/{dataset_id}/vault-key",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def provision_vault_key(
        dataset_id: UUID,
        body: VaultKeyPayload,
        user: User = Depends(get_authenticated_user),
    ) -> None:
        """
        Provision a Muninn vault API key for the given dataset.

        Creates (or silently skips if already present) a DatasetDatabase record
        that stores the per-dataset Muninn vault key. Requires the caller to have
        write permission on the dataset.

        **Only meaningful when the server is configured with `VECTOR_DB_PROVIDER=muninn`.**
        For other vector backends this is a documented no-op that still returns 204.
        """
        # Verify the caller has write access to this dataset
        authorized = await get_authorized_existing_datasets([dataset_id], "write", user)
        if not authorized:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dataset {dataset_id} not found or insufficient permissions.",
            )

        await _provision_muninn_dataset_database(
            dataset_id=dataset_id,
            user=user,
            vault_api_key=body.vault_api_key,
        )

    return router
