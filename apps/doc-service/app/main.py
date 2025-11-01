import html
import logging
import re
from collections import OrderedDict
from io import BytesIO, UnsupportedOperation
from typing import Any, Dict, Iterable, List, Tuple
from zipfile import BadZipFile

from docx import Document
from docx.document import Document as DocumentType
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel


app = FastAPI(title="FluidFill Doc Service")
logger = logging.getLogger(__name__)


class Placeholder(BaseModel):
    key: str
    label: str
    occurrences: int


class ParseResult(BaseModel):
    document_id: str
    placeholders: List[Placeholder]


class SchemaField(BaseModel):
    key: str
    label: str
    question: str
    type: str
    required: bool = True
    helptext: str | None = None


class SchemaResponse(BaseModel):
    groups: List[Dict[str, Any]]


PLACEHOLDER_PATTERN = re.compile(r"\[([^\]]+)\]")

HTML_STYLES = """
<style>
body { background: #1a1b1f; color: #f4f4f5; font-family: 'Inter', sans-serif; margin: 0; padding: 1.5rem; }
.doc-body { max-width: 60rem; margin: 0 auto; }
.placeholder { color: #9d76dd; background: rgba(157,118,221,0.1); border-radius: 4px; padding: 0 3px; }
p { margin-bottom: 0.75rem; line-height: 1.6; }
table { width: 100%; border-collapse: collapse; margin-bottom: 1.25rem; }
td, th { border: 1px solid rgba(255,255,255,0.12); padding: 0.5rem; vertical-align: top; }
.empty-line { min-height: 1rem; }
</style>
""".strip()


def _to_snake_case(value: str) -> str:
    cleaned = re.sub(r"[^\w\s]", " ", value.strip())
    parts = [part.lower() for part in cleaned.split() if part]
    return "_".join(parts)


def _iter_block_items(parent: Any) -> Iterable[Any]:
    """Yield paragraphs and tables in document order for the given parent."""
    if isinstance(parent, DocumentType):
        parent_element = parent.element.body  # type: ignore[attr-defined]
    else:
        parent_element = getattr(parent, "_element", None)
    if parent_element is None:
        return []

    for child in parent_element.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, parent)
        elif isinstance(child, CT_Tbl):
            yield Table(child, parent)


def _highlight_placeholders(text: str) -> Tuple[str, int]:
    """Return HTML with highlighted placeholders and the count of replacements."""
    if not text:
        return "", 0

    result_parts: List[str] = []
    last_index = 0
    placeholder_count = 0

    for match in PLACEHOLDER_PATTERN.finditer(text):
        result_parts.append(html.escape(text[last_index:match.start()]))
        raw_label = match.group(1)
        label = " ".join(raw_label.split())
        key = _to_snake_case(label)
        if not key:
            # Treat as plain text when we cannot derive a key
            result_parts.append(html.escape(match.group(0)))
        else:
            placeholder_count += 1
            placeholder_literal = html.escape(match.group(0))
            result_parts.append(
                f'<span class="placeholder" data-key="{html.escape(key)}">{placeholder_literal}</span>'
            )
        last_index = match.end()

    result_parts.append(html.escape(text[last_index:]))
    rendered = "".join(result_parts).replace("\n", "<br />")
    return rendered, placeholder_count


def _render_paragraph(paragraph: Paragraph) -> Tuple[str, int]:
    text = paragraph.text or ""
    rendered, placeholder_count = _highlight_placeholders(text)
    if not rendered.strip():
        rendered = "&nbsp;"
        css_class = ' class="empty-line"'
    else:
        css_class = ""
    return f"<p{css_class}>{rendered}</p>", placeholder_count


def _render_table(table: Table) -> Tuple[str, int, int]:
    placeholder_total = 0
    paragraph_total = 0
    rows_html: List[str] = []

    for row in table.rows:
        cells_html: List[str] = []
        for cell in row.cells:
            cell_parts: List[str] = []
            cell_placeholder_count, cell_paragraphs = _render_blocks(cell, cell_parts)
            placeholder_total += cell_placeholder_count
            paragraph_total += cell_paragraphs
            cell_content = "".join(cell_parts).strip() or "&nbsp;"
            cells_html.append(f"<td>{cell_content}</td>")
        rows_html.append(f"<tr>{''.join(cells_html)}</tr>")

    table_html = f'<table class="doc-table">{"".join(rows_html)}</table>'
    return table_html, placeholder_total, paragraph_total


def _render_blocks(parent: Any, container: List[str]) -> Tuple[int, int]:
    placeholder_total = 0
    paragraph_total = 0

    for block in _iter_block_items(parent):
        if isinstance(block, Paragraph):
            paragraph_html, ph_count = _render_paragraph(block)
            container.append(paragraph_html)
            paragraph_total += 1
            placeholder_total += ph_count
        elif isinstance(block, Table):
            table_html, table_placeholders, table_paragraphs = _render_table(block)
            container.append(table_html)
            paragraph_total += table_paragraphs
            placeholder_total += table_placeholders

    return placeholder_total, paragraph_total


