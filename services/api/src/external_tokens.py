"""External provider tokens of each user (FEAT-0029, ADR-0037 as amended on 2026-09-24, SC-0122).

Each user keeps their own OpenAI API token. It is encrypted at rest with the service key,
tied to the verified subject, and never returned to the browser, logged or audited; the
browser learns whether a token is configured, when it last changed and, as the owner asked
on 2026-09-24, a masked form with the prefix and the last four characters only.
"""
import hashlib
import json
import os
import threading
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Annotated, Callable, Literal

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from .identity import AuditLog, IdentityError, format_instant, parse_instant, require_permission

Provider = Literal['openai']
OPENAI_MODELS = 'https://api.openai.com/v1/models'


class TokenVault:
    """One encrypted file per user and provider, named by a digest of the subject."""

    def __init__(self, directory: Path, key: str):
        try:
            self.cipher = Fernet(key.encode()) if key else None
        except ValueError:
            self.cipher = None
        self.directory = directory
        self.lock = threading.Lock()

    def _path(self, subject: str, provider: str) -> Path:
        return self.directory / f"{hashlib.sha256(subject.encode()).hexdigest()}-{provider}.json"

    def _require(self) -> Fernet:
        if self.cipher is None:
            raise IdentityError(503, 'Token storage is not configured on this server')
        return self.cipher

    def put(self, subject: str, provider: str, value: str, now: datetime) -> None:
        cipher = self._require()
        with self.lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self._path(subject, provider)
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps({'token': cipher.encrypt(value.encode()).decode(), 'hint': masked(value),
                                             'updatedAt': format_instant(now)}))
            os.chmod(temporary, 0o600)
            temporary.replace(path)

    def status(self, subject: str, provider: str) -> dict:
        self._require()
        try:
            saved = json.loads(self._path(subject, provider).read_text())
        except (OSError, ValueError):
            return {'configured': False, 'updatedAt': None, 'hint': None}
        instant = parse_instant(saved.get('updatedAt'))
        return {'configured': True, 'updatedAt': format_instant(instant) if instant else None, 'hint': saved.get('hint')}

    def get(self, subject: str, provider: str) -> str | None:
        """The token for use by the service itself; never sent to the browser."""
        cipher = self._require()
        try:
            saved = json.loads(self._path(subject, provider).read_text())
            return cipher.decrypt(saved['token'].encode()).decode()
        except (OSError, ValueError, KeyError, InvalidToken):
            return None

    def delete(self, subject: str, provider: str) -> None:
        self._require()
        with self.lock:
            self._path(subject, provider).unlink(missing_ok=True)


def masked(value: str) -> str:
    """The prefix and the last four characters, enough to recognise a token and never to rebuild it."""
    return value[:3] + '…' + value[-4:]


def check_openai(token: str, models: tuple[str, ...] | None = None) -> dict:
    """Asks OpenAI for its model list with the token, the cheapest call that proves it works, and
    then whether the token can use each model the agent tools call; neither costs any credit."""
    if models is None:
        from .agent_tools import required_models  # imported here: the agent tools import this module
        models = required_models()

    def get(url: str) -> int:
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
        with urllib.request.urlopen(request, timeout=10) as answer:  # noqa: S310 - fixed provider URL
            return answer.status
    try:
        if get(OPENAI_MODELS) != 200:
            return {'ok': False, 'detail': 'OpenAI did not accept the token'}
    except urllib.error.HTTPError as error:
        reason = {401: 'OpenAI refused the token', 403: 'The token has no access to the API', 429: 'OpenAI limits the rate or quota of this token'}
        return {'ok': False, 'detail': reason.get(error.code, f'OpenAI answered {error.code}')}
    except (urllib.error.URLError, TimeoutError, OSError):
        return {'ok': False, 'detail': 'OpenAI is unreachable from the server'}
    missing = []
    for model in models:
        try:
            get(f'{OPENAI_MODELS}/{model}')
        except urllib.error.HTTPError:
            missing.append(model)
        except (urllib.error.URLError, TimeoutError, OSError):
            return {'ok': False, 'detail': 'OpenAI is unreachable from the server'}
    if missing:
        return {'ok': False, 'detail': 'OpenAI accepted the token, but its project cannot use ' + ', '.join(missing)
                + '. Allow the models in the limits of the OpenAI project, or verify the organization'}
    return {'ok': True, 'detail': 'OpenAI accepted the token, and its project can use ' + ', '.join(models)}


class TokenValue(BaseModel):
    model_config = ConfigDict(extra='forbid')
    token: Annotated[str, Field(min_length=20, max_length=400, pattern=r'^sk-[A-Za-z0-9_\-]+$')]


def tokens_router(session: Callable, vault: TokenVault, audit: AuditLog, clock: Callable[[], datetime],
                  checker: Callable[[str], dict] = check_openai) -> APIRouter:
    router = APIRouter(prefix='/api/me/tokens', tags=['tokens'])

    async def allowed(current: dict = Depends(session)) -> dict:
        # The agent tools licence, or the super administrator, gives access to one's own tokens.
        require_permission(current, 'ai-tools')
        return current

    Current = Annotated[dict, Depends(allowed)]

    @router.get('/{provider}')
    async def status(provider: Provider, current: Current):
        return {'provider': provider, **await run_in_threadpool(vault.status, current['subject'], provider)}

    @router.put('/{provider}')
    async def store(provider: Provider, body: TokenValue, current: Current):
        now = clock()
        await run_in_threadpool(vault.put, current['subject'], provider, body.token, now)
        await run_in_threadpool(audit.record, current['subject'], current['subject'], 'set-token', {'provider': provider}, now)
        return {'provider': provider, **await run_in_threadpool(vault.status, current['subject'], provider)}

    @router.delete('/{provider}', status_code=204)
    async def remove(provider: Provider, current: Current):
        await run_in_threadpool(vault.delete, current['subject'], provider)
        await run_in_threadpool(audit.record, current['subject'], current['subject'], 'remove-token', {'provider': provider}, clock())

    @router.post('/{provider}/test')
    async def test(provider: Provider, current: Current):
        token = await run_in_threadpool(vault.get, current['subject'], provider)
        if token is None:
            raise IdentityError(409, 'There is no token to test; save one first')
        return {'provider': provider, **await run_in_threadpool(checker, token)}

    return router
