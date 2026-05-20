from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from cognee.modules.users.models import (
    User,
    Tenant,
    Role,
    ACL,
    Permission,
    UserTenant,
    UserRole,
    Principal,
)
from cognee.modules.data.models import Dataset
from cognee.modules.users.methods import get_authenticated_user
from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.api.DTO import OutDTO

router = APIRouter()


class TenantDTO(OutDTO):
    id: UUID
    name: str


class RoleDTO(OutDTO):
    id: UUID
    name: str
    tenant_id: UUID


class ACLDTO(OutDTO):
    id: UUID
    principal_id: UUID
    permission: str
    dataset_id: UUID
    principal_type: str


class UserDTO(OutDTO):
    id: UUID
    email: str


@router.get("/tenants", response_model=List[TenantDTO])
async def get_my_tenants(user: User = Depends(get_authenticated_user)):
    db_engine = get_relational_engine()
    async with db_engine.get_async_session() as session:
        query = (
            select(Tenant)
            .join(UserTenant, Tenant.id == UserTenant.tenant_id)
            .where(UserTenant.user_id == user.id)
        )
        result = await session.execute(query)
        tenants = result.scalars().all()
        return [TenantDTO(id=t.id, name=t.name) for t in tenants]


@router.get("/tenants/{tenant_id}", response_model=TenantDTO)
async def get_tenant(tenant_id: UUID, user: User = Depends(get_authenticated_user)):
    db_engine = get_relational_engine()
    async with db_engine.get_async_session() as session:
        tenant = await session.get(Tenant, tenant_id)
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return TenantDTO(id=tenant.id, name=tenant.name)


@router.get("/tenants/{tenant_id}/users", response_model=List[UserDTO])
async def get_tenant_users(tenant_id: UUID, user: User = Depends(get_authenticated_user)):
    db_engine = get_relational_engine()
    async with db_engine.get_async_session() as session:
        # Verify requester is in this tenant
        membership = await session.scalar(
            select(UserTenant).where(
                UserTenant.tenant_id == tenant_id,
                UserTenant.user_id == user.id,
            )
        )
        if not membership:
            raise HTTPException(status_code=403, detail="Not a member of this tenant")

        query = (
            select(User)
            .join(UserTenant, User.id == UserTenant.user_id)
            .where(UserTenant.tenant_id == tenant_id)
        )
        result = await session.execute(query)
        users = result.scalars().all()
        return [UserDTO(id=u.id, email=u.email) for u in users]


@router.get("/roles", response_model=List[RoleDTO])
async def get_roles(user: User = Depends(get_authenticated_user)):
    db_engine = get_relational_engine()
    async with db_engine.get_async_session() as session:
        if user.tenant_id:
            query = select(Role).where(Role.tenant_id == user.tenant_id)
            result = await session.execute(query)
            roles = result.scalars().all()
            return [RoleDTO(id=r.id, name=r.name, tenant_id=r.tenant_id) for r in roles]
        else:
            return []


@router.get("/datasets/{dataset_id}/permissions", response_model=List[ACLDTO])
async def get_dataset_permissions(dataset_id: UUID, user: User = Depends(get_authenticated_user)):
    db_engine = get_relational_engine()
    async with db_engine.get_async_session() as session:
        # Only dataset owner or users with "share" permission may view ACLs
        dataset = await session.get(Dataset, dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset.owner_id != user.id:
            acl_check = await session.scalar(
                select(ACL).where(
                    ACL.dataset_id == dataset_id,
                    ACL.principal_id == user.id,
                    ACL.permission.has(name="share"),
                )
            )
            if not acl_check:
                raise HTTPException(
                    status_code=403, detail="Not authorized to view dataset permissions"
                )

        query = (
            select(ACL)
            .options(selectinload(ACL.permission), selectinload(ACL.principal))
            .where(ACL.dataset_id == dataset_id)
        )
        result = await session.execute(query)
        acls = result.scalars().all()

        return [
            ACLDTO(
                id=acl.id,
                principal_id=acl.principal_id,
                permission=acl.permission.name,
                dataset_id=acl.dataset_id,
                principal_type=acl.principal.type,
            )
            for acl in acls
        ]


@router.delete("/permissions/{acl_id}")
async def revoke_permission(acl_id: UUID, user: User = Depends(get_authenticated_user)):
    db_engine = get_relational_engine()
    async with db_engine.get_async_session() as session:
        acl = await session.get(
            ACL, acl_id, options=[selectinload(ACL.permission)]
        )
        if not acl:
            raise HTTPException(status_code=404, detail="Permission not found")

        # Only dataset owner or user with "share" permission may revoke ACLs
        dataset = await session.get(Dataset, acl.dataset_id)
        if not dataset or dataset.owner_id != user.id:
            # Check "share" permission on the dataset
            share_check = await session.scalar(
                select(ACL).where(
                    ACL.dataset_id == acl.dataset_id,
                    ACL.principal_id == user.id,
                    ACL.permission.has(name="share"),
                )
            )
            if not share_check:
                raise HTTPException(
                    status_code=403,
                    detail="Not authorized to revoke permissions on this dataset",
                )

        await session.delete(acl)
        await session.commit()
        return {"message": "Permission revoked"}
