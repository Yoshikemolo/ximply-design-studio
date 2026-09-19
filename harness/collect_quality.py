"""Collect revision-bound Sonar evidence; never substitute stale or missing metrics."""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

try:
    from harness.check_quality import POLICY, check_report
except ModuleNotFoundError:
    from check_quality import POLICY, check_report

METRICS = {
    'bugs': 'bugs', 'vulnerabilities': 'vulnerabilities',
    'codeSmells': 'code_smells', 'securityHotspots': 'security_hotspots',
    'coverage': 'coverage', 'lineCoverage': 'line_coverage',
    'branchCoverage': 'branch_coverage', 'branchesToCover': 'conditions_to_cover',
    'duplication': 'duplicated_lines_density',
}
MAX_RESPONSE = 2 * 1024 * 1024


class EvidenceError(ValueError):
    """Evidence cannot establish the requested analysis."""


class NoRedirect(HTTPRedirectHandler):
    """Never forward a credential to a redirected endpoint."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise EvidenceError('Sonar redirects are forbidden')


def server_url(value: str, allow_local_http: bool) -> str:
    parts = urlsplit(value)
    if (not parts.hostname or parts.username or parts.password or parts.query
            or parts.fragment or any(c.isspace() for c in value)):
        raise EvidenceError('Invalid Sonar server URL')
    local = parts.hostname in ('localhost', '127.0.0.1', '::1')
    if parts.scheme != 'https' and not (parts.scheme == 'http' and local and allow_local_http):
        raise EvidenceError('HTTPS required; local HTTP needs explicit opt-in')
    return value.rstrip('/')


class SonarClient:
    """Small read-only client with bounded responses and redacted errors."""

    def __init__(self, server: str, token: str, allow_local_http: bool = False):
        self.server = server_url(server, allow_local_http)
        if not token or any(c.isspace() for c in token):
            raise EvidenceError('Missing or malformed SONAR_TOKEN')
        self._token = token
        self._opener = build_opener(ProxyHandler({}), NoRedirect())

    def get(self, path: str, parameters: dict | None = None, text: bool = False):
        if path not in ('api/server/version', 'api/ce/task', 'api/project_analyses/search',
                        'api/measures/component', 'api/qualitygates/project_status'):
            raise EvidenceError('Unsupported Sonar endpoint')
        url = self.server + '/' + path
        if parameters:
            url += '?' + urlencode(parameters)
        request = Request(url, headers={'Authorization': 'Bearer ' + self._token, 'Accept': 'application/json'})
        try:
            with self._opener.open(request, timeout=20) as response:
                content = response.read(MAX_RESPONSE + 1)
            if len(content) > MAX_RESPONSE:
                raise EvidenceError('Sonar response exceeds size limit')
            decoded = content.decode('utf-8')
            return decoded.strip() if text else json.loads(decoded)
        except (HTTPError, URLError, OSError, UnicodeError, json.JSONDecodeError):
            raise EvidenceError('Sonar request failed or returned invalid data') from None


def validate_manifest(manifest: dict, policy: dict) -> None:
    if not isinstance(manifest, dict) or set(manifest) != {'serverVersion', 'modules'}:
        raise EvidenceError('Manifest requires only serverVersion and modules')
    version = manifest['serverVersion']
    if not isinstance(version, str) or not re.fullmatch(r'\d+(?:\.\d+){1,4}', version):
        raise EvidenceError('An exact numeric Sonar server version is required')
    modules = manifest['modules']
    if not isinstance(modules, dict) or set(modules) != set(policy['requiredModules']):
        raise EvidenceError('Manifest must match the complete required module inventory')
    projects, tasks = set(), set()
    for item in modules.values():
        if not isinstance(item, dict) or set(item) != {'projectKey', 'taskId'}:
            raise EvidenceError('Each module requires only projectKey and taskId; branch scans are unsupported')
        for value in item.values():
            if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]+', value):
                raise EvidenceError('Invalid project or task identifier')
        if item['projectKey'] in projects or item['taskId'] in tasks:
            raise EvidenceError('Projects and tasks must be distinct per module')
        projects.add(item['projectKey'])
        tasks.add(item['taskId'])


def latest(client, project: str, analysis: str, revision: str) -> None:
    response = client.get('api/project_analyses/search', {'project': project, 'ps': 1, 'p': 1})
    records = response.get('analyses', [])
    if not records or records[0].get('key') != analysis or records[0].get('revision') != revision:
        raise EvidenceError('Latest analysis does not match the submitted task and revision')


def number(value, integer: bool = False):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise EvidenceError('Missing or invalid numeric measure')
    try:
        result = float(value)
    except ValueError:
        raise EvidenceError('Invalid numeric measure') from None
    if not math.isfinite(result) or result < 0 or (integer and not result.is_integer()):
        raise EvidenceError('Non-finite, negative or fractional count measure')
    return int(result) if integer else result


def normalize(measures: list) -> dict:
    indexed = {}
    for measure in measures:
        key = measure['metric']
        if key in indexed:
            raise EvidenceError('Duplicate metric in Sonar response')
        indexed[key] = measure
    result = {}
    for scope, prefix in (('overall', ''), ('newCode', 'new_')):
        output = {}
        for name, metric in METRICS.items():
            measure = indexed.get(prefix + metric, {})
            raw = measure.get('period', {}).get('value') if prefix else measure.get('value')
            if name == 'branchCoverage' and raw is None:
                continue
            output[name] = number(raw, integer=name in ('bugs', 'vulnerabilities', 'codeSmells', 'securityHotspots', 'branchesToCover'))
        if output['branchesToCover'] > 0 and 'branchCoverage' not in output:
            raise EvidenceError('Missing branch coverage for executable conditions')
        result[scope] = output
    return result


def collect_module(client, item: dict, revision: str) -> dict:
    task = client.get('api/ce/task', {'id': item['taskId']}).get('task', {})
    if (task.get('id') != item['taskId'] or task.get('componentKey') != item['projectKey']
            or task.get('status') != 'SUCCESS' or task.get('type') != 'REPORT'
            or not isinstance(task.get('analysisId'), str) or not task['analysisId']):
        raise EvidenceError('Submitted analysis task is missing, mismatched or unsuccessful')
    analysis = task['analysisId']
    latest(client, item['projectKey'], analysis, revision)
    gate = client.get('api/qualitygates/project_status', {'analysisId': analysis}).get('projectStatus', {}).get('status')
    if gate not in ('OK', 'WARN', 'ERROR', 'NONE'):
        raise EvidenceError('Missing quality gate status')
    keys = [prefix + key for prefix in ('', 'new_') for key in METRICS.values()]
    component = client.get('api/measures/component', {'component': item['projectKey'], 'metricKeys': ','.join(keys)}).get('component', {})
    if component.get('key') != item['projectKey'] or not isinstance(component.get('measures'), list):
        raise EvidenceError('Missing or mismatched measure component')
    metrics = normalize(component['measures'])
    latest(client, item['projectKey'], analysis, revision)
    return {'revision': revision, 'analysisStatus': 'SUCCESS', 'qualityGate': gate,
            'projectKey': item['projectKey'], 'taskId': item['taskId'], 'analysisId': analysis, **metrics}


def collect(client, manifest: dict, revision: str, policy: dict) -> dict:
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise EvidenceError('A full lowercase Git commit SHA is required')
    validate_manifest(manifest, policy)
    if client.get('api/server/version', text=True) != manifest['serverVersion']:
        raise EvidenceError('Sonar server version differs from the reviewed manifest')
    try:
        modules = {name: collect_module(client, manifest['modules'][name], revision)
                   for name in policy['requiredModules']}
    except (KeyError, TypeError, AttributeError, IndexError):
        raise EvidenceError('Malformed Sonar evidence structure') from None
    return {'schemaVersion': 1, 'revision': revision, 'serverVersion': manifest['serverVersion'], 'modules': modules}


def report_path(value: str) -> Path:
    output = Path(value).resolve()
    directory = (Path.cwd() / 'reports').resolve()
    if directory not in output.parents or output.suffix != '.json':
        raise EvidenceError('Output must be a JSON file within the local reports directory')
    return output


def write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as stream:
            temporary = Path(stream.name)
            json.dump(report, stream, indent=2, allow_nan=False)
            stream.write('\n')
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', required=True)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--output', default='reports/quality.json')
    parser.add_argument('--allow-local-http', action='store_true')
    args = parser.parse_args(argv)
    try:
        output = report_path(args.output)
        if output == args.manifest.resolve():
            raise EvidenceError('Output must not overwrite the input manifest')
        output.unlink(missing_ok=True)
        policy = json.loads(POLICY.read_text())
        manifest = json.loads(args.manifest.read_text())
        client = SonarClient(args.server, os.environ.get('SONAR_TOKEN', ''), args.allow_local_http)
        report = collect(client, manifest, args.revision, policy)
        errors = check_report(report, args.revision, policy)
        write_report(output, report)
        for error in errors:
            print(error)
        return int(bool(errors))
    except (EvidenceError, OSError, ValueError, TypeError):
        print('Quality evidence collection failed. Verify the manifest, server, token and exact analysis revision.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
