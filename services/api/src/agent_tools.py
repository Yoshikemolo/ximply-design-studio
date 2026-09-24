"""Agent tools: requests to an external model with the context the user chose (FEAT-0029, ADR-0037).

The browser sends a prompt, a quick action, the scope and the attachments it shows (the selected
objects as data and as a PNG, and the whole document as a PNG). The service calls OpenAI with the
token of the user who asks, validates what comes back and returns one new object for the editor
to insert: a PNG picture, or an SVG drawing the editor imports as editable paths and groups.
Model output is untrusted data (SEC-0012); prompts and pixels are never logged or audited.
"""
import base64
import binascii
import hashlib
import json
import os
import re
import threading
import uuid
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Callable, Literal, Protocol

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from .external_tokens import TokenVault
from .identity import AuditLog, IdentityError, require_permission

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_SVG_CHARS = 2_000_000
# OpenAI's recommended image model for editing, current in September 2026.
DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-flare'
# The balanced model with image input that draws editable vectors.
DEFAULT_TEXT_MODEL = 'gpt-6-sol'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
OPENAI = 'https://api.openai.com/v1'

Action = Literal['free', 'style', 'reinterpret', 'upscale', 'enhance', 'remove-watermark', 'remove-background', 'remove-object', 'vectorize']
ACTIONS: dict[str, str] = {
    'free': 'Apply the instruction of the user.',
    'style': 'Change the visual style of the artwork as the user describes, keeping its composition and what it depicts.',
    'reinterpret': 'Reinterpret the artwork in the style the user names, keeping what it depicts and its composition.',
    'upscale': 'Rescale the image to a higher resolution, keeping every detail and adding no new content.',
    'enhance': 'Improve the quality of the image: sharpen it, remove noise and correct colour, without changing its content.',
    'remove-watermark': 'Remove every watermark, logo overlay or stamped text and restore what lies beneath it.',
    'remove-background': 'Remove the background completely and keep only the main subject on a transparent background.',
    'remove-object': 'Remove the object the user names and fill its area so that it blends with its surroundings.',
    'vectorize': 'Redraw the image as a clean vector drawing.',
}


class GenerationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    prompt: Annotated[str, Field(max_length=4000)] = ''
    action: Action = 'free'
    scope: Literal['selection', 'document'] = 'selection'
    creativity: Annotated[float, Field(ge=0, le=1)] = 0.5
    selectionPng: Annotated[str, Field(max_length=30_000_000)] | None = None
    documentPng: Annotated[str, Field(max_length=30_000_000)] | None = None
    selectionData: Annotated[str, Field(max_length=400_000)] | None = None
    # What the user wants back: pixels from the image model, or an editable drawing (FEAT-0029, SC-0157).
    output: Literal['bitmap', 'vector'] = 'bitmap'
    selectionSvg: Annotated[str, Field(max_length=600_000)] | None = None


