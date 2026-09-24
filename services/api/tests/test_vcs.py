"""Change control oracles against real Git repositories (FEAT-0031, SC-0125 to SC-0133, SC-0155, SC-0156)."""
import base64
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from src.identity import TokenVerifier
from src.main import FileDocumentRepository, create_app
from src.vcs import canonical, extract_resources, restore_resources, valid_branch, valid_ref, VcsError
from tests.support import CONFIG, NOW, FakeKeycloak, admin_token, jwks, licensed, token

PIXELS = b'\x89PNG\r\n\x1a\n' + bytes(range(256)) * 2
PICTURE = 'data:image/png;base64,' + base64.b64encode(PIXELS).decode()
THUMB = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\nthumbnail').decode()
LAYER = {'id': 'shape', 'name': 'Shape', 'kind': 'rectangle', 'x': 10, 'y': 10, 'width': 100, 'height': 50, 'rotation': 0,
         'opacity': 1, 'visible': True, 'locked': False, 'blend': 'source-over', 'fill': '#336699', 'stroke': '#000000',
         'strokeWidth': 2, 'points': [], 'text': '', 'fontSize': 48, 'source': '',
         'adjustments': {'brightness': 100, 'contrast': 100, 'saturation': 100, 'blur': 0}}


def document(fill='#336699', picture=False, name='Poster'):
    layers = [{**LAYER, 'fill': fill}]
    if picture:
        layers.append({**LAYER, 'id': 'picture', 'kind': 'image', 'source': PICTURE})
    return {'format': 'ximply-document', 'version': 2, 'name': name, 'width': 800, 'height': 600, 'background': '#ffffff', 'layers': layers}


