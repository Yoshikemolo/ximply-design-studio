"""Change control with Git (FEAT-0031, ADR-0038, ADR-0039, SEC-0013).

Each project is a shared bare repository on the server, and each user works in a clone of
their own; pulling and pushing go through that shared repository, so several people can
work on one project. The Git command line runs as a subprocess with an argument list,
never a shell, inside the project directory, with hooks disabled, the system and global
configurations ignored and a timeout. Only a closed set of operations exists; no route
takes free Git arguments.

Documents are written in a canonical form, one key per line in a stable order, and the
pixels they carry are stored as resource files named by the hash of their content, so a
history stays small and its changes readable. The editor keeps its own format: the API
extracts the resources when it writes and puts them back when it reads.
"""
import base64
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
from typing import Annotated, Any, Callable, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from .identity import AuditLog, IdentityError, require_permission

DOCUMENT_PATH = 'documents/main.xds.json'
MANIFEST_PATH = 'xds-project.json'
THUMBNAIL_PATH = 'preview/thumbnail.png'
MAX_THUMBNAIL = 600_000
MAX_COMMENT = 4000
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
MAX_DOCUMENT = 35_000_000
MAX_LOG = 400
GIT_TIMEOUT = 60
RESOURCE = re.compile(r'^xds-resource:([0-9a-f]{64})\.(png|jpg|webp|gif)$')
DATA_URL = re.compile(r'^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$')
EXTENSIONS = {'png': 'png', 'jpeg': 'jpg', 'webp': 'webp', 'gif': 'gif'}
MEDIA = {'png': 'png', 'jpg': 'jpeg', 'webp': 'webp', 'gif': 'gif'}
SHA = re.compile(r'^[0-9a-f]{7,40}$')
PROJECT_ID = re.compile(r'^[0-9a-f]{12}$')
BRANCH = re.compile(r'^(?!-)(?!.*\.\.)(?!.*//)(?!.*@\{)(?!.*\.lock(?:/|$))(?!.*/$)(?!.*\.$)[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$')
GITATTRIBUTES = 'resources/** binary\npreview/** binary\n*.xds.json text eol=lf\n'


class VcsError(IdentityError):
    """A refused or failed operation, with the reason the user reads."""


def valid_branch(name: str) -> str:
    if not BRANCH.match(name) or name in ('HEAD', 'origin') or name.startswith('origin/'):
        raise VcsError(422, 'Branch names use letters, digits, dots, dashes, underscores and slashes')
    return name


def valid_ref(ref: str) -> str:
    """A branch, a branch of the shared repository (origin/name) or a commit, never an option."""
    if SHA.match(ref):
        return ref
    if ref.startswith('origin/'):
        valid_branch(ref[len('origin/'):])
        return ref
    return valid_branch(ref)


# Canonical documents and resources (ADR-0038).

def canonical(document: Any) -> str:
    """One stable text for a document: sorted keys, two-space indent and a final newline."""
    return json.dumps(document, sort_keys=True, indent=2, ensure_ascii=False) + '\n'


def extract_resources(document: Any, resources: dict[str, bytes]) -> Any:
    """The document with every inline picture replaced by a reference to a file named by its hash."""
    if isinstance(document, dict):
        return {key: extract_resources(value, resources) for key, value in document.items()}
    if isinstance(document, list):
        return [extract_resources(value, resources) for value in document]
    if isinstance(document, str) and len(document) > 200:
        match = DATA_URL.match(document)
        if match:
            try:
                data = base64.b64decode(match.group(2), validate=False)
            except ValueError:
                return document
            name = hashlib.sha256(data).hexdigest() + '.' + EXTENSIONS[match.group(1)]
            resources[name] = data
            return 'xds-resource:' + name
    return document


def restore_resources(document: Any, read: Callable[[str], bytes]) -> Any:
    """The document with every resource reference replaced by the picture it names."""
    if isinstance(document, dict):
        return {key: restore_resources(value, read) for key, value in document.items()}
    if isinstance(document, list):
        return [restore_resources(value, read) for value in document]
    if isinstance(document, str):
        match = RESOURCE.match(document)
        if match:
            name = match.group(1) + '.' + match.group(2)
            data = read(name)
            if hashlib.sha256(data).hexdigest() != match.group(1):
                raise VcsError(422, 'A picture of the project does not match its name')
            return f'data:image/{MEDIA[match.group(2)]};base64,' + base64.b64encode(data).decode()
    return document


