"""Bearer-protected local artifact service; transactional persistence remains a separate port."""
from __future__ import annotations
from datetime import datetime, timezone
import hmac
import json
import math
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
Paint = Annotated[str, Field(pattern=r'^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|none)$')]
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


class TextLayout(BaseModel):
    model_config = ConfigDict(extra='forbid')
    sizing: Literal['fixed', 'content', 'width', 'height']
    wrap: Annotated[bool, Field(strict=True)]
    hyphenate: Annotated[bool, Field(strict=True)]
    fit: Annotated[bool, Field(strict=True)]

    @model_validator(mode='after')
    def fixed_fit(self):
        if self.fit and self.sizing != 'fixed':
            raise ValueError('Text fit requires fixed sizing')
        return self


class Typography(BaseModel):
    model_config = ConfigDict(extra='forbid')
    fontFamily: Literal['sans-serif', 'serif', 'monospace', 'Arial', 'Georgia', 'Times New Roman',
                        'Courier New', 'Verdana', 'Trebuchet MS']
    fontWeight: Annotated[Number, Field(ge=100, le=900, multiple_of=100)]
    fontStyle: Literal['normal', 'italic']
    lineHeight: Annotated[Number, Field(ge=0, le=2000)]
    letterSpacing: Annotated[Number, Field(ge=-100, le=500)]
    wordSpacing: Annotated[Number, Field(ge=-100, le=1000)]
    paragraphSpacing: Annotated[Number, Field(ge=0, le=2000)]
    horizontalScale: Annotated[Number, Field(ge=0.1, le=10)]
    verticalScale: Annotated[Number, Field(ge=0.1, le=10)]
    baselineShift: Annotated[Number, Field(ge=-1000, le=1000)]
    align: Literal['left', 'center', 'right', 'justify']
    decoration: Literal['none', 'underline', 'line-through']
    language: Literal['en', 'es']


class StrokeStyle(BaseModel):
    model_config = ConfigDict(extra='forbid')
    alignment: Literal['center', 'inside', 'outside']
    join: Literal['round', 'bevel', 'miter']
    cap: Literal['butt', 'square', 'round']
    dash: Annotated[list[Annotated[Number, Field(ge=0, le=1000)]], Field(min_length=1, max_length=6)] | None = None

    @model_validator(mode='after')
    def dash_contract(self):
        if 'dash' in self.model_fields_set and self.dash is None:
            raise ValueError('Dash pattern cannot be null')
        if self.dash is not None and not any(value > 0 for index, value in enumerate(self.dash) if index % 2 == 0):
            raise ValueError('Dash pattern needs at least one dash longer than zero')
        return self