def _iter_all_paragraphs(parent: Any) -> Iterable[Paragraph]:
    for block in _iter_block_items(parent):
        if isinstance(block, Paragraph):
            yield block
        elif isinstance(block, Table):
            for row in block.rows:
                for cell in row.cells:
                    yield from _iter_all_paragraphs(cell)


def extract_placeholders(document: DocumentType) -> List[Placeholder]:
    placeholders: OrderedDict[str, Dict[str, Any]] = OrderedDict()

    for paragraph in _iter_all_paragraphs(document):
        if not paragraph.runs:
            continue
        text = "".join(run.text for run in paragraph.runs if run.text)
        if not text:
            continue

        for match in PLACEHOLDER_PATTERN.finditer(text):
            raw_label = match.group(1)
            label = " ".join(raw_label.split())
            if not label:
                continue

            key = _to_snake_case(label)
            if not key:
                continue

            placeholder_entry = placeholders.setdefault(
                key, {"label": label, "occurrences": 0}
            )
            placeholder_entry["occurrences"] += 1

    return [
        Placeholder(key=key, label=data["label"], occurrences=data["occurrences"])
        for key, data in placeholders.items()
    ]


def render_docx_to_html(file: UploadFile) -> str:
    file_stream = getattr(file, "file", None)
    if file_stream is None:
        raise ValueError("Missing file stream")

    try:
        file_stream.seek(0)
    except (AttributeError, UnsupportedOperation):
        pass

    contents = file_stream.read()
    if isinstance(contents, str):
        contents = contents.encode("utf-8")
    if not isinstance(contents, (bytes, bytearray)):
        raise ValueError("Unable to read uploaded document stream")

    try:
        document = Document(BytesIO(contents))
    except (BadZipFile, ValueError, KeyError) as exc:
        raise ValueError("Invalid DOCX file") from exc

    html_parts: List[str] = []
    placeholder_total, paragraph_total = _render_blocks(document, html_parts)

    document_name = file.filename or "document"
    logger.info(
        "Rendered HTML preview for %s with %d paragraphs and %d placeholders",
        document_name,
        paragraph_total,
        placeholder_total,
    )

    html_content = "".join(html_parts) or "<p>&nbsp;</p>"
    full_html = (
        "<!DOCTYPE html><html><head>"
        f"{HTML_STYLES}"
        "</head><body><div class=\"doc-body\">"
        f"{html_content}"
        "</div></body></html>"
    )

    try:
        file_stream.seek(0)
    except (AttributeError, UnsupportedOperation):
        pass

    return full_html


@app.get("/health")
async def health():
    return {"ok": True, "service": "doc-service"}


@app.post("/parse", response_model=ParseResult)
async def parse(file: UploadFile = File(...)):
    contents = await file.read()
    document_id = file.filename or "document"
    try:
        document = Document(BytesIO(contents))
    except (BadZipFile, ValueError, KeyError) as exc:
        logger.exception("Unable to open DOCX for %s", document_id)
        raise HTTPException(status_code=400, detail="Invalid DOCX file") from exc

    placeholder_models = extract_placeholders(document)

    logger.info(
        "Parsed %d placeholder types (%d total occurrences) from %s",
        len(placeholder_models),
        sum(placeholder.occurrences for placeholder in placeholder_models),
        document_id,
    )

    return ParseResult(
        document_id=document_id,
        placeholders=placeholder_models,
    )


@app.post("/to_html")
async def to_html(file: UploadFile = File(...)):
    try:
        html = render_docx_to_html(file)
    except ValueError as exc:
        logger.exception("Unable to render HTML for %s", file.filename or "document")
        raise HTTPException(status_code=400, detail="Invalid DOCX file") from exc
    except Exception as exc:
        logger.exception("Unexpected error rendering HTML for %s", file.filename or "document")
        raise HTTPException(status_code=500, detail="Failed to render HTML") from exc

    return {"html": html}


@app.post("/schema", response_model=SchemaResponse)
async def schema(payload: Dict[str, Any]):
    # TODO: call OpenAI to generate grouped fields based on placeholders + context
    resp = {
        "groups": [
            {
                "name": "Company",
                "fields": [
                    {"key": "company_name", "label": "Company Name", "question": "What is the company name?", "type": "string", "required": True}
                ],
            },
            {
                "name": "Investor",
                "fields": [
                    {"key": "investor_name", "label": "Investor Name", "question": "What is the investor's name?", "type": "string", "required": True}
                ],
            },
        ]
    }
    return resp


@app.post("/render")
async def render(payload: Dict[str, Any]):
    # TODO: apply answers to .docx and return a file URL or bytes
    return {"url": "https://example.com/download/stub.docx"}
