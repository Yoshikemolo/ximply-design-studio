"""Run a disposable aggregate diagnostic; never substitutes for the module gate."""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
from urllib import error, parse, request

METRICS = ('bugs', 'vulnerabilities', 'code_smells', 'security_hotspots', 'coverage',
           'line_coverage', 'branch_coverage', 'conditions_to_cover',
           'duplicated_lines_density', 'ncloc')
PROJECT = 'ximply-design-studio-disposable-trial'


class TrialError(RuntimeError):
    """A bounded diagnostic failed without disclosing credentials."""


class Api:
    def __init__(self, server: str):
        url = parse.urlsplit(server)
        if (url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost', '::1')
                or url.username or url.password or url.path not in ('', '/')
                or url.query or url.fragment):
            raise TrialError('The disposable server must use a loopback HTTP URL')
        self.server = server.rstrip('/')
        self.auth = ''
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def credentials(self, username: str, password: str = '') -> None:
        self.auth = base64.b64encode(f'{username}:{password}'.encode()).decode()

    def call(self, path: str, params: dict | None = None, post: bool = False) -> dict:
        encoded = parse.urlencode(params or {}).encode()
        url = self.server + '/api/' + path
        if not post and encoded:
            url += '?' + encoded.decode()
        headers = {'Authorization': 'Basic ' + self.auth} if self.auth else {}
        req = request.Request(url, data=encoded if post else None, headers=headers)
        try:
            with self.opener.open(req, timeout=30) as response:
                body = response.read(2 * 1024 * 1024 + 1)
                if len(body) > 2 * 1024 * 1024:
                    raise TrialError('Sonar API response exceeded the size limit')
            return json.loads(body) if body else {}
        except (error.URLError, ValueError) as exc:
            raise TrialError(f'Sonar API request failed: {path}') from None


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise TrialError('Sonar API redirects are forbidden')


