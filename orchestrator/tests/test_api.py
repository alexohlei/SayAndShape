import http.cookiejar
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sayandshape-api-tests-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ('api', 'login', 'setup'):
            shutil.copytree(ROOT / name, self.root / name)
        shutil.copytree(ROOT / 'orchestrator',self.root / 'orchestrator', ignore=shutil.ignore_patterns('__pycache__'))
        (self.root / 'config').mkdir()
        (self.root / 'jobs').mkdir()
        (self.root / 'sessions').mkdir()
        self.clone = self.root / 'clones/main'
        self.clone.mkdir(parents=True)
        (self.root / 'config/apps.json').write_text(json.dumps({'apps': {'demo': {'clone_dir': str(self.clone.parent)}}}))
        # Engine login with the shared password; the API is served directly, so no project context applies.
        (self.root / 'router.php').write_text('''<?php
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/login') {
 require __DIR__ . '/api/auth.php';
 file_put_contents(__DIR__ . '/config/auth.json', json_encode(['password_hash' => password_hash('test-pass', PASSWORD_BCRYPT, ['cost' => 4])]));
 echo json_encode(['error' => sayandshapeLogin('test-pass')]); return;
}
return false;
''')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        self.url = f'http://127.0.0.1:{port}'
        self.server = subprocess.Popen(['php', '-d', 'session.save_path=' + str(self.root / 'sessions'),
                                       '-S', f'127.0.0.1:{port}', '-t', str(self.root), str(self.root / 'router.php')],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(self.stop)
        for _ in range(50):
            try:
                urllib.request.urlopen(self.url + '/api/session.php', timeout=1).close()
                break
            except OSError: time.sleep(.02)
        self.anon = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.user = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.user.open(self.url + '/login?user=1').close()

    def stop(self):
        self.server.terminate()
        self.server.wait(timeout=5)

    def request(self, endpoint, body=None, client=None, raw=None):
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + '/api/' + endpoint, data=data,
                                     headers={'Content-Type': 'application/json'} if data else {})
        try: res = (client or self.user).open(req, timeout=3)
        except urllib.error.HTTPError as err: res = err
        with res:
            return res.status, json.loads(res.read())

    def page(self, path, client=None, form=None):
        """An HTML page (login, setup) as (status, text); form is a urlencoded POST body."""
        req = urllib.request.Request(self.url + path, data=form,
                                     headers={'Content-Type': 'application/x-www-form-urlencoded'} if form else {})
        try: res = (client or self.user).open(req, timeout=5)
        except urllib.error.HTTPError as err: res = err
        with res:
            return res.status, res.read().decode()

    def set_language(self, language):
        config = json.loads((self.root / 'config/apps.json').read_text())
        config['language'] = language
        (self.root / 'config/apps.json').write_text(json.dumps(config))

    def test_anonymous_read_and_write_denied(self):
        for endpoint in ['history.php?app_id=demo&workspace=main', 'status.php?app_id=demo&workspace=main', 'workspaces.php?app_id=demo', 'submit.php', 'reset.php', 'rollback.php', 'cancel.php', 'baseline.php', 'fork.php', 'delete_workspace.php', 'rename_workspace.php', 'promote.php', 'apps.php', 'inspect_dir.php']:
            code, data = self.request(endpoint, client=self.anon)
            self.assertEqual((code, data['message']), (401, 'Not logged in'))

    def test_other_user_status_and_cancel_denied(self):
        path = self.root / 'jobs/j_foreign.json'
        path.write_text(json.dumps(dict(job_id='j_foreign', user_id=2, app_id='demo')))
        self.assertEqual(self.request('status.php?job_id=j_foreign')[0], 404)
        self.assertEqual(self.request('cancel.php', {'job_id': 'j_foreign'})[0], 404)
        self.assertFalse((self.root / 'jobs/j_foreign.cancel').exists())

    def test_submission_active_recovery_and_duplicate(self):
        code, data = self.request('submit.php', {'app_id': 'demo', 'workspace': 'main', 'transcript': 'Make it blue'})
        self.assertEqual(code, 202)
        jid = data['job_id']
        code, active = self.request('status.php?app_id=demo&workspace=main')
        self.assertEqual(active['status']['job_id'], jid)
        code, duplicate = self.request('submit.php', {'app_id': 'demo', 'workspace': 'main', 'transcript': 'Make it red'})
        self.assertEqual(code, 409)
        self.assertEqual(duplicate['job_id'], jid)
        self.assertEqual(duplicate['message'], 'A job is already running in this variant')
        self.assertEqual(len(list((self.root / 'jobs').glob('j_*.json'))), 1)
        code, cancelled = self.request('cancel.php', {'job_id': jid})
        self.assertEqual(code, 202)
        self.assertEqual(cancelled['status']['status'], 'pending')
        self.assertTrue(cancelled['status']['cancel_requested'])
        self.assertFalse((self.root / 'jobs' / (jid + '.status.json')).exists())

    def test_reset_and_rollback_only_enqueue(self):
        code, data = self.request('reset.php', {'app_id': 'demo', 'workspace': 'main'})
        self.assertEqual(code, 202)
        path = self.root / 'jobs' / (data['job_id'] + '.json')
        self.assertEqual(json.loads(path.read_text())['action'], 'reset')
        path.unlink()
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.clone), *args]).decode().strip()
        git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@local')
        (self.clone / 'file.txt').write_text('before'); git('add', '-A'); git('commit', '-qm', 'baseline')
        (self.clone / 'file.txt').write_text('after'); git('add', '-A'); git('commit', '-qm', 'change')
        head = git('rev-parse', 'HEAD')
        code, data = self.request('rollback.php', {'app_id': 'demo', 'workspace': 'main', 'commit_hash': head})
        self.assertEqual(code, 202)
        path = self.root / 'jobs' / (data['job_id'] + '.json')
        self.assertEqual(json.loads(path.read_text())['action'], 'rollback')
        self.assertEqual((self.clone / 'file.txt').read_text(), 'after')
        self.assertEqual(json.loads(path.read_text())['expected_head'], head)

    def test_invalid_input_and_methods(self):
        self.assertEqual(self.request('reset.php')[0], 405)
        self.assertEqual(self.request('submit.php', raw=b'{broken')[0], 400)
        self.assertEqual(self.request('submit.php', {'app_id': 'demo', 'workspace': 'main', 'transcript': []})[0], 400)
        self.assertEqual(self.request('submit.php', {'app_id': [], 'workspace': 'main', 'transcript': 'ok'})[0], 400)
        self.assertEqual(self.request('submit.php', {'app_id': 'demo', 'workspace': 'main', 'transcript': 'x' * 10001})[0], 400)
        self.assertEqual(list((self.root / 'jobs').glob('j_*.json')), [])

    def test_terminal_cancel_reports_actual_state(self):
        job = dict(job_id='j_done', user_id=1, app_id='demo')
        (self.root / 'jobs/j_done.json').write_text(json.dumps(job))
        (self.root / 'jobs/j_done.status.json').write_text(json.dumps(dict(job_id='j_done', status='done')))
        code, data = self.request('cancel.php', {'job_id': 'j_done'})
        self.assertEqual(code, 200)
        self.assertEqual(data['status']['status'], 'done')
        self.assertFalse((self.root / 'jobs/j_done.cancel').exists())

    def test_dependency_checked_on_api_and_latest_remains_available(self):
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.clone), *args]).decode().strip()
        git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@local')
        (self.clone / 'file.txt').write_text('before'); git('add', '-A'); git('commit', '-qm', 'baseline')
        (self.clone / 'file.txt').write_text('first'); git('add', '-A'); git('commit', '-qm', 'first')
        first = git('rev-parse', 'HEAD')
        (self.clone / 'file.txt').write_text('second'); git('add', '-A'); git('commit', '-qm', 'second')
        second = git('rev-parse', 'HEAD')
        code, data = self.request('history.php?app_id=demo&workspace=main')
        self.assertTrue(data['commits'][0]['can_rollback'])
        self.assertFalse(data['commits'][1]['can_rollback'])
        code, data = self.request('rollback.php', {'app_id': 'demo', 'workspace': 'main', 'commit_hash': first})
        self.assertEqual(code, 409)
        self.assertEqual(list((self.root / 'jobs').glob('j_*.json')), [])
        code, data = self.request('rollback.php', {'app_id': 'demo', 'workspace': 'main', 'commit_hash': second})
        self.assertEqual(code, 202)

    def test_baseline_only_enqueues_and_empty_history_is_rejected(self):
        self.assertEqual(self.request('baseline.php', {'app_id': 'demo', 'workspace': 'main'})[0], 409)
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.clone), *args]).decode().strip()
        git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@local')
        (self.clone / 'file.txt').write_text('before'); git('add', '-A'); git('commit', '-qm', 'baseline')
        (self.clone / 'file.txt').write_text('after'); git('add', '-A'); git('commit', '-qm', 'change')
        head = git('rev-parse', 'HEAD')
        code, data = self.request('baseline.php', {'app_id': 'demo', 'workspace': 'main'})
        self.assertEqual(code, 202)
        queued = json.loads((self.root / 'jobs' / (data['job_id'] + '.json')).read_text())
        self.assertEqual(queued['action'], 'baseline')
        self.assertEqual(queued['expected_head'], head)
        self.assertEqual(git('rev-parse', 'HEAD'), head)
        self.assertEqual(len(self.request('history.php?app_id=demo&workspace=main')[1]['commits']), 1)

    def test_history_exposes_archive_and_no_rollback_for_archived_change(self):
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.clone), *args]).decode().strip()
        git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@local')
        (self.clone / 'file.txt').write_text('before'); git('add', '-A'); git('commit', '-qm', 'baseline')
        (self.clone / 'file.txt').write_text('after'); git('add', '-A'); git('commit', '-qm', 'archived prompt')
        head = git('rev-parse', 'HEAD')
        code = "import sys; sys.path.insert(0, sys.argv[1]); import repo_state; repo_state.establish(sys.argv[2], 'archive_test', '2026-09-18T12:00:00Z')"
        subprocess.run(['python3', '-c', code, str(self.root / 'orchestrator'), str(self.clone)], check=True)
        status, data = self.request('history.php?app_id=demo&workspace=main')
        self.assertEqual(status, 200)
        self.assertEqual(data['commits'], [])
        self.assertEqual(data['archives'][0]['commits'][0]['message'], 'archived prompt')
        self.assertEqual(self.request('rollback.php', {'app_id': 'demo', 'workspace': 'main', 'commit_hash': head})[0], 409)

    def test_history_preserves_multiline_prompt_with_pipe(self):
        def git(*args): subprocess.run(['git', '-C', str(self.clone), *args], check=True, capture_output=True)
        git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@local')
        (self.clone / 'file.txt').write_text('one')
        git('add', '-A'); git('commit', '-qm', 'initial clone')
        (self.clone / 'file.txt').write_text('two')
        prompt = 'A prompt | with separator\n\nand several lines'
        git('add', '-A'); git('commit', '-qm', prompt)
        code, data = self.request('history.php?app_id=demo&workspace=main')
        self.assertEqual(code, 200)
        self.assertEqual(len(data['commits']), 1)
        self.assertEqual(data['commits'][0]['message'], prompt)
        self.assertTrue(data['commits'][0]['can_rollback'])

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.clone), *args]).decode().strip()

    def init_clone(self):
        self.git('init', '-q'); self.git('config', 'user.name', 'Test'); self.git('config', 'user.email', 'test@local')
        (self.clone / 'file.txt').write_text('before'); self.git('add', '-A'); self.git('commit', '-qm', 'baseline')
        return self.git('rev-parse', 'HEAD')

    def registry(self, workspaces):
        (self.clone.parent / 'workspaces.json').write_text(json.dumps({'version': 1, 'workspaces': workspaces}))

    def test_unknown_workspace_and_missing_workspace_are_rejected(self):
        self.assertEqual(self.request('submit.php', {'app_id': 'demo', 'workspace': 'nope', 'transcript': 'x'})[0], 404)
        self.assertEqual(self.request('submit.php', {'app_id': 'demo', 'transcript': 'x'})[0], 400)
        self.assertEqual(self.request('submit.php', {'app_id': 'demo', 'workspace': 'Bad Slug', 'transcript': 'x'})[0], 400)
        self.assertEqual(self.request('history.php?app_id=demo&workspace=nope')[0], 404)
        self.assertEqual(self.request('status.php?app_id=demo')[0], 400)
        self.assertEqual(list((self.root / 'jobs').glob('j_*.json')), [])

    def test_workspaces_list_public_before_creation_and_active_job(self):
        code, data = self.request('workspaces.php?app_id=demo')
        self.assertEqual(code, 200)
        self.assertEqual(data['public'], 'main')
        self.assertEqual([w['slug'] for w in data['workspaces']], ['main'])
        self.assertFalse(data['workspaces'][0]['exists'])
        self.assertIsNone(data['workspaces'][0]['active_job'])
        head = self.init_clone()
        self.registry({'main': {'slug': 'main', 'name': 'main', 'parent': None, 'fork_commit': None},
                       'winter': {'slug': 'winter', 'name': 'Winter', 'parent': 'main', 'fork_commit': head}})
        subprocess.check_call(['git', 'clone', '-q', str(self.clone), str(self.clone.parent / 'winter')])
        code, data = self.request('submit.php', {'app_id': 'demo', 'workspace': 'winter', 'transcript': 'Snow', 'author': 'Maria'})
        self.assertEqual(code, 202)
        code, data = self.request('workspaces.php?app_id=demo')
        by_slug = {w['slug']: w for w in data['workspaces']}
        self.assertTrue(by_slug['main']['exists'] and by_slug['main']['public'])
        self.assertEqual(by_slug['winter']['parent'], 'main')
        self.assertEqual(by_slug['winter']['changes_since_fork'], 0)
        self.assertEqual(by_slug['winter']['active_job']['status'], 'pending')
        self.assertEqual(by_slug['winter']['active_job']['author'], 'Maria')
        self.assertIsNone(by_slug['main']['active_job'])
        # A second job for the busy workspace is refused, another workspace is fine.
        self.assertEqual(self.request('submit.php', {'app_id': 'demo', 'workspace': 'winter', 'transcript': 'More'})[0], 409)
        self.assertEqual(self.request('submit.php', {'app_id': 'demo', 'workspace': 'main', 'transcript': 'Different'})[0], 202)

    def test_fork_derives_slug_and_rejects_duplicates(self):
        code, data = self.request('fork.php', {'app_id': 'demo', 'name': 'Winter Look 2026', 'source': None, 'author': 'Tom'})
        self.assertEqual(code, 202)
        self.assertEqual(data['workspace'], 'winter-look-2026')
        queued = json.loads((self.root / 'jobs' / (data['job_id'] + '.json')).read_text())
        self.assertEqual((queued['action'], queued['workspace'], queued['source'], queued['name'], queued['author']),
                         ('fork', 'winter-look-2026', None, 'Winter Look 2026', 'Tom'))
        self.assertEqual(self.request('fork.php', {'app_id': 'demo', 'name': 'Winter Look 2026'})[0], 409)
        self.assertEqual(self.request('fork.php', {'app_id': 'demo', 'name': 'main'})[0], 409)
        self.assertEqual(self.request('fork.php', {'app_id': 'demo', 'name': '!!!'})[0], 400)
        self.assertEqual(self.request('fork.php', {'app_id': 'demo', 'name': 'From unknown', 'source': 'nope'})[0], 404)
        self.assertEqual(self.request('fork.php', {'app_id': 'demo', 'name': 'Ok', 'author': 'x' * 61})[0], 400)
        self.init_clone()
        code, data = self.request('fork.php', {'app_id': 'demo', 'name': 'Dark', 'source': 'main'})
        self.assertEqual(code, 202)
        self.assertEqual(json.loads((self.root / 'jobs' / (data['job_id'] + '.json')).read_text())['source'], 'main')
        pending = self.request('workspaces.php?app_id=demo')[1]['pending_forks']
        self.assertEqual(sorted(f['workspace'] for f in pending), ['dark', 'winter-look-2026'])

    def test_delete_and_rename_guard_public_and_parents(self):
        self.assertEqual(self.request('delete_workspace.php', {'app_id': 'demo', 'workspace': 'main'})[0], 409)
        self.registry({'child': {'slug': 'child', 'name': 'Child', 'parent': 'main', 'fork_commit': None},
                       'grandchild': {'slug': 'grandchild', 'name': 'Grandchild', 'parent': 'child', 'fork_commit': None}})
        self.assertEqual(self.request('delete_workspace.php', {'app_id': 'demo', 'workspace': 'child'})[0], 409)
        code, data = self.request('delete_workspace.php', {'app_id': 'demo', 'workspace': 'grandchild'})
        self.assertEqual(code, 202)
        self.assertEqual(json.loads((self.root / 'jobs' / (data['job_id'] + '.json')).read_text())['action'], 'delete')
        code, data = self.request('rename_workspace.php', {'app_id': 'demo', 'workspace': 'child', 'name': 'Child 2'})
        self.assertEqual(code, 202)
        self.assertEqual(json.loads((self.root / 'jobs' / (data['job_id'] + '.json')).read_text())['name'], 'Child 2')
        self.assertEqual(self.request('rename_workspace.php', {'app_id': 'demo', 'workspace': 'child', 'name': ''})[0], 400)

    def test_author_is_sanitised_and_stored(self):
        code, data = self.request('submit.php', {'app_id': 'demo', 'workspace': 'main', 'transcript': 'Blue', 'author': ' Maria <admin> '})
        self.assertEqual(code, 202)
        queued = json.loads((self.root / 'jobs' / (data['job_id'] + '.json')).read_text())
        self.assertEqual(queued['author'], 'Maria admin')
        self.assertEqual(self.request('status.php?job_id=' + data['job_id'])[1]['status']['author'], 'Maria admin')

    def test_promote_targets_parent_or_public_and_guards(self):
        self.assertEqual(self.request('promote.php', {'app_id': 'demo', 'workspace': 'main'})[0], 409)
        self.registry({'child': {'slug': 'child', 'name': 'Child', 'parent': 'main', 'fork_commit': None},
                       'grandchild': {'slug': 'grandchild', 'name': 'Grandchild', 'parent': 'child', 'fork_commit': None},
                       'orphan': {'slug': 'orphan', 'name': 'Orphan', 'parent': 'gone', 'fork_commit': None}})
        code, data = self.request('promote.php', {'app_id': 'demo', 'workspace': 'grandchild', 'author': 'Tom'})
        self.assertEqual(code, 202, data)
        queued = json.loads((self.root / 'jobs' / (data['job_id'] + '.json')).read_text())
        self.assertEqual((queued['action'], queued['workspace'], queued['source'], queued['author']), ('promote', 'child', 'grandchild', 'Tom'))
        # The target variant is busy now, so promoting it further must wait.
        self.assertEqual(self.request('promote.php', {'app_id': 'demo', 'workspace': 'child'})[0], 409)
        code, data = self.request('promote.php', {'app_id': 'demo', 'workspace': 'orphan'})
        self.assertEqual(code, 202)
        self.assertEqual(json.loads((self.root / 'jobs' / (data['job_id'] + '.json')).read_text())['workspace'], 'main')
        self.assertEqual(self.request('promote.php', {'app_id': 'demo', 'workspace': 'nope'})[0], 404)

    def test_apps_config_read_write_and_inspect(self):
        code, data = self.request('apps.php')
        self.assertEqual(code, 200)
        self.assertEqual([a['id'] for a in data['apps']], ['demo'])
        self.assertFalse(data['daemon_running'])
        self.assertTrue(data['config_writable'])
        base = Path(tempfile.mkdtemp(prefix='sayandshape-app-'))
        self.addCleanup(shutil.rmtree, base, True)
        (base / 'index.php').write_text('<?php')
        (base / 'media').mkdir()
        (base / 'media/a.bin').write_bytes(b'0' * 1024)
        code, data = self.request('inspect_dir.php', {'path': str(base)})
        self.assertEqual(code, 200, data)
        self.assertEqual((data['index'], data['files'], data['dirs'][0]['name'], data['dirs'][0]['bytes']), ('index.php', 2, 'media', 1024))
        self.assertIn('media', data['suggested_shared'])
        self.assertEqual(self.request('inspect_dir.php', {'path': 'relative'})[0], 400)
        self.assertEqual(self.request('inspect_dir.php', {'path': str(base / 'missing')})[0], 404)
        code, data = self.request('apps.php', {'id': 'blog', 'name': 'Neighbourhood blog', 'base_dir': str(base), 'shared_dirs': ['media/', ''],
                                               'allowed_changes': 'Texts and colours', 'max_parallel_jobs': 2, 'app_url': 'https://blog.example.org/'})
        self.assertEqual(code, 200, data)
        config = json.loads((self.root / 'config/apps.json').read_text())
        self.assertEqual(config['apps']['blog']['base_dir'], str(base.resolve()))
        self.assertEqual(config['apps']['blog']['clone_dir'], str(self.root.resolve() / 'clones/blog'))
        self.assertEqual(config['apps']['blog']['shared_dirs'], ['media'])
        self.assertEqual(config['apps']['blog']['public_workspace'], 'main')
        self.assertTrue(config['apps']['blog']['auto_commit_host_changes'])
        self.assertEqual(config['max_parallel_jobs'], 2)
        self.assertEqual(config['apps']['demo']['clone_dir'], str(self.clone.parent))
        code, data = self.request('apps.php', {'id': 'blog', 'allowed_changes': 'Colours only'})
        self.assertEqual(code, 200)
        config = json.loads((self.root / 'config/apps.json').read_text())
        self.assertEqual((config['apps']['blog']['allowed_changes'], config['apps']['blog']['shared_dirs']), ('Colours only', ['media']))
        self.assertEqual(self.request('apps.php', {'id': 'Bad Id', 'base_dir': str(base)})[0], 400)
        self.assertEqual(self.request('apps.php', {'id': 'x', 'base_dir': str(base / 'missing')})[0], 400)
        self.assertEqual(self.request('apps.php', {'id': 'x', 'base_dir': str(base), 'shared_dirs': ['../etc']})[0], 400)
        self.assertEqual(self.request('apps.php', {'id': 'x', 'base_dir': str(self.root)})[0], 400)
        self.assertEqual(self.request('apps.php', {'id': 'x', 'base_dir': str(base), 'max_parallel_jobs': 99})[0], 400)
        self.assertEqual(self.request('apps.php', {'id': 'nope', 'remove': True})[0], 404)
        code, data = self.request('apps.php', {'id': 'blog', 'remove': True})
        self.assertEqual(code, 200)
        self.assertNotIn('blog', json.loads((self.root / 'config/apps.json').read_text())['apps'])

    def test_discuss_enqueues_reads_and_clears_chat(self):
        self.assertEqual(self.request('discuss.php?app_id=demo&workspace=main', client=self.anon)[0], 401)
        code, data = self.request('discuss.php?app_id=demo&workspace=main')
        self.assertEqual((code, data['messages']), (200, []))
        self.assertEqual(self.request('discuss.php', {'app_id': 'demo', 'workspace': 'main', 'message': '  '})[0], 400)
        code, data = self.request('discuss.php', {'app_id': 'demo', 'workspace': 'main', 'message': 'What can I change?', 'author': 'Maria'})
        self.assertEqual(code, 202)
        job = json.loads((self.root / 'jobs' / (data['job_id'] + '.json')).read_text())
        self.assertEqual((job['action'], job['transcript'], job['author']), ('discuss', 'What can I change?', 'Maria'))
        code, status = self.request('status.php?job_id=' + data['job_id'])
        self.assertEqual((status['status']['action'], status['status']['prompt']), ('discuss', 'What can I change?'))
        # A running question blocks clearing; afterwards the stored exchange is returned and can be removed.
        self.assertEqual(self.request('discuss.php', {'app_id': 'demo', 'workspace': 'main', 'clear': True})[0], 409)
        (self.root / 'jobs' / (data['job_id'] + '.status.json')).write_text(json.dumps({'job_id': data['job_id'], 'status': 'done'}))
        chat = self.root / 'jobs/.chat-demo-main.json'
        chat.write_text(json.dumps({'version': 1, 'messages': [{'role': 'user', 'text': 'Hello'}, {'role': 'assistant', 'result': {'summary': 'Hi'}}]}))
        code, data = self.request('discuss.php?app_id=demo&workspace=main')
        self.assertEqual([m['role'] for m in data['messages']], ['user', 'assistant'])
        code, data = self.request('discuss.php', {'app_id': 'demo', 'workspace': 'main', 'clear': True})
        self.assertEqual((code, data['messages'], chat.exists()), (200, [], False))

    def test_messages_follow_configured_language(self):
        base = Path(tempfile.mkdtemp(prefix='sayandshape-app-'))
        self.addCleanup(shutil.rmtree, base, True)
        bad_field = {'id': 'x', 'base_dir': str(base), 'name': 5}
        # Default: English.
        self.assertEqual(self.request('status.php?app_id=demo&workspace=main', client=self.anon), (401, {'success': False, 'message': 'Not logged in'}))
        self.assertEqual(self.request('session.php', client=self.anon)[1]['language'], 'en')
        self.assertEqual(self.request('apps.php', bad_field)[1]['message'], 'Field name must be text')
        # German: messages, placeholder messages, direct JSON messages and the history reason.
        self.set_language('de')
        self.assertEqual(self.request('status.php?app_id=demo&workspace=main', client=self.anon), (401, {'success': False, 'message': 'Nicht angemeldet'}))
        self.assertEqual(self.request('session.php', client=self.anon)[1]['language'], 'de')
        code, data = self.request('session.php')
        self.assertEqual((data['logged_in'], data['language']), (True, 'de'))
        self.assertEqual(self.request('apps.php', bad_field)[1]['message'], 'Feld name muss Text sein')
        self.assertEqual(self.request('history.php?app_id=demo&workspace=main')[1]['reason'], 'Kein Änderungsverlauf vorhanden')
        self.assertEqual(self.request('submit.php', {'app_id': 'demo', 'workspace': 'main', 'transcript': 'Blue'})[0], 202)
        code, data = self.request('submit.php', {'app_id': 'demo', 'workspace': 'main', 'transcript': 'Red'})
        self.assertEqual((code, data['message']), (409, 'In dieser Variante läuft bereits ein Auftrag'))
        # Anything other than en/de means English.
        self.set_language('fr')
        self.assertEqual(self.request('status.php?app_id=demo&workspace=main', client=self.anon)[1]['message'], 'Not logged in')
        self.assertEqual(self.request('session.php', client=self.anon)[1]['language'], 'en')

    def test_agent_settings_save_language(self):
        config = lambda: json.loads((self.root / 'config/apps.json').read_text())
        self.assertEqual(self.request('agent.php', {'language': 'de'}, client=self.anon)[0], 401)
        code, data = self.request('agent.php')
        self.assertEqual((code, data['language']), (200, 'en'))
        self.assertEqual(self.request('agent.php', {'language': 'fr'}), (400, {'success': False, 'message': 'Language: only en or de'}))
        self.assertNotIn('language', config())
        code, data = self.request('agent.php', {'language': 'de'})
        self.assertEqual((code, data['language'], config()['language'], config()['agent']['engine']), (200, 'de', 'de', 'claude'))
        self.assertEqual(self.request('agent.php')[1]['language'], 'de')
        self.assertEqual(self.request('session.php')[1]['language'], 'de')
        self.assertEqual(self.request('agent.php', {'language': 'fr'}), (400, {'success': False, 'message': 'Sprache: nur en oder de'}))
        self.assertEqual(self.request('agent.php', {'language': 'en', 'engine': 'nope'})[1]['message'], 'KI: nur claude oder codex')
        self.assertEqual(config()['language'], 'de')
        # Saved together with the agent fields, as the setup page does.
        code, data = self.request('agent.php', {'language': 'en', 'engine': 'codex', 'effort': 'high', 'codex_model': 'gpt-6-sol'})
        self.assertEqual((code, data['language'], data['agent']['engine']), (200, 'en', 'codex'))
        self.assertEqual((config()['language'], config()['agent']['codex_model'], config()['apps']['demo']['clone_dir']),
                         ('en', 'gpt-6-sol', str(self.clone.parent)))

    def test_login_and_setup_pages_follow_language(self):
        status, html = self.page('/login/', self.anon)
        self.assertEqual(status, 200)
        for text in ('<html lang="en">', 'SayAndShape · Login</title>', '>Password</label>', '>Log in</button>'):
            self.assertIn(text, html)
        status, html = self.page('/setup/')
        self.assertEqual(status, 200)
        for text in ('<html lang="en">', '<h2>Settings</h2>', '>Language</label>', '<option value="en" selected>English</option>',
                     '<option value="de">Deutsch</option>', '<h3>AI agent</h3>', '>Effort</label>', '+ Add project', '"Saved.":"Saved."'):
            self.assertIn(text, html)
        self.set_language('de')
        status, html = self.page('/login/', self.anon)
        for text in ('<html lang="de">', 'SayAndShape · Anmeldung</title>', '>Passwort</label>', '>Anmelden</button>'):
            self.assertIn(text, html)
        self.assertNotIn('Log in', html)
        status, html = self.page('/login/', self.anon, b'password=wrong')
        self.assertEqual(status, 401)
        self.assertIn('Passwort nicht korrekt.', html)
        status, html = self.page('/login/')
        for text in ('Du bist angemeldet.', '>Einrichtung</a>', '>Abmelden</button>'):
            self.assertIn(text, html)
        self.assertIn('>Anmelden</a>', self.page('/setup/', self.anon)[1])
        status, html = self.page('/setup/')
        self.assertEqual(status, 200)
        for text in ('<html lang="de">', 'SayAndShape · Einrichtung</title>', '<h2>Einstellungen</h2>', '>Sprache</label>',
                     '<option value="de" selected>Deutsch</option>', '<h3>KI-Agent</h3>', '>Denkaufwand</label>', '>Speichern</button>',
                     '+ Projekt hinzufügen', 'Muster wie <code>config/*.php</code> sind erlaubt.', '"Saved.":"Gespeichert."',
                     '"{n} variants":"{n} Varianten"', 'const LANGUAGE = "de";'):
            self.assertIn(text, html)
        self.assertNotIn('Add project', html.split('<script>')[0])

if __name__ == '__main__': unittest.main(verbosity=2)
