# FluidFill Doc Service

The doc-service parses uploaded `.docx` templates to extract placeholders, renders HTML previews, and now generates grouped form schemas using Google AI Studio (MakerSuite).

## Environment

Set the following variables before running the service:

- `GOOGLE_API_KEY` – MakerSuite API key (required for `/schema`).
- `GOOGLE_GENAI_MODEL` – optional, defaults to `gemini-2.5-flash`.
- `GOOGLE_GENAI_USE_VERTEXAI` – must remain `false`; the service forces MakerSuite even if this is set.

Example `.env` snippet:

```bash
GOOGLE_API_KEY=your_api_key_here
GOOGLE_GENAI_MODEL=gemini-2.5-flash
GOOGLE_GENAI_USE_VERTEXAI=false
```

## Running locally

```bash
pip install -e apps/doc-service
cd apps/doc-service
uvicorn app.main:app --reload
```

## Generating a schema

Send placeholders (name + occurrences and optional context) to the `/schema` endpoint:

```bash
curl -X POST "$DOC_SERVICE_URL/schema" \
  -H "Content-Type: application/json" \
  -d '{"placeholders":[{"name":"COMPANY","occurrences":3},{"name":"INVESTOR_EMAIL","occurrences":1}]}'
```

Sample response:

```json
{
  "groups": [
    {
      "id": "company",
      "title": "Company Details",
      "fields": [
        {
          "key": "company_name",
          "label": "Company Name",
          "type": "text",
          "required": true,
          "repeat_group": "company_name"
        }
      ]
    }
  ]
}
```
