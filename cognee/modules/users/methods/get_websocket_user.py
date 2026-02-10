"""
WebSocket authentication helper.

This module provides a utility function for authenticating WebSocket connections.
Since WebSocket endpoints cannot use FastAPI's Depends() mechanism, we need to
manually validate JWT tokens from cookies.
"""

import os
from typing import Optional
from fastapi import WebSocket
from fastapi_users.authentication.strategy.jwt import JWTStrategy as DefaultJWTStrategy

from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.users.models import User
from cognee.modules.users.get_user_db import get_user_db_context
from cognee.modules.users.get_user_manager import get_user_manager_context
from cognee.shared.logging_utils import get_logger

logger = get_logger("get_websocket_user")

# Check environment variable to determine authentication requirement
REQUIRE_AUTHENTICATION = (
    os.getenv("REQUIRE_AUTHENTICATION", "true").lower() == "true"
    or os.environ.get("ENABLE_BACKEND_ACCESS_CONTROL", "true").lower() == "true"
)


async def get_websocket_user(websocket: WebSocket) -> Optional[User]:
    """
    Get authenticated user from WebSocket connection.

    This function extracts the JWT token from cookies and validates it.
    If authentication is not required (REQUIRE_AUTHENTICATION=false),
    it returns the default user.

    Args:
        websocket: The WebSocket connection

    Returns:
        User object if authenticated successfully, None if authentication fails

    Raises:
        Exception: If there's an error during authentication
    """
    if not REQUIRE_AUTHENTICATION:
        # Authentication not required, use default user
        from cognee.modules.users.methods.get_default_user import get_default_user

        return await get_default_user()

    # Get token from cookies
    cookie_name = os.getenv("AUTH_TOKEN_COOKIE_NAME", "auth_token")
    access_token = websocket.cookies.get(cookie_name)

    if not access_token:
        logger.debug("No authentication token found in cookies")
        return None

    try:
        secret = os.getenv("FASTAPI_USERS_JWT_SECRET", "super_secret")
        strategy = DefaultJWTStrategy(secret, lifetime_seconds=3600)

        db_engine = get_relational_engine()

        async with db_engine.get_async_session() as session:
            async with get_user_db_context(session) as user_db:
                async with get_user_manager_context(user_db) as user_manager:
                    try:
                        user = await strategy.read_token(access_token, user_manager)
                        return user
                    except Exception as e:
                        logger.debug(f"Token validation failed: {e}")
                        return None
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        raise