@unittest.skipUnless(shutil.which('git'), 'Git is not installed')
class ChangeControlTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(folder.cleanup)
        self.data = Path(folder.name)
        patcher = mock.patch.dict('os.environ', {'XDS_DATA_DIR': folder.name, 'XDS_TOKEN_KEY': Fernet.generate_key().decode()})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(create_app(FileDocumentRepository(self.data / 'p'), 'x' * 40, identity=CONFIG,
                                            verifier=TokenVerifier(CONFIG, keys=lambda: jwks()), admin=FakeKeycloak(),
                                            clock=lambda: NOW, lift_bans_every=None))
        self.ana = licensed(roles=('change-control',))
        self.bea = licensed(roles=('change-control',), sub='bea-subject', name='Bea Ruiz', email='bea@example.test')

    def call(self, method, path, body=None, bearer=None, expect=None):
        answer = self.client.request(method, '/api/vcs' + path, headers={'Authorization': 'Bearer ' + (bearer or self.ana)}, json=body)
        if expect is not None:
            self.assertEqual(expect, answer.status_code, answer.text)
        return answer.json() if answer.content else None

    def project(self, **extra):
        created = self.call('POST', '/projects', {'name': 'Poster', 'document': document(), 'thumbnail': THUMB, **extra}, expect=201)
        return '/projects/' + created['id']

    def commit(self, project, fill, message='Change the fill', bearer=None, expect=200):
        return self.call('POST', project + '/commit', {'message': message, 'document': document(fill), 'thumbnail': THUMB}, bearer, expect)

    def test_access_needs_the_change_control_licence(self):
        self.assertEqual(401, self.client.get('/api/vcs/projects').status_code)
        for bearer in (token(), licensed(roles=('ai-tools',)), licensed(roles=('change-control',), expires='2026-09-22T00:00:00Z')):
            self.assertEqual(403, self.client.get('/api/vcs/projects', headers={'Authorization': 'Bearer ' + bearer}).status_code)
        self.assertEqual(200, self.client.get('/api/vcs/projects', headers={'Authorization': 'Bearer ' + admin_token()}).status_code)

    def test_a_project_is_a_repository_with_a_canonical_document(self):
        project = self.project()
        self.assertEqual(['Poster'], [item['name'] for item in self.call('GET', '/projects')['projects']])
        log = self.call('GET', project + '/log')
        self.assertEqual(['Create the project Poster'], [item['subject'] for item in log['commits']])
        self.assertEqual(('Ana Diaz', 'ana@example.test'), (log['commits'][0]['author'], log['commits'][0]['email']))
        self.assertEqual({('main', 'local'), ('origin/main', 'remote')}, {(ref['name'], ref['kind']) for ref in log['refs']})
        state = self.call('GET', project + '/status')
        self.assertEqual(('main', 0, 0, []), (state['branch'], state['ahead'], state['behind'], state['changes']))
        self.assertEqual(document(), self.call('GET', project + '/document')['document'])
        clone = next((self.data / 'vcs' / 'projects').glob('*/clones/*'))
        stored = (clone / 'documents' / 'main.xds.json').read_text(encoding='utf-8')
        self.assertEqual(canonical(document()), stored)
        self.assertIn('\n  "layers": [\n', stored)

    def test_pictures_are_stored_once_as_files_named_by_their_hash(self):
        project = self.project()
        self.call('POST', project + '/commit', {'message': 'Place a picture', 'document': document(picture=True)}, expect=200)
        clone = next((self.data / 'vcs' / 'projects').glob('*/clones/*'))
        files = [path.name for path in (clone / 'resources').iterdir() if path.name != '.gitkeep']
        self.assertEqual(1, len(files))
        self.assertNotIn('base64', (clone / 'documents' / 'main.xds.json').read_text(encoding='utf-8'))
        self.assertEqual(document(picture=True), self.call('GET', project + '/document')['document'])

    def test_commits_record_their_changes_and_refuse_nothing_or_no_message(self):
        project = self.project()
        sha = self.commit(project, '#ff0000')['result']
        details = self.call('GET', f'{project}/commits/{sha}')
        self.assertEqual(('Change the fill', 'Ana Diaz'), (details['message'], details['author']))
        self.assertIn({'status': 'M', 'path': 'documents/main.xds.json'}, details['files'])
        self.assertEqual('Nothing changed since the last commit', self.commit(project, '#ff0000', expect=409)['detail'])
        self.assertEqual('Write a message for the commit', self.commit(project, '#00ff00', message='  ', expect=422)['detail'])
        self.assertEqual(1, self.call('GET', project + '/status')['ahead'])

    def test_each_commit_keeps_a_thumbnail_of_its_document(self):
        project = self.project()
        first = self.call('GET', project + '/log')['commits'][0]['sha']
        self.assertEqual(THUMB, self.call('GET', f'{project}/commits/{first}/thumbnail')['png'])
        second = self.call('POST', project + '/commit', {'message': 'No picture', 'document': document('#123456')}, expect=200)['result']
        self.assertIsNone(self.call('GET', f'{project}/commits/{second}/thumbnail')['png'])
        self.assertEqual(THUMB, self.call('GET', f'{project}/commits/{first}/thumbnail')['png'])
        bad = self.call('POST', project + '/commit', {'message': 'x', 'document': document('#654321'), 'thumbnail': 'data:image/png;base64,QUJD'}, expect=422)
        self.assertEqual('The preview is not a PNG under 600 KB', bad['detail'])

    def test_comments_on_commits_are_shared_and_removed_only_by_their_author(self):
        project = self.project()
        sha = self.call('GET', project + '/log')['commits'][0]['sha']
        added = self.call('POST', f'{project}/commits/{sha}/comments', {'text': '  Nice start  '}, expect=201)
        self.assertEqual(('Nice start', 'Ana Diaz'), (added['text'], added['author']))
        self.call('POST', f'{project}/commits/{sha}/comments', {'text': 'Agreed'}, bearer=self.bea, expect=201)
        self.assertEqual(['Nice start', 'Agreed'], [item['text'] for item in self.call('GET', f'{project}/commits/{sha}/comments', bearer=self.bea)['comments']])
        self.assertEqual({sha: 2}, self.call('GET', project + '/log')['comments'])
        self.call('DELETE', f"{project}/commits/{sha}/comments/{added['id']}", bearer=self.bea, expect=403)
        self.call('DELETE', f"{project}/commits/{sha}/comments/{added['id']}", expect=204)
        self.call('POST', f'{project}/commits/{"0" * 40}/comments', {'text': 'Ghost'}, expect=404)
        self.call('POST', f'{project}/commits/{sha}/comments', {'text': ''}, expect=422)

    def test_branches_are_created_renamed_checked_out_and_deleted(self):
        project = self.project()
        self.call('POST', project + '/branches', {'name': 'idea/blue'}, expect=200)
        self.call('POST', project + '/branches', {'name': 'idea/blue'}, expect=409)
        self.call('POST', project + '/branches', {'name': '--force'}, expect=422)
        self.call('PATCH', project + '/branches/idea/blue', {'name': 'blue'}, expect=200)
        state = self.call('POST', project + '/checkout', {'ref': 'blue'}, expect=200)['status']
        self.assertEqual('blue', state['branch'])
        self.commit(project, '#0000ff')
        self.assertEqual('Check out another branch before deleting this one', self.call('DELETE', project + '/branches/blue', expect=409)['detail'])
        self.call('POST', project + '/checkout', {'ref': 'main'}, expect=200)
        self.assertEqual('#336699', self.call('GET', project + '/document')['document']['layers'][0]['fill'])
        self.assertEqual('The branch has commits that no other branch holds', self.call('DELETE', project + '/branches/blue', expect=409)['detail'])
        self.call('DELETE', project + '/branches/blue?force=true', expect=200)
        self.assertEqual(['main', 'origin/main'], sorted(ref['name'] for ref in self.call('GET', project + '/log')['refs']))

    def test_a_merge_fast_forwards_or_records_a_merge_commit(self):
        project = self.project()
        self.call('POST', project + '/branches', {'name': 'blue'}, expect=200)
        self.call('POST', project + '/checkout', {'ref': 'blue'}, expect=200)
        self.commit(project, '#0000ff')
        self.call('POST', project + '/checkout', {'ref': 'main'}, expect=200)
        answer = self.call('POST', project + '/merge', {'ref': 'blue'}, expect=200)
        self.assertEqual({'conflicts': []}, answer['result'])
        self.assertTrue(answer['moved'])
        self.assertEqual('#0000ff', self.call('GET', project + '/document')['document']['layers'][0]['fill'])

    def test_conflicts_are_listed_and_resolved_by_side_or_aborted(self):
        project = self.project()
        self.call('POST', project + '/branches', {'name': 'blue'}, expect=200)
        self.commit(project, '#ff0000', 'Red on main')
        self.call('POST', project + '/checkout', {'ref': 'blue'}, expect=200)
        self.commit(project, '#0000ff', 'Blue on blue')
        self.call('POST', project + '/checkout', {'ref': 'main'}, expect=200)
        answer = self.call('POST', project + '/merge', {'ref': 'blue'}, expect=200)
        self.assertEqual(['documents/main.xds.json'], answer['result']['conflicts'])
        self.assertTrue(answer['status']['merging'])
        self.call('GET', project + '/document', expect=409)
        self.call('POST', project + '/checkout', {'ref': 'blue'}, expect=409)
        self.call('POST', project + '/merge/abort', expect=200)
        self.assertEqual('#ff0000', self.call('GET', project + '/document')['document']['layers'][0]['fill'])
        self.call('POST', project + '/merge', {'ref': 'blue'}, expect=200)
        done = self.call('POST', project + '/merge/resolve', {'path': 'documents/main.xds.json', 'side': 'theirs'}, expect=200)
        self.assertEqual({'finished': True}, done['result'])
        self.assertEqual('#0000ff', self.call('GET', project + '/document')['document']['layers'][0]['fill'])
        self.assertEqual(2, len(self.call('GET', project + '/log')['commits'][0]['parents']))

    def test_two_people_share_work_through_the_shared_repository(self):
        project = self.project()
        self.commit(project, '#ff0000', 'Ana paints red')
        self.call('POST', project + '/push', expect=200)
        self.assertEqual('#ff0000', self.call('GET', project + '/document', bearer=self.bea)['document']['layers'][0]['fill'])
        self.commit(project, '#00ff00', 'Bea paints green', bearer=self.bea)
        self.call('POST', project + '/push', bearer=self.bea, expect=200)
        self.commit(project, '#0000ff', 'Ana paints blue')
        self.assertEqual('The shared repository has newer commits; pull first', self.call('POST', project + '/push', expect=409)['detail'])
        fetched = self.call('POST', project + '/fetch', expect=200)['status']
        self.assertEqual((1, 1), (fetched['ahead'], fetched['behind']))
        pulled = self.call('POST', project + '/pull', expect=200)
        self.assertEqual(['documents/main.xds.json'], pulled['result']['conflicts'])
        self.call('POST', project + '/merge/resolve', {'path': 'documents/main.xds.json', 'side': 'mine'}, expect=200)
        self.call('POST', project + '/push', expect=200)
        self.assertEqual((0, 0), tuple(self.call('GET', project + '/status')[key] for key in ('ahead', 'behind')))
        bea_log = self.call('POST', project + '/pull', bearer=self.bea, expect=200)
        self.assertEqual('#0000ff', self.call('GET', project + '/document', bearer=self.bea)['document']['layers'][0]['fill'])
        self.assertFalse(bea_log['status']['merging'])

    def test_undo_and_redo_follow_the_journal_and_spare_shared_commits(self):
        project = self.project()
        self.call('POST', project + '/branches', {'name': 'blue'}, expect=200)
        first = self.commit(project, '#ff0000')['result']
        state = self.call('POST', project + '/undo', expect=200)
        self.assertEqual('commit', state['result']['operation'])
        self.assertTrue(state['status']['canRedo'])
        self.assertEqual('#336699', self.call('GET', project + '/document')['document']['layers'][0]['fill'])
        self.call('POST', project + '/undo', expect=200)
        self.assertNotIn('blue', [ref['name'] for ref in self.call('GET', project + '/log')['refs']])
        self.call('POST', project + '/redo', expect=200)
        self.call('POST', project + '/redo', expect=200)
        self.assertEqual(first, self.call('GET', project + '/status')['head'])
        self.call('POST', project + '/redo', expect=409)
        self.call('POST', project + '/push', expect=200)
        refused = self.call('POST', project + '/undo', expect=409)
        self.assertEqual('Those commits are already in the shared repository; revert them instead', refused['detail'])
        self.call('POST', project + '/revert', {'ref': first}, expect=200)
        self.assertEqual('#336699', self.call('GET', project + '/document')['document']['layers'][0]['fill'])

    def test_checkout_of_a_commit_and_of_a_shared_branch(self):
        project = self.project()
        root = self.call('GET', project + '/status')['head']
        self.commit(project, '#ff0000')
        detached = self.call('POST', project + '/checkout', {'ref': root}, expect=200)['status']
        self.assertEqual((None, root), (detached['branch'], detached['head']))
        self.call('POST', project + '/push', expect=409)
        self.call('POST', project + '/checkout', {'ref': 'main'}, expect=200)
        self.call('POST', project + '/branches', {'name': 'shared'}, expect=200)
        self.call('POST', project + '/checkout', {'ref': 'shared'}, expect=200)
        self.call('POST', project + '/push', expect=200)
        tracked = self.call('POST', project + '/checkout', {'ref': 'origin/shared'}, bearer=self.bea, expect=200)['status']
        self.assertEqual(('shared', 'origin/shared'), (tracked['branch'], tracked['upstream']))

    def test_unknown_projects_and_invalid_documents_are_refused(self):
        self.call('GET', '/projects/0123456789ab/status', expect=404)
        self.call('GET', '/projects/../../etc/status', expect=404)
        self.call('POST', '/projects', {'name': 'X', 'document': {'format': 'other'}}, expect=422)
        self.call('POST', '/projects', {'name': '   ', 'document': document()}, expect=422)
        audit = (self.data / 'audit' / 'admin.jsonl')
        self.assertFalse(audit.exists() and '#336699' in audit.read_text())


