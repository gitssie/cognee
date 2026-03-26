"""
Login hang diagnosis tests - run each step independently to pinpoint the hang.

Run all steps 1-4 (no server needed):
    cd cognee-code/server
    uv run pytest tests/test_auth_diagnosis.py -v -s -k "not Step5"

Run Step 5 (requires server running on :8000):
    uv run uvicorn src.main:app --port 8000 &
    uv run pytest tests/test_auth_diagnosis.py::TestStep5_HTTP -v -s

Run Step 6 (integrated FastAPI test client, no external server):
    uv run pytest tests/test_auth_diagnosis.py::TestStep6_FastAPIClient -v -s
"""

import asyncio
import pytest
import httpx

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Step 1: Raw SQLite — can we read the users table at all?
# ---------------------------------------------------------------------------
class TestStep1_DB:
    """Direct SQLAlchemy query, no fastapi_users involved."""

    async def test_1_1_raw_engine_query(self):
        """Raw SQLAlchemy select on users table should return the default user."""
        from sqlalchemy import select
        from cognee.infrastructure.databases.relational import get_relational_engine
        from cognee.modules.users.models import User

        engine = get_relational_engine()
        async with engine.get_async_session() as session:
            result = await session.execute(
                select(User).where(User.email == "default_user@example.com")
            )
            user = result.scalar()

        assert user is not None, "default_user@example.com not found in DB"
        assert user.is_active is True
        assert user.is_verified is True
        print(f"\n[PASS] user found: id={user.id}, email={user.email}")

    async def test_1_2_password_hash_present(self):
        """User must have a non-empty hashed_password for auth to work."""
        from sqlalchemy import select
        from cognee.infrastructure.databases.relational import get_relational_engine
        from cognee.modules.users.models import User

        engine = get_relational_engine()
        async with engine.get_async_session() as session:
            result = await session.execute(
                select(User).where(User.email == "default_user@example.com")
            )
            user = result.scalar()

        assert user is not None
        assert user.hashed_password, "hashed_password is empty — login will always fail"
        print(f"\n[PASS] hashed_password present (len={len(user.hashed_password)})")

    async def test_1_3_SQLAlchemyUserDatabase_get_by_email(self):
        """fastapi_users SQLAlchemyUserDatabase.get_by_email() — the exact call authenticate() uses."""
        from cognee.infrastructure.databases.relational import get_relational_engine
        from cognee.modules.users.models import User
        from fastapi_users.db import SQLAlchemyUserDatabase

        engine = get_relational_engine()
        async with engine.get_async_session() as session:
            user_db = SQLAlchemyUserDatabase(session, User)
            user = await user_db.get_by_email("default_user@example.com")

        assert user is not None, "SQLAlchemyUserDatabase.get_by_email returned None"
        print(f"\n[PASS] SQLAlchemyUserDatabase found user: {user.email}")


# ---------------------------------------------------------------------------
# Step 2: UserManager construction and password verification
# ---------------------------------------------------------------------------
class TestStep2_UserManager:
    """Test the UserManager components used by fastapi_users login route."""

    async def test_2_1_get_user_manager_context(self):
        """UserManager construction should not hang."""
        from cognee.infrastructure.databases.relational import get_relational_engine
        from cognee.modules.users.models import User
        from cognee.modules.users.get_user_manager import UserManager
        from fastapi_users.db import SQLAlchemyUserDatabase

        engine = get_relational_engine()
        async with engine.get_async_session() as session:
            user_db = SQLAlchemyUserDatabase(session, User)
            manager = UserManager(user_db)
            print(f"\n[PASS] UserManager created: {manager}")

    async def test_2_2_user_db_get_by_email(self):
        """user_db.get_by_email() uses the same session — no second connection."""
        from cognee.infrastructure.databases.relational import get_relational_engine
        from cognee.modules.users.models import User
        from fastapi_users.db import SQLAlchemyUserDatabase

        engine = get_relational_engine()
        async with engine.get_async_session() as session:
            user_db = SQLAlchemyUserDatabase(session, User)
            user = await user_db.get_by_email("default_user@example.com")

        assert user is not None
        print(f"\n[PASS] user_db.get_by_email returned: {user.email}")

    async def test_2_3_password_verification(self):
        """fastapi_users PasswordHelper.verify_and_update() — pure CPU, no I/O."""
        from fastapi_users.password import PasswordHelper
        from sqlalchemy import select
        from cognee.infrastructure.databases.relational import get_relational_engine
        from cognee.modules.users.models import User

        helper = PasswordHelper()
        engine = get_relational_engine()
        async with engine.get_async_session() as session:
            result = await session.execute(
                select(User).where(User.email == "default_user@example.com")
            )
            user = result.scalar()

        assert user is not None
        is_valid, updated = helper.verify_and_update("default_password", user.hashed_password)
        print(f"\n[INFO] password valid={is_valid}, hash_needs_update={updated is not None}")
        assert is_valid, (
            "Password 'default_password' does NOT match the stored hash. "
            "The user was created with a different password."
        )

    async def test_2_4_full_authenticate(self):
        """UserManager.authenticate() — skipped in unit test due to aiosqlite/pytest-asyncio
        event loop conflict (known issue: aiosqlite worker thread uses stale loop after test teardown).
        This path is tested end-to-end in TestStep6_FastAPIClient instead.
        """
        pytest.skip(
            "aiosqlite + NullPool segfaults in pytest-asyncio because the worker thread "
            "holds a reference to the test's event loop after teardown. "
            "authenticate() is validated end-to-end via TestStep6_FastAPIClient."
        )


