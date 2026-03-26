from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from cognee.infrastructure.databases.relational.ModelBase import Base


class Project(Base):
    """
    Persistent project record.

    Each project owns a dedicated cognee Dataset (dataset_id).
    Physical DB isolation is handled by cognee's set_database_global_context_variables.
    """

    __tablename__ = "projects"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False, default="general")
    remote_url: Mapped[str | None] = mapped_column(String, nullable=True)
    local_path: Mapped[str | None] = mapped_column(String, nullable=True)
    opencode_project_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    dataset_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    owner_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_project_owner_name"),)
