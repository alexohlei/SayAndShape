"""Installation path end to end: bin/sayandshape wires a project, the shipped router serves it, both logins work.
Uses a temporary copy of the engine, temporary projects and local PHP test servers; no model calls."""
import http.cookiejar
import json
import os
from pathlib import Path
import pty
import select
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


# Stand-in for the claude and codex CLIs: answers the version and login-status questions, records any other call.
FAKE_AGENT = '''#!%s
import json, os, sys
from pathlib import Path
here, name, args = Path(__file__).parent, Path(__file__).name, sys.argv[1:]
logged_out = (here / (name + '.logged-out')).exists()
if args == ['--version']:
    print(name, '9.8.7')
elif args == ['auth', 'status']:
    print(json.dumps({'loggedIn': not logged_out}))
    sys.exit(1 if logged_out else 0)
elif args == ['login', 'status']:
    print('Not logged in' if logged_out else 'Logged in using ChatGPT')
    sys.exit(1 if logged_out else 0)
else:
    keys = {k: v for k, v in os.environ.items() if k in ('ANTHROPIC_API_KEY', 'CODEX_API_KEY')}
    (here / (name + '.call')).write_text(json.dumps({'args': args, 'keys': keys}))
    print('OK')
''' % sys.executable


def fake_agents(folder, *names):
    folder.mkdir()
    for name in names:
        (folder / name).write_text(FAKE_AGENT)
        (folder / name).chmod(0o755)
    return folder


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def git(repo, *args):
    subprocess.check_call(['git', '-C', str(repo), '-c', 'user.email=t@local', '-c', 'user.name=T', *args],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sayandshape-install-tests-')
        self.addCleanup(self.tmp.cleanup)
        tmp = Path(self.tmp.name).resolve()
        self.engine = tmp / 'engine'
        for name in ('api', 'bin', 'login', 'router', 'setup', 'widget'):
            shutil.copytree(ROOT / name, self.engine / name)
        shutil.copytree(ROOT / 'orchestrator', self.engine / 'orchestrator', ignore=shutil.ignore_patterns('__pycache__', 'tests'))
        shutil.copy(ROOT / 'VERSION', self.engine / 'VERSION')
        (tmp / 'sessions').mkdir()
        self.sessions = tmp / 'sessions'
        self.site = tmp / 'site'
        for folder in ('css', 'inc', 'media', 'docs'):
            (self.site / folder).mkdir(parents=True)
        (self.site / 'index.html').write_text('<html><body><h1>Original</h1></body></html>')
        (self.site / 'css/site.css').write_text('body { color: black; }')
        (self.site / 'docs/index.html').write_text('<html><body>Docs</body></html>')
        (self.site / 'media/clip.bin').write_bytes(b'0123456789')
        (self.site / '.env').write_text('SECRET=1')
        (self.site / 'inc/part.php').write_text('<?php echo "part-original";')
        (self.site / 'page.php').write_text('<?php include "inc/part.php"; ?><html><body><p>page</p></body></html>')
        (self.site / 'data.php').write_text('<?php header("Content-Type: application/json"); echo json_encode(["html" => "</body>"]);')
        self.agents = fake_agents(tmp / 'agents', 'claude', 'codex')
        self.cli('init')
        self.servers = []
        self.addCleanup(self.stop)

    def stop(self):
        for server in self.servers:
            server.terminate()
            server.wait(timeout=5)

    def env(self, path=None):
        clean = {k: v for k, v in os.environ.items() if k not in ('ANTHROPIC_API_KEY', 'CODEX_API_KEY')}
        return dict(clean, PATH=path or str(self.agents) + os.pathsep + os.environ['PATH'])

    def cli(self, *args, stdin=None, ok=True, path=None):
        result = subprocess.run([sys.executable, str(self.engine / 'bin/sayandshape'), *args], input=stdin, capture_output=True,
                                text=True, env=self.env(path))
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def config(self):
        return json.loads((self.engine / 'config/apps.json').read_text())

    def serve(self, base):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        self.servers.append(subprocess.Popen(
            ['php', '-d', f'session.save_path={self.sessions}', '-S', f'127.0.0.1:{port}', '-t', str(base), str(base / 'sayandshape-router.php')],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        url = f'http://127.0.0.1:{port}'
        for _ in range(100):
            try:
                urllib.request.urlopen(url + '/sayandshape/api/session.php', timeout=1).close()
                break
            except urllib.error.HTTPError:
                break
            except OSError:
                time.sleep(.02)
        return url

    def client(self):
        return urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def get(self, url, client=None, headers=None, data=None):
        request = urllib.request.Request(url, data=data, headers=headers or {})
        try:
            response = (client or self.client()).open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read(), response.headers

    def variant(self, app_id, slug, files):
        """A variant as the worker would create it: a copy of the app without shared directories, as a Git repository."""
        repo = self.engine / 'clones' / app_id / slug
        shutil.copytree(self.site, repo, ignore=shutil.ignore_patterns('media', 'sayandshape-router.php'))
        for name, text in files.items():
            (repo / name).write_text(text)
        git(repo, 'init', '-q')
        git(repo, 'add', '-A')
        git(repo, 'commit', '-qm', 'initial clone')
        return repo

    def test_language_is_english_until_switched_to_german(self):
        self.assertEqual(self.config()['language'], 'en')
        self.assertIn('Interface language: English (en)', self.cli('language').stdout)
        self.cli('add', str(self.site), '--server', 'php')
        url = self.serve(self.site)
        status, body, _ = self.get(url + '/sayandshape/login/')
        self.assertEqual(status, 200)
        self.assertIn(b'lang="en"', body)
        self.assertIn(b'Log in', body)

        self.assertIn('Interface language: Deutsch (de)', self.cli('language', 'de').stdout)
        self.assertEqual(self.config()['language'], 'de')
        self.assertIn('[OK] Interface language: Deutsch', self.cli('doctor', ok=False).stdout)
        status, body, _ = self.get(url + '/sayandshape/login/')
        self.assertIn(b'lang="de"', body)
        self.assertIn('Anmelden'.encode(), body)
        _, body, _ = self.get(url + '/sayandshape/api/session.php')
        self.assertEqual(json.loads(body)['language'], 'de')
        self.assertEqual(self.cli('language', 'fr', ok=False).returncode, 2)
        self.assertEqual(self.config()['language'], 'de')

    def test_add_wires_project_and_remove_cleans_up(self):
        (self.site / '.htaccess').write_text('Options -Indexes\n')
        out = self.cli('add', str(self.site), '--url', 'https://example.org/blog/', '--allowed', 'Colors only').stdout
        self.assertIn('Project "site" created', out)
        app = self.config()['apps']['site']
        self.assertEqual((app['base_dir'], app['clone_dir'], app['app_url']),
                         (str(self.site), str(self.engine / 'clones/site'), 'https://example.org/blog'))
        self.assertEqual((app['serve'], app['server'], app['auth'], app['shared_dirs'], app['allowed_changes']),
                         ('root', 'apache', {'mode': 'engine'}, ['media'], 'Colors only'))
        self.assertIn('sayandshape-router.php', app['extra_blocked_files'])
        stub = (self.site / 'sayandshape-router.php').read_text()
        self.assertIn("const SAYANDSHAPE_APP_ID = \"site\";", stub)
        self.assertIn(json.dumps(str(self.engine)), stub)
        self.assertEqual(subprocess.run(['php', '-l', str(self.site / 'sayandshape-router.php')], capture_output=True).returncode, 0)
        htaccess = (self.site / '.htaccess').read_text()
        self.assertTrue(htaccess.startswith('# BEGIN SayAndShape'))
        self.assertIn('RewriteBase /blog/', htaccess)
        self.assertIn('RewriteRule ^ sayandshape-router.php [L]', htaccess)
        self.assertTrue(htaccess.endswith('Options -Indexes\n'))
        # Running it again changes settings in place and never duplicates the block.
        self.cli('add', str(self.site), '--serve', 'prefix', '--shared', 'media,docs/')
        app = self.config()['apps']['site']
        self.assertEqual((app['serve'], app['shared_dirs'], app['allowed_changes']), ('prefix', ['media', 'docs'], 'Colors only'))
        htaccess = (self.site / '.htaccess').read_text()
        self.assertEqual(htaccess.count('# BEGIN SayAndShape'), 1)
        self.assertIn('RewriteRule ^(w|sayandshape)(/.*)?$ sayandshape-router.php [L,QSA]', htaccess)
        self.assertIn('site\t', self.cli('list').stdout)
        self.assertEqual(self.cli('doctor', ok=False).stdout.count('[FAIL] .htaccess'), 0)
        self.cli('remove', 'site')
        self.assertNotIn('site', self.config()['apps'])
        self.assertFalse((self.site / 'sayandshape-router.php').exists())
        self.assertEqual((self.site / '.htaccess').read_text(), 'Options -Indexes\n')

    def test_add_rejects_bad_targets_and_keeps_foreign_router(self):
        self.assertEqual(self.cli('add', str(self.engine / 'api'), ok=False).returncode, 2)
        self.assertEqual(self.cli('add', str(self.site / 'missing'), ok=False).returncode, 2)
        (self.site / 'sayandshape-router.php').write_text('<?php // own router')
        self.assertEqual(self.cli('add', str(self.site), ok=False).returncode, 2)
        self.assertNotIn('site', self.config()['apps'])
        self.cli('add', str(self.site), '--force', '--server', 'nginx')
        self.assertEqual((self.site / 'sayandshape-router.php.bak').read_text(), '<?php // own router')
        nginx = (self.engine / 'config/nginx-site.conf').read_text()
        self.assertIn(f'fastcgi_param SCRIPT_FILENAME {self.site}/sayandshape-router.php;', nginx)
        self.assertIn('location ^~ / {', nginx)
        self.assertFalse((self.site / '.htaccess').exists())

    def test_root_mode_serves_public_variant_and_protects_internals(self):
        self.cli('add', str(self.site), '--server', 'php')
        url = self.serve(self.site)
        # Before the first job the app itself is shown; visitors get no panel and no session cookie.
        status, body, headers = self.get(url + '/')
        self.assertEqual((status, body), (200, b'<html><body><h1>Original</h1></body></html>'))
        self.assertIsNone(headers.get('Set-Cookie'))
        status, body, headers = self.get(url + '/sayandshape/api/session.php')
        self.assertEqual((status, json.loads(body)['logged_in'], headers.get('Set-Cookie')), (200, False, None))
        status, body, _ = self.get(url + '/', headers={'Cookie': 'sayandshape_ui=1'})
        self.assertIn(b'<script src="/sayandshape/widget/sayandshape-widget.js" data-app="site" data-workspace="main"></script>\n</body>', body)
        for path in ('/.env', '/.git/config', '/sayandshape-router.php', '/w/main/.env', '/sayandshape/api/auth.php', '/sayandshape/widget/.x', '/w/nope/'):
            self.assertEqual(self.get(url + path)[0], 404, path)
        self.assertEqual(self.get(url + '/%2e%2e/engine/config/apps.json')[0], 400)
        status, _, headers = self.get(url + '/docs')
        self.assertEqual((status, headers['Location']), (301, '/docs/'))
        self.assertEqual(self.get(url + '/docs/')[1], b'<html><body>Docs</body></html>')
        self.assertEqual(self.get(url + '/sayandshape/widget/sayandshape-widget.js')[0], 200)

        self.variant('site', 'main', {'index.html': '<html><body><h1>Public</h1></body></html>'})
        winter = self.variant('site', 'winter', {'index.html': '<html><body><h1>Winter</h1></body></html>',
                                                 'css/site.css': 'body { color: white; }', 'inc/part.php': '<?php echo "part-winter";'})
        self.assertIn(b'Public', self.get(url + '/')[1])
        self.assertIn(b'Public', self.get(url + '/w/main/')[1])
        self.assertIn(b'Winter', self.get(url + '/w/winter/')[1])
        self.assertEqual(self.get(url + '/w/winter')[2]['Location'], '/w/winter/')
        self.assertEqual(self.get(url + '/w/winter/.git/config')[0], 404)
        # Shared directories are not part of a variant and come from the app; a file added in the variant wins.
        self.assertEqual(self.get(url + '/media/clip.bin')[1], b'0123456789')
        self.assertEqual(self.get(url + '/w/winter/media/clip.bin')[1], b'0123456789')
        (winter / 'media').mkdir()
        (winter / 'media/clip.bin').write_bytes(b'winter')
        self.assertEqual(self.get(url + '/w/winter/media/clip.bin')[1], b'winter')
        # Root-absolute references from inside another variant stay in that variant.
        status, _, headers = self.get(url + '/css/site.css?v=2', headers={'Referer': url + '/w/winter/index.html'})
        self.assertEqual((status, headers['Location']), (307, '/w/winter/css/site.css?v=2'))
        self.assertEqual(self.get(url + '/css/site.css', headers={'Referer': url + '/w/main/'})[1], b'body { color: black; }')
        self.assertEqual(self.get(url + '/css/site.css', headers={'Referer': 'http://elsewhere.example/w/winter/'})[0], 200)
        # PHP pages run inside their variant: relative includes resolve there, HTML gets the panel, JSON does not.
        self.assertTrue(self.get(url + '/page.php')[1].startswith(b'part-original'))
        status, body, _ = self.get(url + '/w/winter/page.php', headers={'Cookie': 'sayandshape_ui=1'})
        self.assertTrue(body.startswith(b'part-winter'))
        self.assertIn(b'data-app="site" data-workspace="winter"></script>', body)
        self.assertEqual(json.loads(self.get(url + '/data.php', headers={'Cookie': 'sayandshape_ui=1'})[1]), {'html': '</body>'})
        # Ranges and revalidation for media.
        status, body, headers = self.get(url + '/media/clip.bin', headers={'Range': 'bytes=2-5'})
        self.assertEqual((status, body, headers['Content-Range']), (206, b'2345', 'bytes 2-5/10'))
        self.assertEqual(self.get(url + '/media/clip.bin', headers={'Range': 'bytes=-3'})[1], b'789')
        etag = self.get(url + '/media/clip.bin')[2]['ETag']
        self.assertEqual(self.get(url + '/media/clip.bin', headers={'If-None-Match': etag})[0], 304)
        self.assertEqual(self.cli('check', 'site', '--url', url).returncode, 0)

    def test_prefix_mode_keeps_the_app_at_its_address(self):
        self.cli('add', str(self.site), '--server', 'php', '--serve', 'prefix')
        url = self.serve(self.site)
        status, _, headers = self.get(url + '/')
        self.assertEqual((status, headers['Location']), (302, '/w/main/'))
        self.assertIn(b'Original', self.get(url + '/w/main/')[1])
        self.assertIn(b'Original', self.get(url + '/index.html')[1])        # served by the web server itself
        self.variant('site', 'main', {'index.html': '<html><body><h1>Public</h1></body></html>'})
        self.assertIn(b'Public', self.get(url + '/w/main/')[1])
        self.assertIn(b'Original', self.get(url + '/index.html')[1])
        self.assertEqual(self.get(url + '/sayandshape-router.php')[0], 404)
        self.assertEqual(self.cli('check', 'site', '--url', url).returncode, 0)

    def test_engine_login_gates_api_and_setup(self):
        self.cli('add', str(self.site), '--server', 'php')
        url = self.serve(self.site)
        form = {'Content-Type': 'application/x-www-form-urlencoded'}
        client = self.client()
        status, body, _ = self.get(url + '/sayandshape/login/', client)
        self.assertEqual(status, 200)
        self.assertIn('bin/sayandshape passwd'.encode(), body)
        self.assertEqual(self.get(url + '/sayandshape/login/', client, form, b'password=whatever')[0], 401)
        self.assertEqual(self.cli('passwd', '--stdin', stdin='short\n', ok=False).returncode, 2)
        self.cli('passwd', '--stdin', stdin='correct horse\n')
        self.assertNotIn('correct horse', (self.engine / 'config/auth.json').read_text())
        self.assertEqual(self.get(url + '/sayandshape/login/', client, form, b'password=wrong')[0], 401)
        self.assertFalse(json.loads(self.get(url + '/sayandshape/api/session.php', client)[1])['logged_in'])
        self.assertEqual(self.get(url + '/sayandshape/api/workspaces.php?app_id=site', client)[0], 401)
        self.assertIn('Log in'.encode(), self.get(url + '/sayandshape/setup/', client)[1])
        cross = dict(form, Origin='https://evil.example')
        self.assertEqual(self.get(url + '/sayandshape/login/', client, cross, b'password=correct+horse')[0], 403)
        status, _, headers = self.get(url + '/sayandshape/login/', client, form, b'password=correct+horse')
        self.assertEqual((status, headers['Location']), (303, '/'))
        session = json.loads(self.get(url + '/sayandshape/api/session.php', client)[1])
        self.assertEqual((session['logged_in'], session['user_id'], session['engine_admin']), (True, 1, True))
        self.assertIn(b'sayandshape-widget.js', self.get(url + '/', client)[1])
        status, body, _ = self.get(url + '/sayandshape/api/workspaces.php?app_id=site', client)
        self.assertEqual((status, json.loads(body)['public']), (200, 'main'))
        self.assertEqual([app['id'] for app in json.loads(self.get(url + '/sayandshape/api/apps.php', client)[1])['apps']], ['site'])
        self.assertIn('Add project'.encode(), self.get(url + '/sayandshape/setup/', client)[1])
        body = json.dumps({'app_id': 'site', 'workspace': 'main', 'transcript': 'Blue'}).encode()
        self.assertEqual(self.get(url + '/sayandshape/api/submit.php', client, {'Content-Type': 'application/json'}, body)[0], 202)
        self.assertEqual(self.get(url + '/sayandshape/api/submit.php', client, {'Content-Type': 'application/json', 'Origin': 'https://evil.example'}, body)[0], 403)
        # Logging out ends the session and stops the panel from being added.
        self.assertEqual(self.get(url + '/sayandshape/login/', client, form, b'logout=1')[0], 303)
        self.assertFalse(json.loads(self.get(url + '/sayandshape/api/session.php', client)[1])['logged_in'])
        self.assertNotIn(b'sayandshape-widget.js', self.get(url + '/', client)[1])
        # Repeated wrong passwords lock the address out for a while, even with the right one.
        for _ in range(8):
            self.get(url + '/sayandshape/login/', client, form, b'password=wrong')
        self.assertEqual(self.get(url + '/sayandshape/login/', client, form, b'password=correct+horse')[0], 401)

    def test_host_session_is_confined_to_its_project(self):
        self.cli('add', str(self.site), '--server', 'php')
        other = Path(self.tmp.name).resolve() / 'shop'
        other.mkdir()
        (other / 'index.php').write_text('<html><body>Shop</body></html>')
        (other / 'admin.php').write_text('<?php session_name("SHOPSESS"); session_start(); $_SESSION["is_admin"] = true; $_SESSION["user_id"] = 7; echo "ok";')
        self.cli('add', str(other), '--server', 'php', '--auth', 'host', '--session-name', 'SHOPSESS', '--session-key', 'is_admin')
        self.assertEqual(self.config()['apps']['shop']['auth'], {'mode': 'host', 'session_name': 'SHOPSESS', 'session_key': 'is_admin'})
        url = self.serve(other)
        client = self.client()
        # With the app's own login every page carries the panel; it stays invisible until the session says admin.
        self.assertIn(b'data-app="shop"', self.get(url + '/', client)[1])
        self.assertFalse(json.loads(self.get(url + '/sayandshape/api/session.php', client)[1])['logged_in'])
        self.assertEqual(self.get(url + '/admin.php', client)[1], b'ok')
        session = json.loads(self.get(url + '/sayandshape/api/session.php', client)[1])
        self.assertEqual((session['logged_in'], session['user_id'], session['engine_admin']), (True, 7, False))
        self.assertEqual(self.get(url + '/sayandshape/api/workspaces.php?app_id=shop', client)[0], 200)
        self.assertEqual(self.get(url + '/sayandshape/api/workspaces.php?app_id=site', client)[0], 403)
        self.assertEqual(self.get(url + '/sayandshape/api/apps.php', client)[0], 403)
        body = json.dumps({'path': str(self.site)}).encode()
        self.assertEqual(self.get(url + '/sayandshape/api/inspect_dir.php', client, {'Content-Type': 'application/json'}, body)[0], 403)
        self.assertIn('Log in'.encode(), self.get(url + '/sayandshape/setup/', client)[1])
        # The engine login also works here and lifts the restriction.
        self.cli('passwd', '--stdin', stdin='correct horse\n')
        admin = self.client()
        self.get(url + '/sayandshape/login/', admin, {'Content-Type': 'application/x-www-form-urlencoded'}, b'password=correct+horse')
        self.assertEqual(self.get(url + '/sayandshape/api/workspaces.php?app_id=site', admin)[0], 200)
        # --engine-admin lets the app's admins open the setup as well.
        self.cli('add', str(other), '--engine-admin')
        self.assertEqual(self.get(url + '/sayandshape/api/apps.php', client)[0], 200)

    def terminal(self, *args, answers):
        """Run the CLI on a pseudo-terminal and type each answer once its prompt has appeared; returns the screen text."""
        master, slave = pty.openpty()
        proc = subprocess.Popen([sys.executable, str(self.engine / 'bin/sayandshape'), *args], stdin=slave, stdout=slave, stderr=slave,
                                env=self.env(), start_new_session=True)
        os.close(slave)
        self.addCleanup(os.close, master)
        self.addCleanup(proc.kill)
        screen, seen = '', 0
        def read():
            nonlocal screen
            if not select.select([master], [], [], 10)[0]:
                self.fail('no more output:\n' + screen)
            try:
                data = os.read(master, 4096)
            except OSError:
                data = b''
            screen += data.decode(errors='replace')
            return bool(data)
        for prompt, answer in answers:
            while prompt not in screen[seen:]:
                if not read():
                    self.fail(f'Prompt "{prompt}" did not appear:\n' + screen)
            seen = len(screen)
            os.write(master, (answer + '\n').encode())
        while proc.poll() is None or select.select([master], [], [], 0)[0]:
            if not read():
                break
        self.assertEqual(proc.wait(timeout=10), 0, screen)
        return screen

    def test_init_takes_the_agent_that_is_installed(self):
        config = self.engine / 'config/apps.json'
        self.assertEqual(self.config()['agent']['engine'], 'claude')
        config.unlink()
        only_codex = str(fake_agents(Path(self.tmp.name) / 'only-codex', 'codex'))
        out = self.cli('init', path=only_codex).stdout
        self.assertIn('claude: not installed', out)
        self.assertIn('codex 9.8.7', out)
        self.assertIn('Using: codex', out)
        self.assertEqual(self.config()['agent']['engine'], 'codex')
        # A later init reports the agents but never changes the choice.
        self.assertIn('Using: codex', self.cli('init').stdout)
        self.assertEqual(self.config()['agent']['engine'], 'codex')
        # Without any agent the installation still completes and says how to get one.
        config.unlink()
        nothing = str(fake_agents(Path(self.tmp.name) / 'none'))
        self.assertIn('Warning: claude is not installed', self.cli('init', path=nothing).stdout)
        self.assertIn('[FAIL] AI agent "claude" not in PATH', self.cli('doctor', ok=False, path=nothing).stdout)

    def test_agent_command_stores_the_key_privately_and_doctor_reports_it(self):
        key = 'sk-test-0123456789abcdef'
        keys = self.engine / '.agent-keys.json'
        out = self.cli('agent').stdout      # not a terminal: reports, asks nothing, changes nothing
        self.assertIn('claude 9.8.7', out)
        self.assertIn("Using: claude (claude-opus-5-5), the CLI's own sign-in", out)
        self.assertIn('[OK] AI agent "claude" found', self.cli('doctor', ok=False).stdout)

        out = self.cli('agent', '--engine', 'codex', '--api-key-stdin', stdin=key + '\n').stdout
        self.assertNotIn(key, out)
        self.assertEqual(json.loads(keys.read_text()), {'codex': key})
        self.assertEqual(keys.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.config()['agent']['engine'], 'codex')
        self.assertIn('API key stored', self.cli('doctor', ok=False).stdout)
        self.assertNotIn(key, self.cli('doctor', ok=False).stdout)

        # The test call hands the key to the agent it belongs to.
        self.assertIn('codex answers', self.cli('agent', '--test').stdout)
        call = json.loads((self.agents / 'codex.call').read_text())
        self.assertEqual(call['keys'], {'CODEX_API_KEY': key})
        self.assertEqual(call['args'][0], 'exec')

        self.assertEqual(self.cli('agent', '--api-key-stdin', stdin='too short\n', ok=False).returncode, 2)
        self.assertEqual(self.cli('agent', '--api-key-stdin', '--login', ok=False).returncode, 2)
        self.assertEqual(json.loads(keys.read_text()), {'codex': key})
        self.cli('agent', '--login')
        self.assertFalse(keys.exists())
        (self.agents / 'codex.logged-out').touch()
        self.assertIn('Warning: codex is not signed in', self.cli('agent').stdout)
        self.assertIn('[WARN] AI agent "codex"', self.cli('doctor', ok=False).stdout)

    def test_agent_question_in_a_terminal(self):
        key = 'sk-ant-test-0123456789abcdef'
        (self.agents / 'codex.logged-out').touch()
        screen = self.terminal('agent', answers=[('Choice [1]', '2'), ('Choice [2]', '1')])
        self.assertIn('Which agent should carry out the changes?', screen)
        self.assertIn('codex 9.8.7', screen)
        self.assertEqual(self.config()['agent']['engine'], 'codex')
        self.assertFalse((self.engine / '.agent-keys.json').exists())
        # Back to claude with an API key; the typed key is not echoed.
        screen = self.terminal('agent', answers=[('Choice [2]', '1'), ('Choice [1]', '2'), ('API key', key)])
        self.assertNotIn(key, screen)
        self.assertEqual(self.config()['agent']['engine'], 'claude')
        self.assertEqual(json.loads((self.engine / '.agent-keys.json').read_text()), {'claude': key})
        # A fresh installation asks the same questions during init; Enter accepts the suggestions.
        (self.engine / 'config/apps.json').unlink()
        screen = self.terminal('init', answers=[('Choice [1]', ''), ('Choice [2]', ''), ('API key', '')])
        self.assertIn('ready in', screen)
        self.assertEqual(self.config()['agent']['engine'], 'claude')
        self.assertEqual(json.loads((self.engine / '.agent-keys.json').read_text()), {'claude': key})

    def test_service_and_daemon_commands(self):
        unit = self.cli('service', '--user', 'www-data').stdout
        self.assertIn(str(self.engine / 'orchestrator/worker.py'), unit)
        self.assertEqual(self.cli('daemon', 'status', ok=False).returncode, 1)
        self.cli('daemon', 'start')
        self.addCleanup(self.cli, 'daemon', 'stop', ok=False)
        self.assertEqual(self.cli('daemon', 'status').returncode, 0)
        self.assertIn('already running', self.cli('daemon', 'start').stdout)
        self.cli('daemon', 'stop')
        self.assertEqual(self.cli('daemon', 'status', ok=False).returncode, 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
