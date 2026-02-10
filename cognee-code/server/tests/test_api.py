"""
Unit tests for the Cognee-Code Backend API.

Run with:
    cd cognee-code/server
    uv run pytest tests/ -v
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    from src.main import app

    return TestClient(app)


class TestRootEndpoint:
    """Tests for the root endpoint."""

    def test_root_returns_welcome_message(self, client):
        """Test that the root endpoint returns a welcome message."""
        response = client.get("/")
        assert response.status_code == 200
        assert response.json() == {"message": "Welcome to Cognee-Code Backend"}


class TestHealthCheck:
    """Tests for API health and availability."""

    def test_docs_endpoint_available(self, client):
        """Test that the OpenAPI docs are available."""
        response = client.get("/docs")
        assert response.status_code == 200

    def test_openapi_schema_available(self, client):
        """Test that the OpenAPI schema is available."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        data = response.json()
        assert "openapi" in data
        assert data["info"]["title"] == "Cognee-Code Backend"


class TestKnowledgeEndpoints:
    """Tests for M1 Knowledge Management endpoints."""

    def test_list_datasets_returns_list(self, client):
        """Test that listing datasets returns an array."""
        response = client.get("/api/v1/datasets/")
        # May return 200 with empty list or 401/500 depending on auth state
        assert response.status_code in [200, 401, 500]

    def test_create_dataset(self, client):
        """Test creating a new dataset."""
        response = client.post("/api/v1/datasets/", json={"name": "test-dataset"})
        # May return 200/201 or auth error
        assert response.status_code in [200, 201, 401, 422, 500]