class LineEnd(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['none', 'arrow', 'openArrow', 'triangle', 'dot', 'slash', 'cross']
    placement: Literal['tip', 'base']
    size: Annotated[Number, Field(gt=0, le=1000)]


class LineEnds(BaseModel):
    model_config = ConfigDict(extra='forbid')
    start: LineEnd
    end: LineEnd
    linked: Annotated[bool, Field(strict=True)]


class DimensionPoint(BaseModel):
    model_config = ConfigDict(extra='forbid')
    x: Annotated[Number, Field(ge=-10000000, le=10000000)]
    y: Annotated[Number, Field(ge=-10000000, le=10000000)]


class DimensionFormat(BaseModel):
    model_config = ConfigDict(extra='forbid')
    scale: Annotated[Number, Field(gt=0, le=1000000)]
    unit: Literal['px', 'pt', 'mm', 'cm', 'm', 'in', 'ft']
    decimals: Annotated[Number, Field(ge=0, le=8, multiple_of=1)]
    separator: Literal['.', ',']


class DimensionExtension(BaseModel):
    model_config = ConfigDict(extra='forbid')
    stroke: Paint
    strokeWidth: Annotated[Number, Field(ge=0, le=1000)]
    gap: Annotated[Number, Field(ge=0, le=1000)]
    overshoot: Annotated[Number, Field(ge=0, le=1000)]


class DimensionLabelSize(BaseModel):
    model_config = ConfigDict(extra='forbid')
    width: Annotated[Number, Field(ge=1, le=1000000)]
    height: Annotated[Number, Field(ge=1, le=1000000)]


class Dimension(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['linear', 'angular', 'radius', 'diameter']
    anchors: Annotated[list[DimensionPoint], Field(min_length=2, max_length=3)]
    labelPosition: DimensionPoint
    labelSize: DimensionLabelSize | None = None
    labelPlacement: Literal['start', 'center', 'end'] | None = None
    centerMark: bool | None = None
    text: Annotated[str, Field(max_length=10000)]
    format: DimensionFormat
    extension: DimensionExtension

    @model_validator(mode='after')
    def anchor_cardinality(self):
        if 'centerMark' in self.model_fields_set and self.centerMark is None:
            raise ValueError('Dimension centre mark cannot be null')
        if 'labelPlacement' in self.model_fields_set and self.labelPlacement is None:
            raise ValueError('Dimension label placement cannot be null')
        if 'labelSize' in self.model_fields_set and self.labelSize is None:
            raise ValueError('Dimension label size cannot be null')
        if len(self.anchors) != (3 if self.kind == 'angular' else 2):
            raise ValueError('Dimension anchors must match its kind')
        return self


ProceduralLength = Annotated[Number, Field(ge=1, le=16384)]


class ProceduralHost(BaseModel):
    model_config = ConfigDict(extra='forbid')
    wallId: Annotated[str, Field(min_length=1, max_length=100)]
    offset: Annotated[Number, Field(ge=0, le=1)]


class ProceduralWall(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['wall']
    start: DimensionPoint
    end: DimensionPoint
    thickness: ProceduralLength
    align: Literal['center', 'left', 'right'] | None = None

    @model_validator(mode='after')
    def nonzero_wall(self):
        if 'align' in self.model_fields_set and self.align is None:
            raise ValueError('Wall alignment cannot be null')
        if not 1 <= math.hypot(self.end.x - self.start.x, self.end.y - self.start.y) <= 16384:
            raise ValueError('Wall length must be between 1 and 16384')
        return self


LeafType = Literal['swing', 'sliding', 'folding', 'pocket', 'fixed']


class ProceduralOpening(BaseModel):
    model_config = ConfigDict(extra='forbid')
    width: ProceduralLength
    depth: ProceduralLength
    leafWidths: Annotated[list[ProceduralLength], Field(min_length=1, max_length=8)]
    leafTypes: Annotated[list[LeafType], Field(min_length=1, max_length=8)] | None = None
    side: Literal['front', 'back'] | None = None
    openingAngle: Annotated[Number, Field(ge=0, le=180)]
    host: ProceduralHost | None = None

    @model_validator(mode='after')
    def opening_contract(self):
        for optional in ('host', 'leafTypes', 'side'):
            if optional in self.model_fields_set and getattr(self, optional) is None:
                raise ValueError(f'Opening {optional} cannot be null')
        if self.leafTypes is not None and len(self.leafTypes) != len(self.leafWidths):
            raise ValueError('Leaf types must match the number of leaves')
        if abs(sum(self.leafWidths) - self.width) > 0.000001:
            raise ValueError('Opening leaves must sum to its width')
        return self


class ProceduralDoor(ProceduralOpening):
    type: Literal['door']
    leafWidths: Annotated[list[ProceduralLength], Field(min_length=1, max_length=4)]
    leafTypes: Annotated[list[LeafType], Field(min_length=1, max_length=4)] | None = None
    operation: Literal['swing', 'sliding', 'folding', 'pocket', 'opening']
    swing: Literal['left', 'right']


class ProceduralWindow(ProceduralOpening):
    type: Literal['window']
    operation: Literal['fixed', 'sliding', 'swing', 'opening']
    swing: Literal['left', 'right']


class ProceduralStair(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['stair']
    width: ProceduralLength
    length: ProceduralLength
    steps: Annotated[int, Field(ge=2, le=100)]
    direction: Literal['up', 'down']


class ProceduralPillar(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['pillar']
    shape: Literal['rectangle', 'circle']
    width: ProceduralLength
    depth: ProceduralLength

    @model_validator(mode='after')
    def circular_pillar(self):
        if self.shape == 'circle' and abs(self.width - self.depth) > 0.000001:
            raise ValueError('Circular pillars require equal width and depth')
        return self


Procedural = Annotated[ProceduralWall | ProceduralDoor | ProceduralWindow | ProceduralPillar | ProceduralStair,
                       Field(discriminator='type')]


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
    fill: Paint
    stroke: Paint
    strokeWidth: Annotated[Number, Field(ge=0, le=200)]
    points: Annotated[list[Point], Field(max_length=20000)]
    text: Annotated[str, Field(max_length=2000)]
    fontSize: Annotated[Number, Field(ge=1, le=500)]
    source: str
    adjustments: Adjustments
    strokeStyle: StrokeStyle | None = None
    lineEnds: LineEnds | None = None
    dimension: Dimension | None = None
    procedural: Procedural | None = None
    regroupPath: Annotated[list[Annotated[str, Field(min_length=1, max_length=100)]], Field(max_length=16)] | None = None
    textLayout: TextLayout | None = None
    typography: Typography | None = None
    guide: Literal['vertical', 'horizontal'] | None = None
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
        if isinstance(value, dict) and any(key in value and value[key] is None for key in ('curves', 'symbolId', 'traceSourceId', 'groupPath', 'flipX', 'flipY', 'skewX', 'guide', 'textLayout', 'typography', 'strokeStyle', 'lineEnds', 'dimension', 'regroupPath', 'procedural')):
            raise ValueError('Drawing extensions cannot be null')
        return value

    @model_validator(mode='after')
    def curve_budget(self):
        if self.curves is not None and (self.kind != 'path' or sum(len(p.nodes) for p in self.curves) > 20000):
            raise ValueError('Invalid curve layer or node budget')
        if self.groupPath is not None and len(set(self.groupPath)) != len(self.groupPath):
            raise ValueError('Group path identities must be unique')
        if self.regroupPath is not None and len(set(self.regroupPath)) != len(self.regroupPath):
            raise ValueError('Regroup path identities must be unique')
        if self.procedural is not None and (self.kind != 'path' or self.dimension is not None or self.guide is not None or self.symbolId is not None):
            raise ValueError('Procedural objects must be standalone paths')
        if self.dimension is not None and (self.kind != 'path' or self.guide is not None or self.symbolId is not None):
            raise ValueError('Dimensions must be paths without guides or symbol references')
        if self.kind != 'text' and self.dimension is None and (self.textLayout is not None or self.typography is not None):
            raise ValueError('Text layout and typography require a text layer')
        if self.guide is not None and (self.kind != 'path' or self.symbolId is not None or self.groupPath):
            raise ValueError('Guides must be ungrouped paths without symbol references')
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


BlendIdentity = Annotated[str, Field(min_length=1, max_length=100)]
BlendLayerIds = Annotated[list[BlendIdentity], Field(min_length=1, max_length=150)]


class ObjectBlend(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: BlendIdentity
    groupId: BlendIdentity
    backIds: BlendLayerIds
    frontIds: BlendLayerIds
    stepIds: Annotated[list[BlendLayerIds], Field(min_length=1, max_length=100)]
    steps: Annotated[Number, Field(ge=1, le=100, multiple_of=1)]
    easing: Literal['linear', 'ease-in', 'ease-out', 'ease-in-out']


class Document(BaseModel):
    model_config = ConfigDict(extra='forbid')
    format: Literal['ximply-document']
    version: Literal[1, 2]
    name: Annotated[str, Field(max_length=150)]
    width: Annotated[int, Field(ge=16, le=8192)]
    height: Annotated[int, Field(ge=16, le=8192)]
    background: Paint
    layers: Annotated[list[Layer], Field(max_length=1000)]
    blends: Annotated[list[ObjectBlend], Field(max_length=150)] | None = None
    symbols: Annotated[list[SymbolDefinition], Field(max_length=100)] | None = None

    @model_validator(mode='before')
    @classmethod
    def non_nullable_symbols(cls, value):
        if isinstance(value, dict) and any(key in value and value[key] is None for key in ('symbols', 'blends')):
            raise ValueError('Document extensions cannot be null')
        return value

    @model_validator(mode='after')
    def symbol_and_version_contract(self):
        symbols = self.symbols or []
        ids = {symbol.id for symbol in symbols}
        if len(ids) != len(symbols) or any(symbol.layer.symbolId is not None or symbol.layer.guide is not None or symbol.layer.dimension is not None or symbol.layer.procedural is not None for symbol in symbols):
            raise ValueError('Invalid symbol definitions')
        if any(layer.symbolId is not None and layer.symbolId not in ids for layer in self.layers):
            raise ValueError('Unknown symbol reference')
        if self.version == 1 and ('symbols' in self.model_fields_set or 'blends' in self.model_fields_set or any(
                layer.curves is not None or layer.symbolId is not None or layer.traceSourceId is not None
                or layer.guide is not None or layer.fill == 'none' or layer.stroke == 'none'
                or layer.strokeStyle is not None or layer.lineEnds is not None
                or layer.dimension is not None or layer.regroupPath is not None or layer.procedural is not None
                or layer.textLayout is not None or layer.typography is not None
                or len(layer.fill) == 9 or len(layer.stroke) == 9
                or layer.skewX is not None or layer.groupPath is not None or layer.flipX is not None or layer.flipY is not None
                for layer in self.layers)):
            raise ValueError('Drawing extensions require native format 2')
        return self

    @model_validator(mode='after')
    def procedural_reference_contract(self):
        layers = {layer.id: layer for layer in self.layers}
        for layer in self.layers:
            item = layer.procedural
            if not isinstance(item, (ProceduralDoor, ProceduralWindow)) or item.host is None:
                continue
            wall = layers.get(item.host.wallId)
            if wall is None or wall.id == layer.id or not isinstance(wall.procedural, ProceduralWall):
                raise ValueError('Opening hosts must reference a wall in the document')
            dx = (wall.procedural.end.x - wall.procedural.start.x) * (-1 if wall.flipX else 1)
            dy = (wall.procedural.end.y - wall.procedural.start.y) * (-1 if wall.flipY else 1)
            length = math.hypot(dx + math.tan(math.radians(wall.skewX or 0)) * dy, dy)
            center = item.host.offset * length
            if center - item.width / 2 < -0.000001 or center + item.width / 2 > length + 0.000001:
                raise ValueError('Hosted openings must fit inside their wall segment')
        return self

    @model_validator(mode='after')
    def blend_reference_contract(self):
        blends = self.blends or []
        if len({blend.id for blend in blends}) != len(blends) or len({blend.groupId for blend in blends}) != len(blends):
            raise ValueError('Blend and blend group identities must be unique')
        layer_map = {layer.id: layer for layer in self.layers}
        layer_order = [layer.id for layer in self.layers]
        used = set()
        for blend in blends:
            count = len(blend.backIds)
            if len(blend.frontIds) != count or len(blend.stepIds) != blend.steps or any(len(row) != count for row in blend.stepIds):
                raise ValueError('Blend steps must match endpoint cardinality')
            ordered = blend.backIds + [identifier for row in blend.stepIds for identifier in row] + blend.frontIds
            references = set(ordered)
            if len(references) != len(ordered) or references & used or not references.issubset(layer_map):
                raise ValueError('Blend references must exist and be globally unique')
            used.update(references)
            start = layer_order.index(ordered[0])
            if layer_order[start:start + len(ordered)] != ordered:
                raise ValueError('Blend layers must form an ordered contiguous block')
            back_path = layer_map[blend.backIds[0]].groupPath or []
            if blend.groupId not in back_path:
                raise ValueError('Blend group must contain its endpoint layers')
            prefix = back_path[:back_path.index(blend.groupId) + 1]
            members = {layer.id for layer in self.layers if blend.groupId in (layer.groupPath or [])}
            if members != references or any((layer_map[identifier].groupPath or [])[:len(prefix)] != prefix for identifier in ordered):
                raise ValueError('Blend group must contain exactly its referenced layers under a shared parent')
            for identifier in ordered:
                layer = layer_map[identifier]
                if layer.kind not in ('rectangle', 'ellipse', 'path') or layer.guide is not None or layer.symbolId is not None or layer.dimension is not None or layer.procedural is not None:
                    raise ValueError('Blend layers must be standalone vectors')
            for row in blend.stepIds:
                if any(layer_map[identifier].groupPath != prefix + [row[0]] for identifier in row):
                    raise ValueError('Blend step layers must share their row subgroup')
            rows = [blend.backIds, *blend.stepIds, blend.frontIds]
            for index in range(count):
                topology = [self.blend_contours(layer_map[row[index]]) for row in rows]
                if any(value != topology[0] for value in topology[1:]):
                    raise ValueError('Blend contour count and closure must match')
        return self

    @staticmethod
    def blend_contours(layer: Layer) -> list[bool]:
        if layer.kind in ('rectangle', 'ellipse'):
            return [True]
        contours = [(curve.closed, len(curve.nodes)) for curve in layer.curves] if layer.curves is not None else [(False, len(layer.points))]
        if not contours or any(count < (3 if closed else 2) or count > 256 for closed, count in contours):
            raise ValueError('Blend contours require supported node counts')
        return [closed for closed, _ in contours]

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