def wait_for(fetch, finished, timeout: int, interval: int = 3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = fetch()
        if finished(result):
            return result
        time.sleep(interval)
    raise TrialError('Sonar operation exceeded its time limit')


def overall_errors(metrics: dict) -> list[str]:
    errors = []
    def number(name):
        value = metrics.get(name)
        if isinstance(value, bool):
            return None
        try:
            value = float(value)
            return value if math.isfinite(value) else None
        except (TypeError, ValueError):
            return None
    for name in ('bugs', 'vulnerabilities', 'code_smells', 'security_hotspots'):
        if number(name) != 0:
            errors.append(f'{name} must be zero')
    for name in ('coverage', 'line_coverage'):
        value = number(name)
        if value is None or not 80 < value <= 100:
            errors.append(f'{name} must exceed 80 and not exceed 100')
    branches = number('conditions_to_cover')
    if branches is None or branches < 0 or not branches.is_integer():
        errors.append('conditions_to_cover must be a nonnegative integer')
    elif branches > 0:
        value = number('branch_coverage')
        if value is None or not 80 < value <= 100:
            errors.append('branch_coverage must exceed 80 and not exceed 100')
    duplication = number('duplicated_lines_density')
    if duplication is None or not 0 <= duplication < 3:
        errors.append('duplicated_lines_density must be below 3')
    return errors


def save(folder: Path, name: str, data: dict) -> None:
    (folder / name).write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def collect_pages(api: Api, endpoint: str, params: dict, key: str) -> dict:
    items = []
    for page in range(1, 101):
        result = api.call(endpoint, {**params, 'p': page, 'ps': 100})
        items.extend(result[key])
        total = result.get('paging', {}).get('total', result.get('total'))
        if not isinstance(total, int):
            raise TrialError('Sonar pagination metadata is missing')
        if len(items) >= total:
            return {key: items, 'total': total, 'complete': True}
    return {key: items, 'total': total, 'complete': False}


def run_scanner(root: Path, server: str, token: str, revision: str, output: Path) -> None:
    images = json.loads((root / 'infra/sonar/trial-images.json').read_text())
    scanner = images['scanner']
    if not re.fullmatch(r'[a-zA-Z0-9./_-]+@sha256:[0-9a-f]{64}', scanner):
        raise TrialError('Scanner image must be digest pinned')
    # This private file is outside the checkout and removed even on scanner failure.
    with tempfile.TemporaryDirectory(prefix='xds-sonar-') as private:
        settings = Path(private) / 'scanner.properties'
        properties = {
            'sonar.host.url': server, 'sonar.token': token,
            'sonar.projectKey': PROJECT, 'sonar.projectName': 'Disposable aggregate diagnostic',
            'sonar.projectBaseDir': str(root), 'sonar.scm.revision': revision,
            'sonar.sources': 'apps,packages,services,harness,scripts',
            'sonar.tests': 'apps,packages,services,tests',
            'sonar.test.inclusions': '**/tests/**,**/*.test.ts,**/*.spec.ts',
            'sonar.javascript.lcov.reportPaths': 'reports/typescript/lcov.info',
            'sonar.python.coverage.reportPaths': 'reports/api/coverage.xml,reports/engineering/coverage.xml',
            'sonar.scanner.metadataFilePath': str(output / 'report-task.txt'),
            'sonar.sourceEncoding': 'UTF-8', 'sonar.qualitygate.wait': 'false',
        }
        settings.write_text(''.join(f'{k}={v}\n' for k, v in properties.items()))
        settings.chmod(0o600)
        command = ['docker', 'run', '--rm', '--name', 'xds-sonar-trial-scanner', '--network', 'host', '--user', f'{os.getuid()}:{os.getgid()}',
                   '-e', 'SONAR_USER_HOME=/tmp/sonar-cache', '-v', f'{root}:{root}',
                   '-v', f'{private}:{private}:ro', '-w', str(root), scanner,
                   f'-Dproject.settings={settings}']
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=1200, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise TrialError('Scanner could not complete within its time limit') from None
        # Redact both the actual credential and credential-property spellings.
        log = (result.stdout + '\n' + result.stderr).replace(token, '[REDACTED]')
        log = re.sub(r'(?i)(sonar[.](?:token|login|password)\s*[=:]\s*)[^\s]+', r'\1[REDACTED]', log)
        (output / 'scanner.log').write_text(log, encoding='utf-8')
        if result.returncode:
            raise TrialError('Scanner failed; no successful analysis was produced')


def trial(root: Path, server: str, api: Api | None = None) -> int:
    output = root / 'reports/sonar-trial'
    output.mkdir(parents=True, exist_ok=True)
    api = api or Api(server)
    status = {'scope': 'aggregate-diagnostic-only', 'fullProductGate': 'NOT_EVALUATED',
              'newCode': 'UNAVAILABLE_INITIAL_ANALYSIS', 'status': 'ERROR'}
    try:
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
        status['revision'] = revision
        def startup():
            try:
                return api.call('system/status')
            except TrialError:
                return {}
        status['server'] = wait_for(startup, lambda value: value.get('status') == 'UP', 300)
        password = secrets.token_urlsafe(48)
        api.credentials('admin', 'admin')
        api.call('users/change_password', {'login': 'admin', 'previousPassword': 'admin', 'password': password}, True)
        api.credentials('admin', password)
        token = api.call('user_tokens/generate', {'name': 'disposable-trial'}, True)['token']
        api.credentials(token)
        run_scanner(root, server, token, revision, output)
        task_file = dict(line.split('=', 1) for line in (output / 'report-task.txt').read_text().splitlines() if '=' in line)
        task_id = task_file.get('ceTaskId')
        if not task_id:
            raise TrialError('Scanner task identifier is missing')
        task = wait_for(lambda: api.call('ce/task', {'id': task_id}),
                        lambda value: value.get('task', {}).get('status') in ('SUCCESS', 'FAILED', 'CANCELED'), 600)
        save(output, 'task.json', task)
        if task['task']['status'] != 'SUCCESS':
            raise TrialError('Sonar compute task did not succeed')
        measures = api.call('measures/component', {'component': PROJECT, 'metricKeys': ','.join(METRICS)})
        save(output, 'measures.json', measures)
        metrics = {item['metric']: item.get('value') for item in measures['component']['measures']}
        issues = collect_pages(api, 'issues/search', {'componentKeys': PROJECT, 'resolved': 'false'}, 'issues')
        save(output, 'issues.json', issues)
        hotspots = collect_pages(api, 'hotspots/search', {'projectKey': PROJECT}, 'hotspots')
        save(output, 'hotspots.json', hotspots)
        gate = api.call('qualitygates/project_status', {'analysisId': task['task']['analysisId']})
        save(output, 'server-gate.json', gate)
        failures = overall_errors(metrics)
        if not issues['complete'] or not hotspots['complete']:
            failures.append('Issue inventory exceeded the bounded export limit')
        status.update(status='FAIL' if failures else 'PASS', overallMetrics=metrics, failures=failures)
    except (TrialError, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        status['error'] = str(exc) if isinstance(exc, TrialError) else 'Disposable diagnostic could not complete'
    finally:
        save(output, 'status.json', status)
    print(f"Disposable aggregate diagnostic: {status['status']}; full product gate: NOT_EVALUATED")
    return int(status['status'] != 'PASS')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--server', default='http://127.0.0.1:19000')
    args = parser.parse_args()
    return trial(args.root.resolve(), args.server)


if __name__ == '__main__':
    raise SystemExit(main())
