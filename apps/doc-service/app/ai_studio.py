import logging
import os
import time

import requests

log = logging.getLogger(__name__)

API_URL_TPL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MODEL_DEFAULT = os.getenv("AI_STUDIO_MODEL", "gemini-2.5-flash")


def _strip_fence(text: str) -> str:
    """Remove markdown-style ``` fences when the model wraps JSON."""
    text = text.strip()
    if not text.startswith("```"):
        return text
    parts = text.split("```")
    if len(parts) < 2:
        return text
    inner = parts[1]
    if inner.startswith("json"):
        inner = inner.split("\n", 1)
        inner = inner[1] if len(inner) > 1 else ""
    return inner.strip()


def call_gemini_json(prompt: str, model: str | None = None, retries: int = 4) -> str:
    api_key = os.environ["AI_STUDIO_API_KEY"]
    primary_model = model or MODEL_DEFAULT
    models_to_try = [primary_model]
    if primary_model != MODEL_DEFAULT:
        models_to_try.append(MODEL_DEFAULT)

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
    }

    last_error: Exception | None = None

    for current_model in models_to_try:
        delay = 1.0
        max_output_tokens = 2048

        for attempt in range(max(1, retries)):
            url = f"{API_URL_TPL.format(model=current_model)}?key={api_key}"
            body = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": max_output_tokens,
                    "responseMimeType": "application/json",
                },
                "safetySettings": [],
            }

            try:
                response = requests.post(url, json=body, headers=headers, timeout=30)
                if response.status_code >= 400:
                    raise RuntimeError(f"{response.status_code} {response.text[:400]}")

                payload = response.json()
                candidates = payload.get("candidates") if isinstance(payload, dict) else None
                if not candidates:
                    log.error("AI Studio returned no candidates: %s", str(payload)[:400])
                    raise RuntimeError("No candidates returned")

                first_candidate = candidates[0]
                if not isinstance(first_candidate, dict):
                    log.error("AI Studio candidate has unexpected shape: %s", str(payload)[:400])
                    raise RuntimeError("Unexpected candidate shape")

                content = first_candidate.get("content")
                finish_reason = first_candidate.get("finishReason")
                parts: list[dict] = []
                if isinstance(content, dict):
                    maybe_parts = content.get("parts")
                    if isinstance(maybe_parts, list):
                        parts.extend([p for p in maybe_parts if isinstance(p, dict)])
                elif isinstance(content, list):
                    for item in content:
                        if not isinstance(item, dict):
                            continue
                        maybe_parts = item.get("parts")
                        if isinstance(maybe_parts, list):
                            parts.extend([p for p in maybe_parts if isinstance(p, dict)])

                if not parts:
                    if finish_reason == "MAX_TOKENS" and max_output_tokens < 8192:
                        max_output_tokens = min(8192, max_output_tokens * 2)
                        log.warning(
                            "AI Studio hit max tokens (model=%s); retrying with maxOutputTokens=%d",
                            current_model,
                            max_output_tokens,
                        )
                        time.sleep(delay)
                        delay = min(delay * 2, 8.0)
                        continue

                    log.error("AI Studio candidate missing parts: %s", str(payload)[:400])
                    raise RuntimeError("No text part returned")

                for part in parts:
                    text = part.get("text")
                    if isinstance(text, str) and text.strip():
                        return _strip_fence(text)

                log.error("AI Studio parts missing text field: %s", str(payload)[:400])
                raise RuntimeError("No text part returned")
            except Exception as exc:  # pragma: no cover - network interactions
                last_error = exc
                log.warning(
                    "AI Studio call failed (model=%s, attempt=%d/%d); retrying: %s",
                    current_model,
                    attempt + 1,
                    max(1, retries),
                    exc,
                )
                time.sleep(delay)
                delay = min(delay * 2, 8.0)

        log.warning("AI Studio model %s exhausted retries, trying next model if available", current_model)

    raise RuntimeError(f"AI Studio schema generation failed: {last_error}")
