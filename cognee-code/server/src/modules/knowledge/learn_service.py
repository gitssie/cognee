from typing import Optional
from uuid import UUID

from cognee.shared.logging_utils import get_logger

logger = get_logger("session_learn")


async def learn_from_summary(
    summary: str,
    dataset_id: Optional[UUID],
    user,
    custom_prompt: Optional[str] = None,
) -> None:
    """
    Store text in the project's knowledge graph via cognee.add() + cognify().
    The caller is responsible for filtering the content before passing it here.
    custom_prompt is forwarded to cognify() to guide LLM-based knowledge extraction.
    """
    from cognee.api.v1.add import add as cognee_add
    from cognee.api.v1.cognify import cognify as cognee_cognify
    from cognee.context_global_variables import set_database_global_context_variables

    if dataset_id is not None:
        await set_database_global_context_variables(dataset_id, user.id)

    await cognee_add(data=summary, dataset_id=dataset_id, user=user)

    if dataset_id is not None:
        await cognee_cognify(
            datasets=[dataset_id],
            user=user,
            custom_prompt=custom_prompt,
        )

    logger.info(f"Text learned into dataset {dataset_id}")