class SavedPrompt(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: Annotated[str, Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')]
    title: Annotated[str, Field(min_length=1, max_length=80)]
    prompt: Annotated[str, Field(max_length=4000)]
    action: Action = 'free'
    creativity: Annotated[float, Field(ge=0, le=1)] = 0.5
    favorite: bool = False
    output: Literal['bitmap', 'vector'] = 'bitmap'
    hidden: bool = False


class PromptList(BaseModel):
    model_config = ConfigDict(extra='forbid')
    prompts: Annotated[list[SavedPrompt], Field(max_length=200)]


def png_bytes(data_url: str | None, name: str) -> bytes | None:
    """The bytes of a PNG data URL, refused when it is not a bounded PNG."""
    if data_url is None:
        return None
    prefix = 'data:image/png;base64,'
    if not data_url.startswith(prefix):
        raise IdentityError(422, f'The {name} must be a PNG image')
    try:
        data = base64.b64decode(data_url[len(prefix):], validate=True)
    except (binascii.Error, ValueError):
        raise IdentityError(422, f'The {name} is not valid base64') from None
    if len(data) > MAX_IMAGE_BYTES or not data.startswith(PNG_SIGNATURE):
        raise IdentityError(422, f'The {name} is not a PNG under 20 MB')
    return data


def instruction(request: GenerationRequest, has_selection: bool) -> str:
    """The text sent with the images: the action, the user's words and what each image is."""
    parts = [ACTIONS[request.action]]
    if request.prompt.strip():
        parts.append('Instruction of the user: ' + request.prompt.strip())
    if request.scope == 'selection' and has_selection:
        parts.append('Image 1 is the selected objects of a design document, rendered as a PNG with transparency; '
                     'change only them. Image 2, when present, is the whole document, for context only.')
    else:
        parts.append('Image 1 is the whole design document rendered as a PNG; apply the change to it.')
    if request.selectionData and request.scope == 'selection':
        parts.append('Structured data of the selected objects, as the editor stores them (JSON): ' + request.selectionData[:20000])
    if request.creativity < 0.34:
        parts.append('Follow the instruction strictly and change nothing else.')
    elif request.creativity > 0.66:
        parts.append('You may take creative liberties while keeping the intent.')
    return '\n\n'.join(parts)


# The drawing rules a vector answer must follow, given to the model as a skill: the editor
# imports the SVG as paths and groups, so the answer must be plain, structured geometry.
VECTOR_RULES = """You are a vector illustrator working inside a design editor. Answer with exactly one standalone SVG document and nothing else: no explanation and no Markdown fence.
Rules for the SVG:
- The root <svg> has xmlns="http://www.w3.org/2000/svg" and a viewBox: the viewBox of the source SVG when one is given, otherwise 0 0 and the pixel size of Image 1.
- Organise the drawing in <g> groups, one per logical part (for example a face, a leaf, a letter shape, a background), nested where parts belong together, each with a short descriptive id.
- Draw with <path>, <rect>, <circle>, <ellipse>, <polygon>, <polyline> and <line> only. Prefer few clean shapes with smooth cubic Bezier curves over many tiny segments.
- Paint with solid fill and stroke colours written as #rrggbb, and stroke-width where there is a stroke. Use <linearGradient> or <radialGradient> in <defs> only where a gradient is essential.
- Never use <image>, <text>, <foreignObject>, <script>, <style>, CSS classes, filters, masks, clip paths, patterns or external references.
- Order the elements from back to front, and keep every coordinate inside the viewBox.
- When a source SVG is given, edit it: keep the elements, ids and colours the instruction does not concern, and change only what it asks."""


def vector_instruction(request: GenerationRequest, has_selection: bool) -> str:
    """The text for an editable drawing: the rules, the action, the user's words and the source geometry."""
    parts = [VECTOR_RULES, 'Task: ' + ACTIONS[request.action]]
    if request.prompt.strip():
        parts.append('Instruction of the user: ' + request.prompt.strip())
    if request.scope == 'selection' and has_selection:
        parts.append('Image 1 is the selected objects rendered as a PNG; the SVG below is their source, when given. Draw only them.')
    else:
        parts.append('Image 1 is the whole design document rendered as a PNG; the SVG below is its source, when given.')
    if request.selectionSvg:
        parts.append('Source SVG:\n' + request.selectionSvg[:300_000])
    if request.creativity < 0.34:
        parts.append('Follow the instruction strictly and keep the drawing as close to the source as possible.')
    elif request.creativity > 0.66:
        parts.append('You may take creative liberties with shapes and colours while keeping the intent.')
    return '\n\n'.join(parts)


def svg_from(text: str) -> str:
    """The SVG a vision model answered with, refused when it carries scripts or is too large."""
    match = re.search(r'<svg[\s\S]*?</svg>', text, re.IGNORECASE)
    if not match:
        raise IdentityError(502, 'The model did not answer with an SVG drawing')
    svg = match.group(0)
    if len(svg) > MAX_SVG_CHARS:
        raise IdentityError(502, 'The drawing the model answered with is too large')
    if re.search(r'<script|<foreignObject|\son[a-z]+\s*=|javascript:', svg, re.IGNORECASE):
        raise IdentityError(502, 'The drawing the model answered with carries active content and was refused')
    return svg


class Provider(Protocol):
    def edit_image(self, token: str, images: list[bytes], prompt: str, transparent: bool) -> bytes: ...
    def vectorize(self, token: str, image: bytes, prompt: str, temperature: float) -> str: ...


def provider_refusal(error: urllib.error.HTTPError) -> IdentityError:
    try:
        detail = json.loads(error.read() or b'{}').get('error', {})
        message = str(detail.get('message', ''))[:200]
        code = str(detail.get('code') or detail.get('type') or '')
    except (ValueError, AttributeError, OSError):
        message, code = '', ''
    if error.code == 401:
        return IdentityError(502, 'OpenAI refused the token')
    if error.code == 429:
        # OpenAI answers 429 both for an account without API credit and for too many requests;
        # the size of the prompt has nothing to do with either.
        if code == 'insufficient_quota':
            return IdentityError(502, 'The OpenAI account of this token has no API credit left; add credit or raise its limit in the OpenAI billing settings')
        if code == 'rate_limit_exceeded':
            return IdentityError(502, 'OpenAI limits how many requests this token can make per minute; wait a moment and try again')
        return IdentityError(502, 'OpenAI limits the rate or quota of this token' + (': ' + message if message else ''))
    if error.code in (400, 403, 404) and message:
        if 'does not have access to model' in message or 'must be verified' in message:
            return IdentityError(502, 'OpenAI refused the request: ' + message + '. Allow the model in the limits of the OpenAI project,'
                                 ' or verify the organization in its general settings')
        return IdentityError(502, 'OpenAI refused the request: ' + message)
    return IdentityError(502, f'OpenAI answered {error.code}')


class OpenAiProvider:
    """OpenAI over HTTPS: the image edit endpoint for pictures, the Responses API for drawings."""

    def __init__(self, image_model: str | None = None, text_model: str | None = None, timeout: float = 180):
        self.image_model = image_model or os.environ.get('XDS_OPENAI_IMAGE_MODEL', DEFAULT_IMAGE_MODEL)
        self.text_model = text_model or os.environ.get('XDS_OPENAI_TEXT_MODEL', DEFAULT_TEXT_MODEL)
        self.timeout = timeout

    def _send(self, request: urllib.request.Request) -> dict:
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as answer:  # noqa: S310 - fixed provider URL
                return json.loads(answer.read())
        except urllib.error.HTTPError as error:
            raise provider_refusal(error) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise IdentityError(504, 'OpenAI did not answer in time or is unreachable') from None

    def edit_image(self, token: str, images: list[bytes], prompt: str, transparent: bool) -> bytes:
        boundary = 'xds' + uuid.uuid4().hex
        fields = [('model', self.image_model), ('prompt', prompt), ('size', 'auto'), ('output_format', 'png'),
                  ('background', 'transparent' if transparent else 'auto')]
        body = b''
        for name, value in fields:
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for index, image in enumerate(images):
            body += (f'--{boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="image-{index + 1}.png"\r\n'
                     'Content-Type: image/png\r\n\r\n').encode() + image + b'\r\n'
        body += f'--{boundary}--\r\n'.encode()
        answer = self._send(urllib.request.Request(OPENAI + '/images/edits', data=body, method='POST', headers={
            'Authorization': 'Bearer ' + token, 'Content-Type': 'multipart/form-data; boundary=' + boundary}))
        try:
            return base64.b64decode(answer['data'][0]['b64_json'])
        except (KeyError, IndexError, TypeError, binascii.Error):
            raise IdentityError(502, 'OpenAI answered without an image') from None

    def vectorize(self, token: str, image: bytes, prompt: str, temperature: float) -> str:
        content = [{'type': 'input_text', 'text': prompt},
                   {'type': 'input_image', 'image_url': 'data:image/png;base64,' + base64.b64encode(image).decode()}]

        def ask(settings: dict) -> dict:
            body = json.dumps({'model': self.text_model, **settings, 'input': [{'role': 'user', 'content': content}]}).encode()
            return self._send(urllib.request.Request(OPENAI + '/responses', data=body, method='POST', headers={
                'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}))
        try:
            answer = ask({'temperature': temperature})
        except IdentityError as refused:
            # Reasoning models refuse a temperature; the instruction already carries the creativity.
            if 'temperature' not in refused.reason:
                raise
            answer = ask({})
        text = answer.get('output_text') or ''.join(part.get('text', '') for item in answer.get('output', []) if isinstance(item, dict)
                                                    for part in item.get('content', []) if isinstance(part, dict))
        return svg_from(text)


class PromptStore:
    """Each user's saved prompts, one file per user named by a digest of the subject."""

    def __init__(self, directory: Path):
        self.directory = directory
        self.lock = threading.Lock()

    def _path(self, subject: str) -> Path:
        return self.directory / f'{hashlib.sha256(subject.encode()).hexdigest()}.json'

    def read(self, subject: str) -> list[dict]:
        try:
            return PromptList.model_validate_json(self._path(subject).read_text(encoding='utf-8')).model_dump()['prompts']
        except (OSError, ValueError):
            return []

    def write(self, subject: str, prompts: PromptList) -> None:
        with self.lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self._path(subject)
            temporary = path.with_suffix('.tmp')
            temporary.write_text(prompts.model_dump_json(), encoding='utf-8')
            temporary.replace(path)


def agent_router(session: Callable, vault: TokenVault, prompts: PromptStore, audit: AuditLog, clock: Callable[[], datetime],
                 provider: Provider) -> APIRouter:
    router = APIRouter(tags=['agent tools'])
    running = threading.BoundedSemaphore(4)

    async def allowed(current: dict = Depends(session)) -> dict:
        require_permission(current, 'ai-tools')
        return current

    Current = Annotated[dict, Depends(allowed)]

    @router.post('/api/ai/generate')
    async def generate(body: GenerationRequest, current: Current) -> dict[str, Any]:
        selection = png_bytes(body.selectionPng, 'selection image')
        document = png_bytes(body.documentPng, 'document image')
        if body.scope == 'selection' and selection is None:
            raise IdentityError(422, 'Select objects, or choose the whole document as the context')
        if body.scope == 'document' and document is None:
            raise IdentityError(422, 'The document image is missing')
        if body.action in ('free', 'style', 'reinterpret', 'remove-object') and not body.prompt.strip():
            raise IdentityError(422, 'Write what the model should do')
        token = await run_in_threadpool(vault.get, current['subject'], 'openai')
        if not token:
            raise IdentityError(409, 'Save your OpenAI API token in Settings > External tokens first')
        images = [selection, document] if body.scope == 'selection' else [document]
        images = [image for image in images if image is not None]
        vector = body.output == 'vector' or body.action == 'vectorize'
        # A vector result from pictures would mean tracing them, which is not offered yet (owner decision of 2026-09-24).
        if vector and body.selectionData and '[picture sent as an image]' in body.selectionData:
            raise IdentityError(422, 'Vector results are not available when the context holds pictures')
        text = vector_instruction(body, selection is not None) if vector else instruction(body, selection is not None)
        if not running.acquire(blocking=False):
            raise IdentityError(429, 'Too many requests are running; wait for one to finish')
        outcome = 'failed'
        try:
            if vector:
                svg = await run_in_threadpool(provider.vectorize, token, images[0], text, round(0.2 + body.creativity * 0.8, 2))
                result: dict[str, Any] = {'kind': 'svg', 'svg': svg}
            else:
                data = await run_in_threadpool(provider.edit_image, token, images, text,
                                               body.action == 'remove-background' or body.scope == 'selection')
                if not data.startswith(PNG_SIGNATURE) or len(data) > MAX_IMAGE_BYTES:
                    raise IdentityError(502, 'OpenAI answered with an image that is not a PNG under 20 MB')
                result = {'kind': 'image', 'png': 'data:image/png;base64,' + base64.b64encode(data).decode()}
            outcome = 'answered'
            return result
        finally:
            running.release()
            # The audit keeps what was asked of whom, never the prompt or the pixels.
            await run_in_threadpool(audit.record, current['subject'], current['subject'], 'agent-request',
                                    {'action': body.action, 'scope': body.scope, 'output': 'vector' if vector else 'bitmap', 'images': len(images),
                                     'bytes': sum(len(image) for image in images), 'outcome': outcome}, clock())

    @router.get('/api/me/prompts')
    async def saved(current: Current):
        return {'prompts': await run_in_threadpool(prompts.read, current['subject'])}

    @router.put('/api/me/prompts')
    async def save(body: PromptList, current: Current):
        await run_in_threadpool(prompts.write, current['subject'], body)
        return {'prompts': await run_in_threadpool(prompts.read, current['subject'])}

    return router
