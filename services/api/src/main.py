"""Bearer-protected local artifact service; transactional persistence remains a separate port."""
from __future__ import annotations
from datetime import datetime, timezone
import hmac
import json
import os
from pathlib import Path
import re
import tempfile
from threading import Lock
from typing import Annotated, Literal, Protocol
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

MAX_DOCUMENT = 35_000_000
MAX_STORAGE = 512_000_000
Color = Annotated[str, Field(pattern=r'^#[0-9a-fA-F]{6}$')]
Number = Annotated[float, Field(allow_inf_nan=False, strict=True)]


class Point(BaseModel):
    model_config = ConfigDict(extra='forbid')
    x: Annotated[Number, Field(ge=-100000, le=100000)]
    y: Annotated[Number, Field(ge=-100000, le=100000)]


class Anchor(BaseModel):
    model_config = ConfigDict(extra='forbid')
    point: Point
    incoming: Point
    outgoing: Point
    smooth: Annotated[bool, Field(strict=True)]


class CurvePath(BaseModel):
    model_config = ConfigDict(extra='forbid')
    nodes: Annotated[list[Anchor], Field(max_length=20000)]
    closed: Annotated[bool, Field(strict=True)]


class Adjustments(BaseModel):
    model_config = ConfigDict(extra='forbid')
    brightness: Annotated[Number, Field(ge=0, le=200)]
    contrast: Annotated[Number, Field(ge=0, le=200)]
    saturation: Annotated[Number, Field(ge=0, le=200)]
    blur: Annotated[Number, Field(ge=0, le=30)]


class Layer(Point):
    id: Annotated[str, Field(min_length=1, max_length=100)]
    name: Annotated[str, Field(max_length=150)]
    kind: Literal['rectangle', 'ellipse', 'path', 'text', 'image']
    width: Annotated[Number, Field(ge=1, le=16384)]
    height: Annotated[Number, Field(ge=1, le=16384)]
    rotation: Annotated[Number, Field(ge=-100000, le=100000)]
    opacity: Annotated[Number, Field(ge=0, le=1)]
    visible: bool
    locked: bool
    blend: Literal['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten']
    fill: Color
    stroke: Color
    strokeWidth: Annotated[Number, Field(ge=0, le=200)]
    points: Annotated[list[Point], Field(max_length=20000)]
    text: Annotated[str, Field(max_length=2000)]
    fontSize: Annotated[Number, Field(ge=1, le=500)]
    source: str
    adjustments: Adjustments
    curves: Annotated[list[CurvePath], Field(max_length=4096)] | None = None
    symbolId: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    traceSourceId: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    groupPath: Annotated[list[Annotated[str, Field(min_length=1, max_length=100)]], Field(max_length=16)] | None = None
    skewX: Annotated[Number, Field(ge=-89.9999, le=89.9999)] | None = None
    flipX: Annotated[bool, Field(strict=True)] | None = None
    flipY: Annotated[bool, Field(strict=True)] | None = None

    @model_validator(mode='before')
    @classmethod
    def non_nullable_extensions(cls, value):
        if isinstance(value, dict) and any(key in value and value[key] is None for key in ('curves', 'symbolId', 'traceSourceId', 'groupPath', 'flipX', 'flipY', 'skewX')):
            raise ValueError('Drawing extensions cannot be null')
        return value

    @model_validator(mode='after')
    def curve_budget(self):
        if self.curves is not None and (self.kind != 'path' or sum(len(p.nodes) for p in self.curves) > 20000):
            raise ValueError('Invalid curve layer or node budget')
        if self.groupPath is not None and len(set(self.groupPath)) != len(self.groupPath):
            raise ValueError('Group path identities must be unique')
        return self

    @field_validator('source')
    @classmethod
    def safe_image(cls, value: str) -> str:
        if value and not re.fullmatch(r'data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+', value):
            raise ValueError('Only embedded raster images are supported')
        return value


