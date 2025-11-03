from typing import List, Optional, Literal

from pydantic import BaseModel, Field

FieldType = Literal["text", "email", "phone", "date", "number", "multiline", "select"]


class FieldSchema(BaseModel):
    key: str
    label: str
    type: FieldType = "text"
    required: bool = True
    help: Optional[str] = None
    repeat_group: Optional[str] = None
    targets: List[str] = Field(default_factory=list)


class SchemaGroup(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    fields: List[FieldSchema] = Field(default_factory=list)


class SchemaResponse(BaseModel):
    groups: List[SchemaGroup] = Field(default_factory=list)