def thumbnail_bytes(value: Any) -> bytes | None:
    """The preview a commit keeps of its document: a PNG data URL of at most 600 KB, or nothing."""
    if value in (None, ''):
        return None
    if not isinstance(value, str) or not value.startswith('data:image/png;base64,'):
        raise VcsError(422, 'The preview must be a PNG image')
    try:
        data = base64.b64decode(value.split(',', 1)[1], validate=True)
    except ValueError:
        raise VcsError(422, 'The preview is not a PNG image') from None
    if not data.startswith(PNG_SIGNATURE) or len(data) > MAX_THUMBNAIL:
        raise VcsError(422, 'The preview is not a PNG under 600 KB')
    return data


# The Git runner (SEC-0013).

class Git:
    def __init__(self, root: Path, executable: str = 'git', timeout: int = GIT_TIMEOUT):
        self.executable = shutil.which(executable) or executable
        self.timeout = timeout
        self.hooks = root / '.no-hooks'
        self.hooks.mkdir(parents=True, exist_ok=True)
        self.home = root / '.home'
        self.home.mkdir(parents=True, exist_ok=True)

    def run(self, cwd: Path, *args: str, author: tuple[str, str] | None = None, check: bool = True) -> subprocess.CompletedProcess:
        environment = {'PATH': os.environ.get('PATH', ''), 'HOME': str(self.home), 'GIT_CONFIG_NOSYSTEM': '1',
                       'GIT_CONFIG_GLOBAL': str(self.home / 'gitconfig'), 'GIT_TERMINAL_PROMPT': '0', 'LC_ALL': 'C',
                       'GIT_ASKPASS': '', 'SSH_ASKPASS': ''}
        for key in ('SYSTEMROOT', 'TEMP', 'TMP'):
            if key in os.environ:
                environment[key] = os.environ[key]
        if author:
            name, email = author
            environment.update({'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email, 'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email})
        command = [self.executable, '-c', f'core.hooksPath={self.hooks}', '-c', 'core.autocrlf=false', '-c', 'core.fsmonitor=false',
                   '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'user.useConfigOnly=false',
                   '-c', 'user.name=Ximply Design Studio', '-c', 'user.email=studio@localhost', *args]
        try:
            done = subprocess.run(command, cwd=cwd, env=environment, capture_output=True, timeout=self.timeout, check=False)
        except FileNotFoundError:
            raise VcsError(503, 'Git is not installed on the server') from None
        except subprocess.TimeoutExpired:
            raise VcsError(504, 'The Git operation took too long') from None
        if check and done.returncode != 0:
            raise VcsError(409, 'Git refused the operation: ' + failure(done))
        return done

    def text(self, cwd: Path, *args: str) -> str:
        return self.run(cwd, *args).stdout.decode('utf-8', 'replace')


def failure(done: subprocess.CompletedProcess) -> str:
    lines = [line.strip() for line in (done.stderr or done.stdout).decode('utf-8', 'replace').splitlines() if line.strip()]
    useful = [line for line in lines if not line.startswith('hint:')]
    return (useful[-1] if useful else 'unknown reason').removeprefix('fatal: ').removeprefix('error: ')[:300]


# Projects, clones and operations.