# ---------------------------------------------------------------------------
# Step 3: JWT Strategy — token creation
# ---------------------------------------------------------------------------
class TestStep3_JWT:
    """Test JWT write_token() independently."""

    async def test_3_1_jwt_write_token(self):
        """JWTStrategy.write_token() — no DB, pure crypto."""
        from cognee.modules.users.authentication.get_client_auth_backend import (
            get_client_auth_backend,
        )
        from cognee.modules.users.models import User
        from sqlalchemy import select
        from cognee.infrastructure.databases.relational import get_relational_engine

        backend = get_client_auth_backend()
        strategy = backend.get_strategy()

        engine = get_relational_engine()
        async with engine.get_async_session() as session:
            result = await session.execute(
                select(User).where(User.email == "default_user@example.com")
            )
            user = result.scalar()

        assert user is not None
        token = await strategy.write_token(user)
        assert token and len(token) > 20
        print(f"\n[PASS] JWT token created (len={len(token)})")


# ---------------------------------------------------------------------------
# Step 4: CookieTransport — response construction
# ---------------------------------------------------------------------------
class TestStep4_Transport:
    """Test CookieTransport.get_login_response()."""

    async def test_4_1_cookie_transport_login_response(self):
        """CookieTransport.get_login_response() — fastapi_users returns 204 No Content with Set-Cookie.
        This is by design: the cookie IS the token, no body needed.
        Frontend must accept 204 (not just 200) as a successful login.
        """
        from cognee.modules.users.authentication.default.default_transport import default_transport

        response = await default_transport.get_login_response("fake_token_abc123")
        print(f"\n[INFO] CookieTransport response status={response.status_code}")
        cookie_header = response.headers.get("set-cookie", "")
        print(f"[INFO] Set-Cookie: {cookie_header}")
        # fastapi_users CookieTransport returns 204, not 200 — this is correct behavior
        assert response.status_code == 204, (
            f"Expected 204 from CookieTransport, got {response.status_code}"
        )
        assert "auth_token" in cookie_header, "auth_token cookie not set in response"
        print("[PASS] CookieTransport correctly returns 204 with auth_token cookie")


# ---------------------------------------------------------------------------
# Step 5: Full HTTP login via httpx (server must be running on :8000)
# ---------------------------------------------------------------------------
class TestStep5_HTTP:
    """End-to-end HTTP test. Requires server running: uv run uvicorn src.main:app --port 8000"""

    async def test_5_1_login_endpoint_returns_204_with_cookie(self):
        """POST /api/v1/auth/login should return 204 and set auth_token cookie."""
        async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=8.0) as client:
            response = await client.post(
                "/api/v1/auth/login",
                data={
                    "username": "default_user@example.com",
                    "password": "default_password",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        print(f"\n[INFO] status={response.status_code}")
        print(f"[INFO] headers={dict(response.headers)}")
        print(f"[INFO] body={response.text[:200]}")

        assert response.status_code == 204, (
            f"Expected 204, got {response.status_code}: {response.text}"
        )
        assert "auth_token" in response.cookies or "set-cookie" in response.headers, (
            "No auth_token cookie in response"
        )
        print("[PASS] Login succeeded with auth_token cookie")

    async def test_5_2_authenticated_me_endpoint(self):
        """After login, GET /api/v1/auth/me should return the user profile."""
        async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=8.0) as client:
            login = await client.post(
                "/api/v1/auth/login",
                data={
                    "username": "default_user@example.com",
                    "password": "default_password",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            assert login.status_code == 204, f"Login failed: {login.status_code} {login.text}"

            me = await client.get("/api/v1/auth/me", cookies=login.cookies)

        print(f"\n[INFO] /me status={me.status_code}, body={me.text[:200]}")
        assert me.status_code == 200
        data = me.json()
        assert data.get("email") == "default_user@example.com"
        print(f"[PASS] /me returned: {data}")


# ---------------------------------------------------------------------------
# Step 6: Integrated FastAPI TestClient (same process, no external server)
#         Uses synchronous TestClient to avoid pytest-asyncio event loop issues.
# ---------------------------------------------------------------------------
class TestStep6_FastAPIClient:
    """Uses FastAPI's synchronous TestClient — avoids the aiosqlite/asyncio event loop bug."""

    def test_6_1_login_sync_client(self):
        """Full login flow through FastAPI's sync TestClient (uvicorn-like event loop handling)."""
        from fastapi.testclient import TestClient
        from src.main import app

        with TestClient(app, raise_server_exceptions=True) as client:
            response = client.post(
                "/api/v1/auth/login",
                data={
                    "username": "default_user@example.com",
                    "password": "default_password",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        print(f"\n[INFO] status={response.status_code}")
        print(f"[INFO] headers={dict(response.headers)}")
        print(f"[INFO] body={response.text[:200]}")

        # CookieTransport returns 204 on success
        assert response.status_code == 204, (
            f"Expected 204, got {response.status_code}: {response.text}"
        )
        assert "auth_token" in response.cookies, "No auth_token cookie set"
        print(
            f"[PASS] login returned 204, auth_token cookie = {response.cookies['auth_token'][:20]}..."
        )

    def test_6_2_me_after_login(self):
        """GET /api/v1/auth/me after login returns user profile."""
        from fastapi.testclient import TestClient
        from src.main import app

        with TestClient(app, raise_server_exceptions=True) as client:
            login = client.post(
                "/api/v1/auth/login",
                data={
                    "username": "default_user@example.com",
                    "password": "default_password",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            assert login.status_code == 204, f"Login failed: {login.status_code} {login.text}"

            me = client.get("/api/v1/auth/me", cookies=login.cookies)

        print(f"\n[INFO] /me status={me.status_code}, body={me.text[:300]}")
        assert me.status_code == 200, f"Expected 200 from /me, got {me.status_code}: {me.text}"
        data = me.json()
        assert data.get("email") == "default_user@example.com"
        print(f"[PASS] /me returned: email={data['email']}")