class SymbolDefinition(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: Annotated[str, Field(min_length=1, max_length=100)]
    name: Annotated[str, Field(max_length=150)]
    layer: Layer


class Document(BaseModel):
    model_config = ConfigDict(extra='forbid')
    format: Literal['ximply-document']
    version: Literal[1, 2]
    name: Annotated[str, Field(max_length=150)]
    width: Annotated[int, Field(ge=16, le=4096)]
    height: Annotated[int, Field(ge=16, le=4096)]
    background: Color
    layers: Annotated[list[Layer], Field(max_length=150)]
    symbols: Annotated[list[SymbolDefinition], Field(max_length=100)] | None = None

    @model_validator(mode='before')
    @classmethod
    def non_nullable_symbols(cls, value):
        if isinstance(value, dict) and 'symbols' in value and value['symbols'] is None:
            raise ValueError('Symbol library cannot be null')
        return value

    @model_validator(mode='after')
    def symbol_and_version_contract(self):
        symbols = self.symbols or []
        ids = {symbol.id for symbol in symbols}
        if len(ids) != len(symbols) or any(symbol.layer.symbolId is not None for symbol in symbols):
            raise ValueError('Invalid symbol definitions')
        if any(layer.symbolId is not None and layer.symbolId not in ids for layer in self.layers):
            raise ValueError('Unknown symbol reference')
        if self.version == 1 and ('symbols' in self.model_fields_set or any(
                layer.curves is not None or layer.symbolId is not None or layer.traceSourceId is not None
                or layer.skewX is not None or layer.groupPath is not None or layer.flipX is not None or layer.flipY is not None
                for layer in self.layers)):
            raise ValueError('Drawing extensions require native format 2')
        return self

    @field_validator('layers')
    @classmethod
    def unique_layers(cls, layers: list[Layer]) -> list[Layer]:
        if len({layer.id for layer in layers}) != len(layers):
            raise ValueError('Layer identities must be unique')
        return layers


class DocumentRepository(Protocol):
    def create(self, document: Document) -> str: ...
    def read(self, identifier: str) -> Document: ...
    def list(self) -> list[dict]: ...


class FileDocumentRepository:
    """Single-user artifact adapter; does not implement PostgreSQL transactions."""
    def __init__(self, directory: Path):
        self.directory = directory
        self.lock = Lock()

    def create(self, document: Document) -> str:
        payload = document.model_dump_json(exclude_none=True)
        with self.lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            files = list(self.directory.glob('*.json'))
            if len(files) >= 500 or sum(path.stat().st_size for path in files) + len(payload.encode()) > MAX_STORAGE:
                raise HTTPException(507, 'Local artifact storage limit reached')
            identifier = str(uuid4())
            temporary = None
            try:
                with tempfile.NamedTemporaryFile('w', dir=self.directory, encoding='utf-8', delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(payload)
                    stream.flush()
                    os.fsync(stream.fileno())
                temporary.replace(self.directory / f'{identifier}.json')
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            return identifier

    def read(self, identifier: str) -> Document:
        if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', identifier):
            raise HTTPException(404, 'Project not found')
        try:
            return Document.model_validate_json((self.directory / f'{identifier}.json').read_bytes())
        except FileNotFoundError:
            raise HTTPException(404, 'Project not found') from None
        except ValidationError:
            raise HTTPException(500, 'Stored project is invalid') from None

    def list(self) -> list[dict]:
        result = []
        for path in sorted(self.directory.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:500]:
            try:
                document = self.read(path.stem)
                result.append({'id': path.stem, 'name': document.name,
                               'updatedAt': datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()})
            except HTTPException:
                continue
        return result


def inline_document_schema() -> dict:
    schema = Document.model_json_schema()
    definitions = schema.pop('$defs', {})
    def expand(value):
        if isinstance(value, dict):
            if '$ref' in value:
                return expand(definitions[value['$ref'].split('/')[-1]])
            return {key: expand(child) for key, child in value.items()}
        if isinstance(value, list):
            return [expand(child) for child in value]
        return value
    return expand(schema)


def create_app(repository: DocumentRepository | None = None, token: str | None = None) -> FastAPI:
    configured_version = os.environ.get('XDS_VERSION_FILE')
    version_file = Path(configured_version) if configured_version else Path(__file__).resolve().parents[3]/'release/version.json'
    version = json.loads(version_file.read_text())['version']
    app = FastAPI(title='Ximply Design Studio local artifact API', version=version, docs_url='/api/docs', openapi_url='/api/openapi.json')
    store = repository or FileDocumentRepository(Path(os.environ.get('XDS_DATA_DIR', './data')))
    secret = token if token is not None else os.environ.get('XDS_API_TOKEN', '')
    bearer = HTTPBearer(auto_error=False)

    def authenticated(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if len(secret) < 32:
            raise HTTPException(503, 'Local API token is not configured')
        if credentials is None or not hmac.compare_digest(credentials.credentials, secret):
            raise HTTPException(401, 'Invalid bearer token', headers={'WWW-Authenticate': 'Bearer'})

    @app.get('/api/health', tags=['health'])
    def health():
        return {'status': 'ok', 'mode': 'single-user-local-preview', 'storageConfigured': len(secret) >= 32, 'version': version}

    @app.get('/api/projects', dependencies=[Depends(authenticated)], tags=['projects'])
    async def projects():
        return await run_in_threadpool(store.list)

    @app.post('/api/projects', status_code=201, dependencies=[Depends(authenticated)], tags=['projects'],
              openapi_extra={'requestBody': {'required': True, 'content': {'application/json': {'schema': inline_document_schema()}}}})
    async def save(request: Request):
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_DOCUMENT:
                raise HTTPException(413, 'Project exceeds the 35 MB preview limit')
            chunks.append(chunk)
        try:
            document = Document.model_validate_json(b''.join(chunks))
        except ValidationError:
            raise HTTPException(422, 'Invalid native project document') from None
        identifier = await run_in_threadpool(store.create, document)
        return {'id': identifier, 'name': document.name}

    @app.get('/api/projects/{identifier}', dependencies=[Depends(authenticated)], response_model=Document, response_model_exclude_none=True, tags=['projects'])
    async def read(identifier: str):
        return await run_in_threadpool(store.read, identifier)

    return app


app = create_app()