class ProjectStore:
    def __init__(self, root: Path, git: Git | None = None):
        self.root = root / 'vcs'
        self.root.mkdir(parents=True, exist_ok=True)
        self.git = git or Git(self.root)
        self.locks: dict[str, threading.Lock] = {}
        self.guard = threading.Lock()

    def lock(self, project: str) -> threading.Lock:
        with self.guard:
            return self.locks.setdefault(project, threading.Lock())

    def folder(self, project: str) -> Path:
        if not PROJECT_ID.match(project):
            raise VcsError(404, 'Unknown project')
        folder = self.root / 'projects' / project
        if not (folder / 'project.json').exists():
            raise VcsError(404, 'Unknown project')
        return folder

    def clone(self, project: str, subject: str) -> Path:
        """The user's own working clone, made from the shared repository the first time."""
        folder = self.folder(project)
        clone = folder / 'clones' / hashlib.sha256(subject.encode()).hexdigest()[:24]
        if not (clone / '.git').exists():
            clone.parent.mkdir(parents=True, exist_ok=True)
            self.git.run(folder, 'clone', '--quiet', '--', str(folder / 'origin.git'), str(clone))
        return clone

    def projects(self) -> list[dict]:
        found = []
        for meta in sorted((self.root / 'projects').glob('*/project.json')):
            try:
                found.append(json.loads(meta.read_text(encoding='utf-8')))
            except (OSError, ValueError):
                continue
        return sorted(found, key=lambda item: item.get('createdAt', ''), reverse=True)

    def create(self, name: str, document: Any, subject: str, author: tuple[str, str], now: datetime, thumbnail: bytes | None = None) -> dict:
        project = uuid4().hex[:12]
        folder = self.root / 'projects' / project
        work = folder / 'clones' / hashlib.sha256(subject.encode()).hexdigest()[:24]
        work.mkdir(parents=True)
        self.git.run(work, 'init', '--quiet', '-b', 'main')
        self.write(work, name, document, thumbnail)
        self.git.run(work, 'add', '--all')
        self.git.run(work, 'commit', '--quiet', '-m', f'Create the project {name}', author=author)
        self.git.run(folder, 'init', '--quiet', '--bare', '-b', 'main', 'origin.git')
        self.git.run(work, 'remote', 'add', 'origin', str(folder / 'origin.git'))
        self.git.run(work, 'push', '--quiet', '-u', 'origin', 'main')
        meta = {'id': project, 'name': name, 'createdBy': subject, 'createdAt': now.isoformat().replace('+00:00', 'Z')}
        (folder / 'project.json').write_text(json.dumps(meta), encoding='utf-8')
        return meta

    def write(self, work: Path, name: str, document: Any, thumbnail: bytes | None = None) -> None:
        resources: dict[str, bytes] = {}
        stored = extract_resources(document, resources)
        (work / 'documents').mkdir(exist_ok=True)
        (work / 'resources').mkdir(exist_ok=True)
        (work / DOCUMENT_PATH).write_text(canonical(stored), encoding='utf-8', newline='\n')
        for resource, data in resources.items():
            target = work / 'resources' / resource
            if not target.exists():
                target.write_bytes(data)
        # Pictures no document refers to any more leave the tree; history keeps them.
        for existing in (work / 'resources').iterdir():
            if existing.name not in resources and existing.name != '.gitkeep':
                existing.unlink()
        (work / 'resources' / '.gitkeep').touch()
        # Each commit keeps a small picture of its document, shown over the history graph.
        preview = work / THUMBNAIL_PATH
        if thumbnail:
            preview.parent.mkdir(exist_ok=True)
            preview.write_bytes(thumbnail)
        elif preview.exists():
            preview.unlink()
        (work / '.gitattributes').write_text(GITATTRIBUTES, encoding='utf-8', newline='\n')
        (work / MANIFEST_PATH).write_text(canonical({'format': 'xds-project', 'version': 1, 'name': name, 'documents': [DOCUMENT_PATH]}),
                                          encoding='utf-8', newline='\n')

    def document(self, work: Path) -> Any:
        if self.conflicts(work):
            raise VcsError(409, 'Resolve the conflicts of the merge before opening the document')
        path = work / DOCUMENT_PATH
        if not path.exists():
            raise VcsError(404, 'This commit has no document')
        if path.stat().st_size > MAX_DOCUMENT:
            raise VcsError(413, 'The document exceeds the 35 MB preview limit')

        def read(name: str) -> bytes:
            try:
                return (work / 'resources' / name).read_bytes()
            except OSError:
                raise VcsError(422, 'A picture of the project is missing') from None
        try:
            stored = json.loads(path.read_text(encoding='utf-8'))
        except ValueError:
            raise VcsError(422, 'The document of this commit cannot be read') from None
        return restore_resources(stored, read)

    # State.

    def conflicts(self, work: Path) -> list[str]:
        out = self.git.text(work, 'diff', '--name-only', '--diff-filter=U', '-z')
        return [name for name in out.split('\0') if name]

    def status(self, work: Path) -> dict:
        git = self.git
        branch = git.run(work, 'symbolic-ref', '--quiet', '--short', 'HEAD', check=False).stdout.decode().strip() or None
        head = git.text(work, 'rev-parse', 'HEAD').strip()
        ahead = behind = 0
        upstream = None
        if branch:
            tracked = git.run(work, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}', check=False)
            if tracked.returncode == 0:
                upstream = tracked.stdout.decode().strip()
                counts = git.text(work, 'rev-list', '--left-right', '--count', 'HEAD...@{u}').split()
                ahead, behind = int(counts[0]), int(counts[1])
        changes = [line[3:] for line in git.text(work, 'status', '--porcelain=v1', '--untracked-files=all').splitlines() if len(line) > 3]
        journal = self.journal(work)
        return {'branch': branch, 'head': head, 'upstream': upstream, 'ahead': ahead, 'behind': behind,
                'merging': (work / '.git' / 'MERGE_HEAD').exists(), 'conflicts': self.conflicts(work), 'changes': changes,
                'canUndo': bool(journal['done']), 'canRedo': bool(journal['undone'])}

    def log(self, work: Path) -> dict:
        separator, end = '\x1f', '\x1e'
        out = self.git.text(work, 'log', '--all', '--topo-order', f'--max-count={MAX_LOG}',
                            f'--format=%H{separator}%P{separator}%an{separator}%ae{separator}%aI{separator}%s{end}')
        commits = []
        for record in out.split(end):
            fields = record.strip('\n').split(separator)
            if len(fields) == 6:
                commits.append({'sha': fields[0], 'parents': fields[1].split(), 'author': fields[2], 'email': fields[3],
                                'date': fields[4], 'subject': fields[5]})
        refs = []
        for line in self.git.text(work, 'for-each-ref', '--format=%(refname)\x1f%(objectname)', 'refs/heads', 'refs/remotes').splitlines():
            name, sha = line.split('\x1f')
            if name.endswith('/HEAD'):
                continue
            kind = 'local' if name.startswith('refs/heads/') else 'remote'
            refs.append({'name': name.removeprefix('refs/heads/').removeprefix('refs/remotes/'), 'sha': sha, 'kind': kind})
        return {'commits': commits, 'refs': refs, 'truncated': len(commits) >= MAX_LOG}

    def show(self, work: Path, sha: str) -> dict:
        valid_ref(sha)
        separator = '\x1f'
        out = self.git.text(work, 'show', '--no-patch', f'--format=%H{separator}%P{separator}%an{separator}%ae{separator}%aI{separator}%B', sha, '--')
        fields = out.split(separator, 5)
        files = []
        for line in self.git.text(work, 'diff-tree', '--no-commit-id', '-r', '--root', '-m', '--first-parent', '--name-status', fields[0]).splitlines():
            parts = line.split('\t')
            if len(parts) >= 2:
                files.append({'status': parts[0][0], 'path': parts[-1]})
        return {'sha': fields[0], 'parents': fields[1].split(), 'author': fields[2], 'email': fields[3], 'date': fields[4],
                'message': fields[5].strip(), 'files': files}

    def thumbnail(self, work: Path, sha: str) -> str | None:
        valid_ref(sha)
        done = self.git.run(work, 'cat-file', 'blob', f'{sha}:{THUMBNAIL_PATH}', check=False)
        if done.returncode or not done.stdout.startswith(PNG_SIGNATURE):
            return None
        return 'data:image/png;base64,' + base64.b64encode(done.stdout).decode()

    # Comments on commits: shared by everyone who works on the project, kept beside the
    # repository rather than in it, since they are about its history.

    def comments_file(self, project: str, sha: str) -> Path:
        if not re.match(r'^[0-9a-f]{40}$', sha):
            raise VcsError(422, 'Comments belong to a full commit identifier')
        return self.folder(project) / 'comments' / f'{sha}.json'

    def comments(self, project: str, sha: str) -> list[dict]:
        try:
            return json.loads(self.comments_file(project, sha).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return []

    def comment_counts(self, project: str) -> dict[str, int]:
        counts = {}
        for path in (self.folder(project) / 'comments').glob('*.json'):
            try:
                counts[path.stem] = len(json.loads(path.read_text(encoding='utf-8')))
            except (OSError, ValueError):
                continue
        return {sha: count for sha, count in counts.items() if count}

    def add_comment(self, project: str, sha: str, subject: str, author: str, text: str, now: datetime) -> dict:
        text = text.strip()
        if not text:
            raise VcsError(422, 'Write the comment first')
        if len(text) > MAX_COMMENT:
            raise VcsError(422, 'Comments hold up to 4000 characters')
        path = self.comments_file(project, sha)
        found = self.comments(project, sha)
        if len(found) >= 500:
            raise VcsError(409, 'This commit has too many comments')
        comment = {'id': uuid4().hex, 'subject': subject, 'author': author, 'text': text, 'createdAt': now.isoformat().replace('+00:00', 'Z')}
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps([*found, comment]), encoding='utf-8')
        return comment

    def remove_comment(self, project: str, sha: str, comment: str, subject: str, admin: bool) -> None:
        found = self.comments(project, sha)
        target = next((item for item in found if item['id'] == comment), None)
        if target is None:
            raise VcsError(404, 'Unknown comment')
        if target['subject'] != subject and not admin:
            raise VcsError(403, 'Only its author can remove a comment')
        self.comments_file(project, sha).write_text(json.dumps([item for item in found if item['id'] != comment]), encoding='utf-8')

    # The journal of operations, which defines undo and redo (FEAT-0031); it never leaves the clone.

    def journal(self, work: Path) -> dict:
        try:
            return json.loads((work / '.git' / 'xds-journal.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {'done': [], 'undone': []}

    def save_journal(self, work: Path, journal: dict) -> None:
        journal['done'] = journal['done'][-50:]
        (work / '.git' / 'xds-journal.json').write_text(json.dumps(journal), encoding='utf-8')

    def snapshot(self, work: Path) -> dict:
        branch = self.git.run(work, 'symbolic-ref', '--quiet', '--short', 'HEAD', check=False).stdout.decode().strip() or None
        branches = {}
        for line in self.git.text(work, 'for-each-ref', '--format=%(refname:short)\x1f%(objectname)', 'refs/heads').splitlines():
            name, sha = line.split('\x1f')
            branches[name] = sha
        return {'branch': branch, 'head': self.git.text(work, 'rev-parse', 'HEAD').strip(), 'branches': branches}

    def record(self, work: Path, operation: str, before: dict) -> None:
        after = self.snapshot(work)
        if after == before:
            return
        journal = self.journal(work)
        journal['done'].append({'operation': operation, 'before': before, 'after': after})
        journal['undone'] = []
        self.save_journal(work, journal)

    def restore(self, work: Path, state: dict) -> None:
        """Puts the branches and HEAD back as a snapshot recorded them."""
        current = self.snapshot(work)
        # Leave the branch that will move or disappear before changing it.
        self.git.run(work, 'checkout', '--quiet', '--detach', current['head'])
        for name in current['branches']:
            if name not in state['branches']:
                self.git.run(work, 'branch', '-D', '--', name)
        for name, sha in state['branches'].items():
            self.git.run(work, 'branch', '-f', '--', name, sha)
        if state['branch']:
            self.git.run(work, 'checkout', '--quiet', '--force', state['branch'])
        else:
            self.git.run(work, 'checkout', '--quiet', '--force', '--detach', state['head'])
        self.git.run(work, 'reset', '--quiet', '--hard', state['head'])

    def shared(self, work: Path, leaving: dict, staying: dict) -> bool:
        """Whether a step would drop commits that the shared repository already has."""
        dropped = [sha for sha in set(leaving['branches'].values()) | {leaving['head']}]
        kept = [sha for sha in set(staying['branches'].values()) | {staying['head']}]
        alone = self.git.text(work, 'rev-list', *dropped, '--not', *kept).split()
        unshared = self.git.text(work, 'rev-list', *dropped, '--not', *kept, '--remotes').split()
        return len(alone) != len(unshared)

    def step(self, work: Path, backwards: bool) -> dict:
        journal = self.journal(work)
        source, target = ('done', 'undone') if backwards else ('undone', 'done')
        if not journal[source]:
            raise VcsError(409, 'There is nothing to undo' if backwards else 'There is nothing to redo')
        entry = journal[source][-1]
        leaving, staying = (entry['after'], entry['before']) if backwards else (entry['before'], entry['after'])
        if backwards and self.shared(work, leaving, staying):
            raise VcsError(409, 'Those commits are already in the shared repository; revert them instead')
        if self.conflicts(work) or (work / '.git' / 'MERGE_HEAD').exists():
            raise VcsError(409, 'Finish or abort the merge first')
        self.restore(work, staying)
        journal[source].pop()
        journal[target].append(entry)
        self.save_journal(work, journal)
        return entry


class ProjectBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: Annotated[str, Field(min_length=1, max_length=120)]


class CommitBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    message: Annotated[str, Field(max_length=5000)]


class BranchBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: Annotated[str, Field(min_length=1, max_length=100)]
    at: Annotated[str, Field(max_length=120)] | None = None


class RenameBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: Annotated[str, Field(min_length=1, max_length=100)]


class RefBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ref: Annotated[str, Field(min_length=1, max_length=120)]


class CommentBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: Annotated[str, Field(min_length=1, max_length=MAX_COMMENT)]


class ResolveBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    path: Annotated[str, Field(min_length=1, max_length=300)]
    side: Literal['mine', 'theirs']


def vcs_router(session: Callable, store: ProjectStore, validate: Callable[[bytes], None], audit: AuditLog,
               clock: Callable[[], datetime]) -> APIRouter:
    router = APIRouter(tags=['change control'])

    async def allowed(current: dict = Depends(session)) -> dict:
        require_permission(current, 'change-control')
        return current

    Current = Annotated[dict, Depends(allowed)]

    def author(current: dict) -> tuple[str, str]:
        name = (current.get('name') or current.get('username') or 'Designer').replace('<', '').replace('>', '')[:120]
        email = (current.get('email') or f"{current['subject']}@users.local").replace('<', '').replace('>', '')[:200]
        return name, email

    async def body_document(request: Request) -> tuple[Any, bytes]:
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_DOCUMENT:
                raise VcsError(413, 'The document exceeds the 35 MB preview limit')
            chunks.append(chunk)
        raw = b''.join(chunks)
        try:
            payload = json.loads(raw)
        except ValueError:
            raise VcsError(422, 'The request is not JSON') from None
        if not isinstance(payload, dict) or not isinstance(payload.get('document'), dict):
            raise VcsError(422, 'The request carries no document')
        document = json.dumps(payload['document']).encode()
        validate(document)
        return payload, document

    async def operate(project: str, current: dict, operation: str, work: Callable[[Path], Any], journal: bool = True) -> dict:
        def run() -> dict:
            with store.lock(project):
                clone = store.clone(project, current['subject'])
                before = store.snapshot(clone)
                outcome = work(clone)
                if journal:
                    store.record(clone, operation, before)
                after = store.snapshot(clone)
                return {'result': outcome, 'status': store.status(clone), 'moved': before['head'] != after['head']}
        try:
            answer = await run_in_threadpool(run)
            outcome = 'done'
            return answer
        except IdentityError as error:
            outcome = f'refused {error.status}'
            raise
        finally:
            # The audit keeps who did what, never file content.
            await run_in_threadpool(audit.record, current['subject'], project, 'vcs-' + operation, {'outcome': outcome}, clock())

    @router.get('/api/vcs/projects')
    async def projects(current: Current):
        return {'projects': await run_in_threadpool(store.projects)}

    @router.post('/api/vcs/projects', status_code=201)
    async def create(request: Request, current: Current):
        payload, _ = await body_document(request)
        name = ProjectBody(name=str(payload.get('name', ''))[:200]).name.strip()
        if not name:
            raise VcsError(422, 'Give the project a name')
        preview = thumbnail_bytes(payload.get('thumbnail'))
        meta = await run_in_threadpool(store.create, name, payload['document'], current['subject'], author(current), clock(), preview)
        await run_in_threadpool(audit.record, current['subject'], meta['id'], 'vcs-create', {'outcome': 'done'}, clock())
        return meta

    @router.get('/api/vcs/projects/{project}/status')
    async def status(project: str, current: Current):
        def run():
            with store.lock(project):
                return store.status(store.clone(project, current['subject']))
        return await run_in_threadpool(run)

    @router.get('/api/vcs/projects/{project}/log')
    async def log(project: str, current: Current):
        def run():
            with store.lock(project):
                return {**store.log(store.clone(project, current['subject'])), 'comments': store.comment_counts(project)}
        return await run_in_threadpool(run)

    @router.get('/api/vcs/projects/{project}/commits/{sha}')
    async def show(project: str, sha: str, current: Current):
        def run():
            with store.lock(project):
                return store.show(store.clone(project, current['subject']), sha)
        return await run_in_threadpool(run)

    @router.get('/api/vcs/projects/{project}/commits/{sha}/thumbnail')
    async def thumbnail(project: str, sha: str, current: Current):
        def run():
            with store.lock(project):
                return {'png': store.thumbnail(store.clone(project, current['subject']), sha)}
        return await run_in_threadpool(run)

    @router.get('/api/vcs/projects/{project}/commits/{sha}/comments')
    async def comments(project: str, sha: str, current: Current):
        return {'comments': await run_in_threadpool(store.comments, project, sha)}

    @router.post('/api/vcs/projects/{project}/commits/{sha}/comments', status_code=201)
    async def comment(project: str, sha: str, body: CommentBody, current: Current):
        def run():
            with store.lock(project):
                if store.git.run(store.clone(project, current['subject']), 'cat-file', '-e', f'{sha}^{{commit}}', check=False).returncode:
                    raise VcsError(404, 'Unknown commit')
                return store.add_comment(project, sha, current['subject'], author(current)[0], body.text, clock())
        added = await run_in_threadpool(run)
        await run_in_threadpool(audit.record, current['subject'], project, 'vcs-comment', {'outcome': 'done'}, clock())
        return added

    @router.delete('/api/vcs/projects/{project}/commits/{sha}/comments/{comment}', status_code=204)
    async def uncomment(project: str, sha: str, comment: str, current: Current):
        def run():
            with store.lock(project):
                store.remove_comment(project, sha, comment, current['subject'], current['admin'])
        await run_in_threadpool(run)

    @router.get('/api/vcs/projects/{project}/document')
    async def document(project: str, current: Current):
        def run():
            with store.lock(project):
                clone = store.clone(project, current['subject'])
                return {'document': store.document(clone), 'head': store.status(clone)['head']}
        return await run_in_threadpool(run)

    @router.post('/api/vcs/projects/{project}/commit')
    async def commit(project: str, request: Request, current: Current):
        payload, _ = await body_document(request)
        message = CommitBody(message=str(payload.get('message', ''))[:6000]).message.strip()
        if not message:
            raise VcsError(422, 'Write a message for the commit')
        preview = thumbnail_bytes(payload.get('thumbnail'))

        def work(clone: Path):
            if store.conflicts(clone):
                raise VcsError(409, 'Resolve the conflicts of the merge first')
            meta = json.loads((store.folder(project) / 'project.json').read_text(encoding='utf-8'))
            store.write(clone, meta['name'], payload['document'], preview)
            store.git.run(clone, 'add', '--all')
            if not store.git.run(clone, 'diff', '--cached', '--quiet', check=False).returncode and not (clone / '.git' / 'MERGE_HEAD').exists():
                raise VcsError(409, 'Nothing changed since the last commit')
            store.git.run(clone, 'commit', '--quiet', '-m', message, author=author(current))
            return store.git.text(clone, 'rev-parse', 'HEAD').strip()
        return await operate(project, current, 'commit', work)

    @router.post('/api/vcs/projects/{project}/branches')
    async def branch(project: str, body: BranchBody, current: Current):
        name = valid_branch(body.name)
        at = valid_ref(body.at) if body.at else 'HEAD'

        def work(clone: Path):
            if store.git.run(clone, 'show-ref', '--verify', '--quiet', f'refs/heads/{name}', check=False).returncode == 0:
                raise VcsError(409, 'A branch with that name exists')
            store.git.run(clone, 'branch', '--no-track', '--', name, at)
        return await operate(project, current, 'branch', work)

    @router.patch('/api/vcs/projects/{project}/branches/{name:path}')
    async def rename(project: str, name: str, body: RenameBody, current: Current):
        old, new = valid_branch(name), valid_branch(body.name)

        def work(clone: Path):
            if store.git.run(clone, 'show-ref', '--verify', '--quiet', f'refs/heads/{new}', check=False).returncode == 0:
                raise VcsError(409, 'A branch with that name exists')
            store.git.run(clone, 'branch', '-m', '--', old, new)
        return await operate(project, current, 'rename', work)

    @router.delete('/api/vcs/projects/{project}/branches/{name:path}')
    async def delete(project: str, name: str, current: Current, force: bool = False):
        branch_name = valid_branch(name)

        def work(clone: Path):
            if store.status(clone)['branch'] == branch_name:
                raise VcsError(409, 'Check out another branch before deleting this one')
            done = store.git.run(clone, 'branch', '-D' if force else '-d', '--', branch_name, check=False)
            if done.returncode:
                reason = failure(done)
                raise VcsError(409, 'The branch has commits that no other branch holds' if 'not fully merged' in reason else 'Git refused the operation: ' + reason)
        return await operate(project, current, 'delete-branch', work)

    @router.post('/api/vcs/projects/{project}/checkout')
    async def checkout(project: str, body: RefBody, current: Current):
        ref = valid_ref(body.ref)

        def work(clone: Path):
            if store.conflicts(clone) or (clone / '.git' / 'MERGE_HEAD').exists():
                raise VcsError(409, 'Finish or abort the merge first')
            if ref.startswith('origin/'):
                local = ref[len('origin/'):]
                exists = store.git.run(clone, 'show-ref', '--verify', '--quiet', f'refs/heads/{local}', check=False).returncode == 0
                if exists:
                    store.git.run(clone, 'checkout', '--quiet', '--force', local)
                else:
                    store.git.run(clone, 'checkout', '--quiet', '--force', '-b', local, '--track', ref)
            elif SHA.match(ref) and store.git.run(clone, 'show-ref', '--verify', '--quiet', f'refs/heads/{ref}', check=False).returncode:
                store.git.run(clone, 'checkout', '--quiet', '--force', '--detach', ref)
            else:
                store.git.run(clone, 'checkout', '--quiet', '--force', ref)
        return await operate(project, current, 'checkout', work)

    def merge_outcome(clone: Path, done: subprocess.CompletedProcess) -> dict:
        conflicts = store.conflicts(clone)
        if conflicts:
            return {'conflicts': conflicts}
        if done.returncode:
            store.git.run(clone, 'merge', '--abort', check=False)
            raise VcsError(409, 'Git refused the merge: ' + failure(done))
        return {'conflicts': []}

    @router.post('/api/vcs/projects/{project}/merge')
    async def merge(project: str, body: RefBody, current: Current):
        ref = valid_ref(body.ref)

        def work(clone: Path):
            if (clone / '.git' / 'MERGE_HEAD').exists():
                raise VcsError(409, 'Finish or abort the merge first')
            return merge_outcome(clone, store.git.run(clone, 'merge', '--no-edit', '--', ref, author=author(current), check=False))
        return await operate(project, current, 'merge', work)

    @router.post('/api/vcs/projects/{project}/merge/abort')
    async def abort(project: str, current: Current):
        def work(clone: Path):
            if not (clone / '.git' / 'MERGE_HEAD').exists():
                raise VcsError(409, 'No merge is in progress')
            store.git.run(clone, 'merge', '--abort')
        return await operate(project, current, 'merge-abort', work, journal=False)

    @router.post('/api/vcs/projects/{project}/merge/resolve')
    async def resolve(project: str, body: ResolveBody, current: Current):
        def work(clone: Path):
            conflicts = store.conflicts(clone)
            if body.path not in conflicts:
                raise VcsError(409, 'That file has no conflict')
            store.git.run(clone, 'checkout', '--ours' if body.side == 'mine' else '--theirs', '--', body.path)
            store.git.run(clone, 'add', '--', body.path)
            if not store.conflicts(clone):
                store.git.run(clone, 'commit', '--quiet', '--no-edit', author=author(current))
                return {'finished': True}
            return {'finished': False}
        return await operate(project, current, 'resolve', work)

    @router.post('/api/vcs/projects/{project}/fetch')
    async def fetch(project: str, current: Current):
        return await operate(project, current, 'fetch', lambda clone: store.git.run(clone, 'fetch', '--quiet', '--prune', 'origin') and None, journal=False)

    @router.post('/api/vcs/projects/{project}/pull')
    async def pull(project: str, current: Current):
        def work(clone: Path):
            state = store.status(clone)
            if not state['branch']:
                raise VcsError(409, 'Check out a branch before pulling')
            if state['merging']:
                raise VcsError(409, 'Finish or abort the merge first')
            store.git.run(clone, 'fetch', '--quiet', '--prune', 'origin')
            remote = f"origin/{state['branch']}"
            if store.git.run(clone, 'show-ref', '--verify', '--quiet', f'refs/remotes/{remote}', check=False).returncode:
                raise VcsError(409, 'The shared repository has no branch with this name yet; push it first')
            return merge_outcome(clone, store.git.run(clone, 'merge', '--no-edit', '--', remote, author=author(current), check=False))
        return await operate(project, current, 'pull', work)

    @router.post('/api/vcs/projects/{project}/push')
    async def push(project: str, current: Current):
        def work(clone: Path):
            state = store.status(clone)
            if not state['branch']:
                raise VcsError(409, 'Check out a branch before pushing')
            if state['merging']:
                raise VcsError(409, 'Finish or abort the merge first')
            done = store.git.run(clone, 'push', '--quiet', '--porcelain', '-u', 'origin', f"refs/heads/{state['branch']}", check=False)
            if done.returncode:
                text = (done.stdout + done.stderr).decode('utf-8', 'replace')
                if 'rejected' in text or 'non-fast-forward' in text or 'fetch first' in text:
                    raise VcsError(409, 'The shared repository has newer commits; pull first')
                raise VcsError(409, 'Git refused the operation: ' + failure(done))
        return await operate(project, current, 'push', work, journal=False)

    @router.post('/api/vcs/projects/{project}/revert')
    async def revert(project: str, body: RefBody, current: Current):
        ref = valid_ref(body.ref)

        def work(clone: Path):
            if (clone / '.git' / 'MERGE_HEAD').exists():
                raise VcsError(409, 'Finish or abort the merge first')
            parents = store.git.text(clone, 'show', '--no-patch', '--format=%P', ref, '--').split()
            done = store.git.run(clone, 'revert', '--no-edit', *(['-m', '1'] if len(parents) > 1 else []), ref, author=author(current), check=False)
            if done.returncode:
                store.git.run(clone, 'revert', '--abort', check=False)
                raise VcsError(409, 'The commit cannot be reverted cleanly: ' + failure(done))
        return await operate(project, current, 'revert', work)

    @router.post('/api/vcs/projects/{project}/undo')
    async def undo(project: str, current: Current):
        return await operate(project, current, 'undo', lambda clone: {'operation': store.step(clone, True)['operation']}, journal=False)

    @router.post('/api/vcs/projects/{project}/redo')
    async def redo(project: str, current: Current):
        return await operate(project, current, 'redo', lambda clone: {'operation': store.step(clone, False)['operation']}, journal=False)

    return router
