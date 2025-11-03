import importlib
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

DOC_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(DOC_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(DOC_SERVICE_ROOT))

_MODULES_TO_CLEAR = ("app.main", "app.ai_studio")


def _reload_app():
    for module_name in _MODULES_TO_CLEAR:
        if module_name in sys.modules:
            del sys.modules[module_name]
    module = importlib.import_module("app.main")
    return module.app


class SchemaEndpointTests(unittest.TestCase):
    def setUp(self):
        self._env_backup = {
            "AI_STUDIO_API_KEY": os.environ.get("AI_STUDIO_API_KEY"),
            "ENABLE_DEV_ROUTES": os.environ.get("ENABLE_DEV_ROUTES"),
            "AI_STUDIO_MODEL": os.environ.get("AI_STUDIO_MODEL"),
        }
        for key in self._env_backup:
            os.environ.pop(key, None)
        os.environ["AI_STUDIO_API_KEY"] = "test-key"
        for module_name in _MODULES_TO_CLEAR:
            sys.modules.pop(module_name, None)

    def tearDown(self):
        for module_name in _MODULES_TO_CLEAR:
            sys.modules.pop(module_name, None)
        for key, value in self._env_backup.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_schema_requires_api_key(self):
        os.environ.pop("AI_STUDIO_API_KEY", None)
        app = _reload_app()
        client = TestClient(app)
        response = client.post("/schema", json={"placeholders": []})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json().get("detail"), "AI_STUDIO_API_KEY not configured")

    def test_schema_returns_502_on_invalid_json(self):
        os.environ["AI_STUDIO_API_KEY"] = "test-key"
        app = _reload_app()
        client = TestClient(app)
        with mock.patch("app.main.call_gemini_json", return_value="not json"):
            response = client.post(
                "/schema",
                json={"placeholders": [{"name": "company_name", "occurrences": 1}]},
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json().get("detail"), "schema_generation_failed")

    def test_schema_success_with_code_fence(self):
        os.environ["AI_STUDIO_API_KEY"] = "test-key"
        app = _reload_app()
        client = TestClient(app)
        schema_payload = {
            "groups": [
                {
                    "id": "company",
                    "title": "Company",
                    "fields": [
                        {
                            "key": "company_name",
                            "label": "Company Name",
                            "type": "text",
                            "required": True,
                        }
                    ],
                }
            ]
        }
        fenced_response = f"```json\n{json.dumps(schema_payload)}\n```"
        with mock.patch("app.main.call_gemini_json", return_value=fenced_response):
            response = client.post(
                "/schema",
                json={"placeholders": [{"name": "company_name", "occurrences": 2}]},
            )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data.get("groups", [])), 1)
        self.assertEqual(data["groups"][0]["fields"][0]["key"], "company_name")

    def test_dev_route_disabled_without_flag(self):
        os.environ["AI_STUDIO_API_KEY"] = "test-key"
        app = _reload_app()
        client = TestClient(app)
        response = client.get("/dev/ai-studio-ping")
        self.assertEqual(response.status_code, 404)

    def test_dev_route_enabled_with_flag(self):
        os.environ["AI_STUDIO_API_KEY"] = "test-key"
        os.environ["ENABLE_DEV_ROUTES"] = "true"
        app = _reload_app()
        client = TestClient(app)
        with mock.patch("app.main.call_gemini_json", return_value='{"ok": true}'):
            response = client.get("/dev/ai-studio-ping")
        self.assertEqual(response.status_code, 200)
        self.assertIn("raw", response.json())