class HelperTests(unittest.TestCase):
    def test_reference_names_never_become_options_or_paths(self):
        for good in ('main', 'idea/blue', 'v1.2', 'a_b-c'):
            self.assertEqual(good, valid_branch(good))
        for bad in ('-f', '--force', 'a..b', 'a//b', 'x.lock', 'end/', 'dot.', 'HEAD', 'origin/x', 'a b', 'a~1', 'a^', 'a:b', '@{u}', ''):
            with self.assertRaises(VcsError, msg=bad):
                valid_branch(bad)
        self.assertEqual('abc1234', valid_ref('abc1234'))
        self.assertEqual('origin/main', valid_ref('origin/main'))
        with self.assertRaises(VcsError):
            valid_ref('origin/--delete')

    def test_resources_round_trip_and_are_checked_against_their_name(self):
        resources = {}
        stored = extract_resources(document(picture=True), resources)
        name = next(iter(resources))
        self.assertEqual('xds-resource:' + name, stored['layers'][1]['source'])
        self.assertEqual(document(picture=True), restore_resources(stored, resources.__getitem__))
        with self.assertRaises(VcsError):
            restore_resources(stored, lambda _: b'tampered')
        self.assertEqual(canonical(json.loads(canonical(stored))), canonical(stored))


if __name__ == '__main__':
    unittest.main()
