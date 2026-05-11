"""
MuninnDB admin client for vault lifecycle management.

Provides a lightweight async client that authenticates with MuninnDB's admin
UI and calls the admin REST API to create/configure vaults before data operations.
"""

from __future__ import annotations

import asyncio
import os
from typing import Optional

import aiohttp

from cognee.shared.logging_utils import get_logger

logger = get_logger("muninn_admin")

# ── Defaults ─────────────────────────────────────────────────────────────────

_admin_base_url: str | None = None
_admin_username: str | None = None
_admin_password: str | None = None

# Cached admin session (cookie value) — refreshed on 401
_session_cookie: str | None = None
_session_lock = asyncio.Lock()


def _get_admin_url() -> str:
    """Derive admin URL from VECTOR_DB_URL."""
    global _admin_base_url
    if _admin_base_url is not None:
        return _admin_base_url
    _admin_base_url = os.getenv("VECTOR_DB_URL", "http://localhost:8476").rstrip("/")
    return _admin_base_url


def _get_admin_credentials() -> tuple[str, str]:
    global _admin_username, _admin_password
    if _admin_username is None:
        _admin_username = os.getenv("MUNINN_ADMIN_USERNAME", "")
    if _admin_password is None:
        _admin_password = os.getenv("MUNINN_ADMIN_PASSWORD", "")
    return _admin_username, _admin_password


# ── Session management ──────────────────────────────────────────────────────


async def _login() -> Optional[str]:
    """Log into MuninnDB admin UI and return the muninn_session cookie value."""
    base = _get_admin_url()
    username, password = _get_admin_credentials()
    if not username or not password:
        logger.warning("Muninn admin credentials not configured — vault provisioning skipped.")
        return None

    login_url = f"{base}/api/auth/login"
    payload = {"username": username, "password": password}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(login_url, json=payload, timeout=aiohttp.ClientTimeout(10)) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.error(f"Muninn admin login failed ({resp.status}): {body}")
                    return None

                # Extract the muninn_session cookie
                for cookie in resp.cookies.values():
                    if cookie.key == "muninn_session":
                        logger.info("Muninn admin login successful.")
                        return cookie.value

                logger.error("Muninn admin login succeeded but no muninn_session cookie returned.")
                return None
    except Exception as exc:
        logger.error(f"Muninn admin login error: {exc}")
        return None


async def _ensure_session() -> Optional[str]:
    """Get or refresh the admin session cookie."""
    global _session_cookie

    async with _session_lock:
        if _session_cookie is None:
            _session_cookie = await _login()
        return _session_cookie


def _invalidate_session() -> None:
    """Force re-login on next call (e.g. after 401)."""
    global _session_cookie
    _session_cookie = None


# ── Vault operations ────────────────────────────────────────────────────────


async def ensure_vault_public(vault_name: str) -> bool:
    """
    Ensure a Muninn vault exists and is public (no API key required).

    Calls PUT /api/admin/vaults/config with public=true. If the vault already
    exists, its access policy is updated. Returns True on success.
    """
    cookie = await _ensure_session()
    if cookie is None:
        return False

    base = _get_admin_url()
    url = f"{base}/api/admin/vaults/config"
    payload = {"name": vault_name, "public": True}

    try:
        async with aiohttp.ClientSession(cookies={"muninn_session": cookie}) as session:
            async with session.put(url, json=payload, timeout=aiohttp.ClientTimeout(10)) as resp:
                if resp.status in (200, 201):
                    logger.info(f"Muninn vault '{vault_name}' configured as public.")
                    return True
                if resp.status == 401:
                    _invalidate_session()
                    # Retry once with fresh session
                    return await ensure_vault_public(vault_name)
                body = await resp.text()
                logger.error(f"Failed to configure vault '{vault_name}' ({resp.status}): {body}")
                return False
    except Exception as exc:
        logger.error(f"Error configuring vault '{vault_name}': {exc}")
        return False
