import logging
import os
from typing import Dict

import google.generativeai as genai
import requests

log = logging.getLogger(__name__)
_MODEL_DEFAULT = os.getenv("AI_STUDIO_MODEL", "gemini-2.5-flash")


def _configure() -> str:
    """Ensure the SDK is configured and return the API key in use."""
    api_key = os.environ["AI_STUDIO_API_KEY"]
    genai.configure(api_key=api_key)  # type: ignore[attr-defined]
    return api_key


def generate_json_with_sdk(prompt: str, model: str | None = None) -> str:
    _configure()
    mdl = model or _MODEL_DEFAULT
    response = genai.GenerativeModel(mdl).generate_content(prompt)  # type: ignore[attr-defined]
    return response.text or ""


def generate_json_with_rest(prompt: str, model: str | None = None) -> Dict:
    api_key = _configure()
    mdl = model or _MODEL_DEFAULT
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{mdl}:generateContent"
        f"?key={api_key}"
    )
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
    }
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2},
        "safetySettings": [],
    }
    response = requests.post(url, json=body, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def generate_schema_json(prompt: str, model: str | None = None) -> str:
    """
    Try SDK first (fast/simple), fall back to REST. Always return a JSON string.
    """
    try:
        text = generate_json_with_sdk(prompt, model=model)
        if text.strip():
            return text
    except Exception as exc:  # pragma: no cover - network interactions
        log.warning("SDK path failed, falling back to REST: %s", exc)

    data = generate_json_with_rest(prompt, model=model)
    try:
        candidates = data["candidates"]
        first = candidates[0]
        parts = first["content"]["parts"]
        for part in parts:
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                return text
    except Exception as exc:  # pragma: no cover - defensive logging
        log.error("Unexpected REST response shape: %s", exc)
    return ""
