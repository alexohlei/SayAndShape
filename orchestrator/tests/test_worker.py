import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import worker
from safety.diff_review import Blocked, review

class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sayandshape-tests-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.engine = self.root / 'engine'
        self.engine.mkdir()
        shutil.copytree(ROOT, self.engine / 'orchestrator', ignore=shutil.ignore_patterns('__pycache__'))
        (self.engine / 'config').mkdir()
        self.clone = self.root / 'clones/main'
        self.clone.mkdir(parents=True)
        worker.git(self.clone, 'init', '-q')
        worker.git(self.clone, 'config', 'user.email', 'test@local')
        worker.git(self.clone, 'config', 'user.name', 'Test')
        (self.clone / 'style.css').write_text('body{color:red}\n')
        (self.clone / 'admin').mkdir()
        (self.clone / 'admin/auth.php').write_text('<?php // protected\n')
        self.commit('initial clone')
        self.baseline = worker.git(self.clone, 'rev-parse', 'HEAD')
        self.app = {'base_dir': str(self.clone), 'clone_dir': str(self.clone.parent),
                    'max_files_per_change': 20, 'extra_blocked_files': ['admin/auth.php']}
        worker.atomic_json(self.engine / 'config/apps.json', {'apps': {'demo': self.app}})
        self.worker = worker.Worker(self.engine, self.root / 'runtime')

    def commit(self, message):
        worker.git(self.clone, 'add', '-A')
        worker.git(self.clone, 'commit', '-qm', message)
        return worker.git(self.clone, 'rev-parse', 'HEAD')

    def job(self, action='change', **fields):
        job = dict(job_id='j_test_1', user_id=1, app_id='demo', workspace='main', action=action, transcript='Make it blue')
        job.update(fields)
        path = self.worker.jobs / (job['job_id'] + '.json')
        worker.atomic_json(path, job)
        return job, path

    def status(self):
        return worker.read_json(self.worker.jobs / 'j_test_1.status.json')

    def fake_edit(self, edit):
        def run(args, job, timeout, output=None, env=None, cwd=None, **kwargs):
            where = lambda: Path(cwd) if cwd else Path(args[args.index('-C') + 1])
            if output:
                if str(output).endswith('.dependencies'):
                    space = where()
                    import rollback_policy
                    head, commits = rollback_policy.snapshot(space)
                    text = json.dumps(dict(version=1, head=head, decisions=[dict(hash=c['hash'], state='independent', dependent_commits=[], reason='Test: independent files') for c in commits if c['hash'] != head]))
                elif str(output).endswith('.answer'):
                    text = edit(where())
                    text = text if isinstance(text, str) else ''
                else:
                    text = 'OK'
                Path(output).write_text(text)
                return text
            space = where()
            edit(space)
        return patch.object(self.worker, 'run', side_effect=run)

    def test_staged_sensitive_blocked(self):
        (self.clone / '.env').write_text('PLACEHOLDER=1')
        worker.git(self.clone, 'add', '.env')
        with self.assertRaises(Blocked): review(self.clone)

    def test_binary_attribute_cannot_hide_dangerous_content(self):
        (self.clone / 'index.php').write_text('<?php // safe')
        (self.clone / '.gitattributes').write_text('*.php binary\n')
        self.commit('baseline with binary attribute')
        (self.clone / 'index.php').write_text('<?php system("echo test");')
        with self.assertRaises(Blocked): review(self.clone)

    def test_corrupt_status_recovered(self):
        self.job()
        (self.worker.jobs / 'j_test_1.status.json').write_text('{partial')
        self.worker.recover()
        self.assertEqual(self.status()['status'], 'failed')

    def test_new_php_pattern_blocked(self):
        (self.clone / 'new.php').write_text('<?php system ("echo test");')
        with self.assertRaises(Blocked): review(self.clone)

    def test_configured_file_blocked(self):
        (self.clone / 'admin/auth.php').write_text('<?php // changed')
        with self.assertRaises(Blocked): review(self.clone, blocked_files=self.app['extra_blocked_files'])

    def test_staged_limit(self):
        for i in range(21): (self.clone / f'new{i}.txt').write_text('x')
        worker.git(self.clone, 'add', '-A')
        with self.assertRaises(Blocked): review(self.clone)

    def test_symlink_blocked(self):
        (self.clone / 'escape').symlink_to(self.root)
        with self.assertRaises(Blocked): review(self.clone)

    def test_agent_commit_reviewed_against_baseline(self):
        (self.clone / 'admin/auth.php').write_text('<?php // changed')
        self.commit('agent commit')
        with self.assertRaises(Blocked): review(self.clone, blocked_files=self.app['extra_blocked_files'], baseline=self.baseline)

    def test_success_publishes_one_commit(self):
        _, path = self.job()
        def edit(space):
            (space / 'style.css').write_text('body{color:blue}\n')
            worker.git(space, 'add', '-A')
            worker.git(space, 'commit', '-qm', 'agent commit')
        with self.fake_edit(edit): self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        self.assertIn('blue', (self.clone / 'style.css').read_text())
        self.assertEqual(worker.git(self.clone, 'rev-list', '--count', 'HEAD'), '2')
        self.assertEqual(worker.git(self.clone, 'log', '-1', '--format=%B'), 'Make it blue')
        self.assertEqual(list(self.worker.runtime.iterdir()), [])

    def test_failure_discards_staged_new_and_ignored_files(self):
        _, path = self.job()
        def edit(space):
            (space / 'style.css').write_text('blue')
            (space / 'new.txt').write_text('new')
            (space / '.gitignore').write_text('ignored.txt\n')
            (space / 'ignored.txt').write_text('ignored')
            worker.git(space, 'add', '-A')
            raise RuntimeError('simulated failure')
        with self.fake_edit(edit): self.worker.process(path)
        self.assertEqual(self.status()['status'], 'failed')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), self.baseline)
        self.assertEqual(worker.git(self.clone, 'status', '--porcelain'), '')
        self.assertFalse((self.clone / 'new.txt').exists())
        self.assertFalse((self.clone / 'ignored.txt').exists())
        self.assertEqual(list(self.worker.runtime.iterdir()), [])

    def test_cancel_discards_changes(self):
        _, path = self.job()
        def edit(space):
            (space / 'new.txt').write_text('new')
            worker.git(space, 'add', '-A')
            (self.worker.jobs / 'j_test_1.cancel').write_text('{}')
        with self.fake_edit(edit): self.worker.process(path)
        self.assertEqual(self.status()['status'], 'cancelled')
        self.assertFalse((self.clone / 'new.txt').exists())

    def test_blocked_does_not_publish(self):
        _, path = self.job()
        with self.fake_edit(lambda space: (space / 'new.php').write_text('<?php system("x");')):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertFalse((self.clone / 'new.php').exists())

    def test_commit_failure_never_reports_done(self):
        _, path = self.job()
        real_git = worker.git
        def fail_commit(root, *args):
            if 'commit' in args: raise RuntimeError('commit failed')
            return real_git(root, *args)
        with self.fake_edit(lambda space: (space / 'style.css').write_text('blue')), patch.object(worker, 'git', side_effect=fail_commit):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'failed')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), self.baseline)

    def test_dirty_clone_preserved(self):
        self.app['auto_commit_host_changes'] = False
        worker.atomic_json(self.engine / 'config/apps.json', {'apps': {'demo': self.app}})
        (self.clone / 'keep.txt').write_text('manual work')
        _, path = self.job()
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'failed')
        self.assertEqual((self.clone / 'keep.txt').read_text(), 'manual work')

    def test_reset_queued(self):
        (self.clone / 'style.css').write_text('blue')
        self.commit('change')
        _, path = self.job('reset')
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), self.baseline)

    def test_rollback_restores_full_prompt(self):
        (self.clone / 'style.css').write_text('blue')
        prompt = 'Line one | color\n\nLine two'
        change = self.commit(prompt)
        _, path = self.job('rollback', commit_hash=change)
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        self.assertEqual(self.status()['original_prompt'], prompt)
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), self.baseline)

    def test_rollback_conflict_preserves_clone(self):
        (self.clone / 'style.css').write_text('blue')
        first = self.commit('first')
        (self.clone / 'style.css').write_text('green')
        head = self.commit('second')
        _, path = self.job('rollback', commit_hash=first)
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), head)
        self.assertEqual((self.clone / 'style.css').read_text(), 'green')

    def test_rollback_dependency_rejected_even_without_api(self):
        (self.clone / 'helper.php').write_text('<?php function helper() {}')
        first = self.commit('helper')
        (self.clone / 'page.php').write_text('<?php helper();')
        second = self.commit('use helper')
        job, path = self.job('rollback', commit_hash=first)
        worker.atomic_json(self.worker.policy_path(job), dict(version=1, head=second, decisions=[
            dict(hash=first, state='dependent', dependent_commits=[second], reason='Page needs helper')]))
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), second)

    def test_latest_rollback_unlocks_previous_despite_old_cache(self):
        (self.clone / 'style.css').write_text('blue')
        first = self.commit('first')
        (self.clone / 'style.css').write_text('green')
        second = self.commit('second')
        job, path = self.job('rollback', commit_hash=second)
        worker.atomic_json(self.worker.policy_path(job), dict(version=1, head=second, decisions=[]))
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        import rollback_policy
        self.assertTrue(rollback_policy.check(self.clone, self.worker.policy_path(job), first)['allowed'])
        self.assertEqual(worker.read_json(self.worker.policy_path(job))['head'], first)

    def test_stale_queued_rollback_is_blocked(self):
        (self.clone / 'style.css').write_text('blue')
        current = self.commit('change')
        _, path = self.job('rollback', commit_hash=current, expected_head=self.baseline)
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), current)

    def test_dependency_audit_failure_keeps_newest_available(self):
        (self.clone / 'first.txt').write_text('first')
        first = self.commit('first')
        job, path = self.job()
        def run(args, job, timeout, output=None, env=None, cwd=None, **kwargs):
            where = lambda: Path(cwd) if cwd else Path(args[args.index('-C') + 1])
            if output and not str(output).endswith('.answer'):
                Path(output).write_text('OK')
                return 'OK'  # Invalid JSON for audit; must fail closed.
            space = where()
            (space / 'second.txt').write_text('second')
        with patch.object(self.worker, 'run', side_effect=run):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        import rollback_policy
        entries = rollback_policy.history(self.clone, self.worker.policy_path(job))['commits']
        self.assertTrue(entries[0]['can_rollback'])
        self.assertFalse(entries[1]['can_rollback'])

    def test_audit_releases_independent_older_change(self):
        (self.clone / 'first.txt').write_text('first')
        self.commit('first')
        job, path = self.job()
        with self.fake_edit(lambda space: (space / 'second.txt').write_text('second')):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        import rollback_policy
        entries = rollback_policy.history(self.clone, self.worker.policy_path(job))['commits']
        self.assertEqual(len(entries), 2)
        self.assertTrue(all(entry['can_rollback'] for entry in entries))

    def test_audit_blocks_cross_file_dependency_then_unlocks_after_undo(self):
        (self.clone / 'helper.php').write_text('<?php function helper() {}')
        first = self.commit('helper')
        job, path = self.job()
        def run(args, job, timeout, output=None, env=None, cwd=None, **kwargs):
            where = lambda: Path(cwd) if cwd else Path(args[args.index('-C') + 1])
            space = where()
            if output and not str(output).endswith('.answer'):
                if str(output).endswith('.dependencies'):
                    head = worker.git(space, 'rev-parse', 'HEAD')
                    text = json.dumps(dict(version=1, head=head, decisions=[dict(hash=first, state='dependent', dependent_commits=[head], reason='Page uses the function')]))
                else:
                    text = 'OK'
                Path(output).write_text(text)
                return text
            (space / 'page.php').write_text('<?php helper();')
        with patch.object(self.worker, 'run', side_effect=run):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        import rollback_policy
        self.assertFalse(rollback_policy.check(self.clone, self.worker.policy_path(job), first)['allowed'])
        newest = worker.git(self.clone, 'rev-parse', 'HEAD')
        _, undo = self.job('rollback', commit_hash=newest, job_id='j_test_undo')
        self.worker.process(undo)
        self.assertTrue(rollback_policy.check(self.clone, self.worker.policy_path(job), first)['allowed'])
        self.assertFalse((self.clone / 'page.php').exists())

    def test_edit_cannot_implicitly_establish_base(self):
        import repo_state
        _, path = self.job()
        def edit(space):
            (space / 'style.css').write_text('blue')
            worker.git(space, 'add', '-A'); worker.git(space, 'commit', '-qm', 'unauthorized base')
            repo_state.establish(space, 'not_requested', '2026-09-18T12:00:00Z')
        with self.fake_edit(edit):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertIsNone(repo_state.state_ref(self.clone))
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), self.baseline)

    def test_establish_base_archives_changes_without_changing_files(self):
        import repo_state, rollback_policy
        (self.clone / 'style.css').write_text('blue')
        head = self.commit('First change')
        job, path = self.job('baseline', expected_head=head)
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), head)
        self.assertEqual((self.clone / 'style.css').read_text(), 'blue')
        data = rollback_policy.history(self.clone, self.worker.policy_path(job))
        self.assertEqual(data['commits'], [])
        self.assertEqual(data['active_count'], 0)
        self.assertEqual(len(data['archives']), 1)
        self.assertEqual(data['archives'][0]['commits'][0]['message'], 'First change')
        self.assertTrue(data['archives'][0]['created_at'])
        self.assertEqual(repo_state.read(self.clone)['base'], head)
        self.assertFalse(rollback_policy.check(self.clone, self.worker.policy_path(job), head)['allowed'])
        self.assertEqual(worker.git(self.clone, 'status', '--porcelain'), '')

    def test_reset_respects_new_base_and_keeps_archive(self):
        import repo_state, rollback_policy
        (self.clone / 'style.css').write_text('blue')
        base = self.commit('Permanent blue')
        repo_state.establish(self.clone, 'base_1', '2026-09-18T12:00:00+00:00')
        (self.clone / 'style.css').write_text('green')
        self.commit('Temporary green')
        job, path = self.job('reset')
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        self.assertEqual((self.clone / 'style.css').read_text(), 'blue')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), base)
        self.assertEqual(len(repo_state.read(self.clone)['archives']), 1)
        self.assertEqual(rollback_policy.history(self.clone, self.worker.policy_path(job))['commits'], [])

    def test_newest_after_base_can_be_undone_but_archive_cannot(self):
        import repo_state, rollback_policy
        (self.clone / 'style.css').write_text('blue')
        base = self.commit('Permanent blue')
        repo_state.establish(self.clone, 'base_1', '2026-09-18T12:00:00+00:00')
        (self.clone / 'style.css').write_text('green')
        latest = self.commit('Temporary green')
        job, path = self.job('rollback', commit_hash=latest)
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        self.assertEqual((self.clone / 'style.css').read_text(), 'blue')
        self.assertFalse(rollback_policy.check(self.clone, self.worker.policy_path(job), base)['allowed'])
        self.assertEqual(len(repo_state.read(self.clone)['archives']), 1)

    def test_repeated_base_archives_only_new_period_and_more_than_twenty(self):
        import repo_state
        for i in range(23):
            (self.clone / 'period.txt').write_text(str(i))
            self.commit('period one ' + str(i))
        head = worker.git(self.clone, 'rev-parse', 'HEAD')
        _, path = self.job('baseline', expected_head=head)
        self.worker.process(path)
        self.assertEqual(len(repo_state.read(self.clone)['archives'][0]['commits']), 23)
        (self.clone / 'period.txt').write_text('next period')
        head = self.commit('period two')
        job, path = self.job('baseline', expected_head=head, job_id='j_second_base')
        self.worker.process(path)
        archives = repo_state.read(self.clone)['archives']
        self.assertEqual(len(archives), 2)
        self.assertEqual(len(archives[0]['commits']), 1)
        self.assertEqual(archives[0]['commits'][0]['message'], 'period two')
        self.assertEqual(len(archives[1]['commits']), 23)

    def test_stale_or_empty_base_does_not_archive(self):
        import repo_state
        _, path = self.job('baseline', expected_head=self.baseline)
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'failed')
        self.assertIsNone(repo_state.state_ref(self.clone))
        (self.clone / 'style.css').write_text('blue')
        self.commit('new edit')
        _, path = self.job('baseline', expected_head=self.baseline, job_id='j_stale_base')
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_stale_base.status.json')['status'], 'blocked')
        self.assertIsNone(repo_state.state_ref(self.clone))

    def test_recovery_restores_previous_base_and_archive(self):
        import repo_state
        (self.clone / 'style.css').write_text('blue')
        first = self.commit('blue')
        repo_state.establish(self.clone, 'base_1', '2026-09-18T12:00:00+00:00')
        previous = repo_state.state_ref(self.clone)
        (self.clone / 'style.css').write_text('green')
        head = self.commit('green')
        job, path = self.job('baseline', expected_head=head)
        self.worker.status(job, 'running', phase='publishing')
        repo_state.establish(self.clone, 'base_2', '2026-09-18T13:00:00+00:00')
        worker.atomic_json(self.worker.runtime / 'j_test_1.json', dict(job=job, clone=str(self.clone), baseline=head, state_before=previous, publishing=True))
        self.worker.recover()
        self.assertEqual(self.status()['status'], 'failed')
        self.assertEqual(repo_state.state_ref(self.clone), previous)
        self.assertEqual(repo_state.read(self.clone)['base'], first)
        self.assertEqual(len(repo_state.read(self.clone)['archives']), 1)
        self.assertEqual((self.clone / 'style.css').read_text(), 'green')

    def test_first_base_recovery_removes_partial_metadata(self):
        import repo_state
        (self.clone / 'style.css').write_text('blue')
        head = self.commit('blue')
        job, path = self.job('baseline', expected_head=head)
        self.worker.status(job, 'running', phase='publishing')
        repo_state.establish(self.clone, 'interrupted', '2026-09-18T12:00:00+00:00')
        worker.atomic_json(self.worker.runtime / 'j_test_1.json', dict(job=job, clone=str(self.clone), baseline=head, state_before=None, publishing=True))
        self.worker.recover()
        self.assertIsNone(repo_state.state_ref(self.clone))
        self.assertEqual(repo_state.read(self.clone)['base'], self.baseline)

    def test_recovery_reverts_partial_publication(self):
        job, _ = self.job()
        (self.clone / 'new.txt').write_text('published')
        self.commit('interrupted')
        self.worker.status(job, 'running', phase='publishing')
        space = self.worker.runtime / job['job_id']
        space.mkdir()
        (space / 'new.txt').write_text('draft')
        worker.atomic_json(self.worker.runtime / 'j_test_1.json',
                           dict(job=job, clone=str(self.clone), baseline=self.baseline, publishing=True))
        (self.clone / '.git/index.lock').write_text('interrupted reset')
        self.worker.recover()
        self.assertEqual(self.status()['status'], 'failed')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), self.baseline)
        self.assertFalse((self.clone / 'new.txt').exists())
        self.assertFalse(space.exists())

    def test_recovery_preserves_confirmed_success(self):
        job, _ = self.job()
        (self.clone / 'style.css').write_text('blue')
        head = self.commit('published')
        self.worker.status(job, 'done')
        worker.atomic_json(self.worker.runtime / 'j_test_1.json',
                           dict(job=job, clone=str(self.clone), baseline=self.baseline, publishing=True))
        self.worker.recover()
        self.assertEqual(self.status()['status'], 'done')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), head)

    def test_second_worker_lock_rejected(self):
        with worker.lock(self.worker.jobs / '.worker.lock'):
            with self.assertRaises(BlockingIOError):
                with worker.lock(self.worker.jobs / '.worker.lock', blocking=False): pass

    def test_daemon_entrypoint_with_fake_claude(self):
        import time
        worker.atomic_json(self.engine / 'config/apps.json', {'apps': {'demo': self.app},
                           'agent': {'engine': 'claude', 'claude_model': 'claude-opus-5-5', 'effort': 'medium'}})
        binary = self.root / 'bin'
        binary.mkdir()
        log = self.root / 'claude-args'
        claude = binary / 'claude'
        claude.write_text('#!/usr/bin/env python3\nimport sys, json\nfrom pathlib import Path\na=sys.argv\n'
                           'prompt=sys.stdin.read()\n'
                           'with open(%r, "a") as f: f.write(json.dumps(a[1:]) + "\\n")\n'
                           'assert a[a.index("--model")+1]=="claude-opus-5-5" and a[a.index("--effort")+1]=="medium"\n'
                           'assert json.loads(a[a.index("--settings")+1])=={"fastMode": False} and "-p" in a and prompt\n'
                           'if "--dangerously-skip-permissions" in a: Path("style.css").write_text("body{color:green}\\n")\n'
                           'else: print("OK")\n' % str(log))
        claude.chmod(0o755)
        self.job()
        env = dict(os.environ, HOME=str(self.root / 'home'), PATH=str(binary) + ':' + os.environ['PATH'])
        proc = subprocess.Popen(['bash', str(self.engine / 'orchestrator/daemon.sh')], env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    self.fail(proc.stderr.read().decode())
                path = self.worker.jobs / 'j_test_1.status.json'
                if path.exists() and worker.read_json(path).get('status') in worker.TERMINAL: break
                time.sleep(.05)
            self.assertEqual(self.status()['status'], 'done')
            self.assertIn('green', (self.clone / 'style.css').read_text())
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertTrue(any('--dangerously-skip-permissions' in c for c in calls))
            self.assertTrue(all('--dangerously-skip-permissions' in c or '--tools' in c for c in calls))
        finally:
            proc.terminate()
            proc.wait(5)

    def test_daemon_entrypoint_with_fake_model(self):
        import time
        worker.atomic_json(self.engine / 'config/apps.json', {'apps': {'demo': self.app}, 'agent': {'engine': 'codex'}})
        binary = self.root / 'bin'
        binary.mkdir()
        codex = binary / 'codex'
        codex.write_text('#!/usr/bin/env python3\nimport sys\nfrom pathlib import Path\na=sys.argv\n'
                         'if "--dangerously-bypass-approvals-and-sandbox" not in a: Path(a[a.index("-o")+1]).write_text("OK")\n'
                         'else: (Path(a[a.index("-C")+1])/"style.css").write_text("body{color:blue}\\n")\n')
        codex.chmod(0o755)
        self.job()
        env = dict(os.environ, HOME=str(self.root / 'home'), PATH=str(binary) + ':' + os.environ['PATH'])
        proc = subprocess.Popen(['bash', str(self.engine / 'orchestrator/daemon.sh')], env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    self.fail(proc.stderr.read().decode())
                path = self.worker.jobs / 'j_test_1.status.json'
                if path.exists() and worker.read_json(path).get('status') in worker.TERMINAL: break
                time.sleep(.05)
            self.assertEqual(self.status()['status'], 'done')
            self.assertIn('blue', (self.clone / 'style.css').read_text())
        finally:
            proc.terminate()
            proc.wait(timeout=5)
            proc.stderr.close()

    def test_state_stored_under_an_earlier_project_name_is_still_read(self):
        import repo_state
        self.assertIsNone(repo_state.state_ref(self.clone))
        worker.git(self.clone, 'update-ref', 'refs/persona/state', self.baseline)
        self.assertEqual(repo_state.state_ref(self.clone), self.baseline)
        (self.clone / 'style.css').write_text('body{color:blue}\n')
        newer = self.commit('later')
        worker.git(self.clone, 'update-ref', 'refs/reshape/state', newer)
        self.assertEqual(repo_state.state_ref(self.clone), newer)

    def test_stored_api_key_is_handed_to_its_agent_only(self):
        worker.atomic_json(self.engine / 'config/apps.json', {'apps': {'demo': self.app}, 'agent': {'engine': 'codex'}})
        worker.atomic_json(self.engine / '.agent-keys.json', {'codex': 'sk-test-key'})
        job, _ = self.job()
        with patch.dict(os.environ), patch.object(self.worker, 'run', return_value='OK') as run:
            os.environ.pop('ANTHROPIC_API_KEY', None)
            os.environ.pop('CODEX_API_KEY', None)
            self.worker.ask_agent(job, self.clone, 'Question', 5)
            self.assertEqual(run.call_args.kwargs['env']['CODEX_API_KEY'], 'sk-test-key')
            self.assertNotIn('ANTHROPIC_API_KEY', self.worker.agent_env('claude'))
            # Without a usable key file the agent runs with its own login.
            (self.engine / '.agent-keys.json').write_text('broken')
            self.assertNotIn('CODEX_API_KEY', self.worker.agent_env('codex'))

    def test_cancel_kills_process_group(self):
        job, _ = self.job()
        def cancelled(job):
            if self.worker.child is not None: raise worker.Cancelled()
        with patch.object(self.worker, 'check_cancel', side_effect=cancelled):
            with self.assertRaises(worker.Cancelled):
                self.worker.run(['bash', '-c', 'sleep 60 & wait'], job, 120)
        self.assertIsNone(self.worker.child)

    def test_fork_from_base_skips_shared_dirs_and_registers(self):
        base = self.root / 'base'
        (base / 'media').mkdir(parents=True)
        (base / 'media/big.png').write_bytes(b'x' * 10)
        (base / 'index.html').write_text('<h1>app</h1>')
        (base / 'nested/assets').mkdir(parents=True)
        (base / 'nested/assets/a.css').write_text('a{}')
        (base / 'nested/keep.txt').write_text('keep')
        self.app.update(base_dir=str(base), shared_dirs=['media/', 'nested/assets'])
        worker.atomic_json(self.engine / 'config/apps.json', {'apps': {'demo': self.app}})
        _, path = self.job('fork', job_id='j_fork_1', workspace='winter', source=None, name='Winter', author='Maria')
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_fork_1.status.json')['status'], 'done')
        dest = self.clone.parent / 'winter'
        self.assertTrue((dest / '.git').is_dir())
        self.assertTrue((dest / 'index.html').exists())
        self.assertTrue((dest / 'nested/keep.txt').exists())
        self.assertFalse((dest / 'media').exists())
        self.assertFalse((dest / 'nested/assets').exists())
        import registry
        entry = registry.read(self.app)['workspaces']['winter']
        self.assertIsNone(entry['parent'])
        self.assertEqual((entry['name'], entry['created_by'], entry['source']), ('Winter', 'Maria', 'base'))
        self.assertEqual(list(self.clone.parent.glob('.fork-*')), [])
        _, again = self.job('fork', job_id='j_fork_dup', workspace='winter', source=None, name='Winter')
        self.worker.process(again)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_fork_dup.status.json')['status'], 'blocked')

    def test_fork_from_public_workspace_creates_it_first(self):
        base = self.root / 'base'
        base.mkdir()
        (base / 'index.html').write_text('<h1>app</h1>')
        self.app.update(base_dir=str(base))
        worker.atomic_json(self.engine / 'config/apps.json', {'apps': {'demo': self.app}})
        shutil.rmtree(self.clone)
        _, path = self.job('fork', job_id='j_fork_public', workspace='alex', source='main', name='Alex')
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_fork_public.status.json')['status'], 'done')
        self.assertTrue((self.clone / '.git').is_dir())
        dest = self.clone.parent / 'alex'
        self.assertEqual((dest / 'index.html').read_text(), '<h1>app</h1>')
        self.assertEqual(worker.git(dest, 'rev-parse', 'HEAD'), worker.git(self.clone, 'rev-parse', 'HEAD'))
        import registry
        workspaces = registry.read(self.app)['workspaces']
        self.assertEqual((workspaces['main']['source'], workspaces['alex']['parent']), ('base', 'main'))
        _, missing = self.job('fork', job_id='j_fork_missing', workspace='beta', source='missing', name='Beta')
        self.worker.process(missing)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_fork_missing.status.json')['status'], 'blocked')

    def test_fork_from_workspace_starts_with_fork_as_baseline(self):
        (self.clone / 'style.css').write_text('blue')
        head = self.commit('earlier change')
        _, path = self.job('fork', job_id='j_fork_2', workspace='dark', source='main', name='Dark')
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_fork_2.status.json')['status'], 'done')
        dest = self.clone.parent / 'dark'
        self.assertEqual(worker.git(dest, 'rev-parse', 'HEAD'), head)
        self.assertEqual(worker.git(dest, 'remote'), '')
        import registry, repo_state, rollback_policy
        self.assertEqual(registry.read(self.app)['workspaces']['dark']['fork_commit'], head)
        self.assertEqual(repo_state.read(dest)['base'], head)
        # The parent's history is not an undoable change inside the fork.
        self.assertEqual(rollback_policy.history(dest, self.root / 'cache.json')['commits'], [])
        _, change = self.job(job_id='j_fork_change', workspace='dark')
        with self.fake_edit(lambda space: (space / 'style.css').write_text('green')):
            self.worker.process(change)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_fork_change.status.json')['status'], 'done')
        self.assertEqual((dest / 'style.css').read_text(), 'green')
        self.assertEqual((self.clone / 'style.css').read_text(), 'blue')
        self.assertEqual(len(rollback_policy.history(dest, self.root / 'cache.json')['commits']), 1)
        described = registry.describe(self.app)
        by_slug = {item['slug']: item for item in described['workspaces']}
        self.assertTrue(by_slug['main']['public'])
        self.assertEqual(by_slug['dark']['changes_since_fork'], 1)
        self.assertEqual(by_slug['dark']['commits'][0]['message'], 'Make it blue')
        self.assertEqual(by_slug['main']['changes_since_fork'], 1)

    def test_change_commit_carries_author_name(self):
        _, path = self.job(author='Maria <x>')
        with self.fake_edit(lambda space: (space / 'style.css').write_text('green')):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        self.assertEqual(self.status()['author'], 'Maria <x>')
        self.assertEqual(worker.git(self.clone, 'log', '-1', '--format=%an'), 'Maria x')
        import rollback_policy
        history = rollback_policy.history(self.clone, self.worker.policy_path({'app_id': 'demo', 'workspace': 'main'}))
        self.assertEqual(history['commits'][0]['author'], 'Maria x')

    def test_delete_protects_public_and_parents(self):
        import registry
        registry.register(self.app, 'child', 'Child', parent='main', fork_commit=self.baseline, created_at='2026-01-01T00:00:00Z')
        (self.clone.parent / 'child').mkdir()
        _, path = self.job('delete', job_id='j_del_public', workspace='main')
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_del_public.status.json')['status'], 'blocked')
        self.assertTrue(self.clone.exists())
        registry.register(self.app, 'grandchild', 'Grandchild', parent='child', fork_commit=self.baseline, created_at='2026-01-01T00:00:00Z')
        _, path = self.job('delete', job_id='j_del_parent', workspace='child')
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_del_parent.status.json')['status'], 'blocked')
        self.assertTrue((self.clone.parent / 'child').exists())
        _, path = self.job('delete', job_id='j_del_leaf', workspace='grandchild')
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_del_leaf.status.json')['status'], 'done')
        self.assertNotIn('grandchild', registry.read(self.app)['workspaces'])
        _, path = self.job('delete', job_id='j_del_child', workspace='child')
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_del_child.status.json')['status'], 'done')
        self.assertFalse((self.clone.parent / 'child').exists())

    def test_rename_changes_display_name_only(self):
        import registry
        registry.register(self.app, 'main', 'main', parent=None, fork_commit=None, created_at='2026-01-01T00:00:00Z')
        _, path = self.job('rename', job_id='j_rename', name='Public site – Café')
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_rename.status.json')['status'], 'done')
        self.assertEqual(registry.read(self.app)['workspaces']['main']['name'], 'Public site – Café')
        self.assertTrue((self.clone / '.git').is_dir())

    def test_unknown_workspace_is_blocked_without_creating_it(self):
        _, path = self.job(workspace='nope')
        self.worker.process(path)
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertFalse((self.clone.parent / 'nope').exists())

    def test_public_workspace_created_lazily_from_base_without_shared_dirs(self):
        base = self.root / 'base'
        (base / 'media').mkdir(parents=True)
        (base / 'media/x.png').write_bytes(b'1')
        (base / 'index.html').write_text('app')
        self.app.update(base_dir=str(base), shared_dirs=['media'])
        worker.atomic_json(self.engine / 'config/apps.json', {'apps': {'demo': self.app}})
        shutil.rmtree(self.clone)
        _, path = self.job()
        with self.fake_edit(lambda space: (space / 'index.html').write_text('blue app')):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        self.assertEqual((self.clone / 'index.html').read_text(), 'blue app')
        self.assertFalse((self.clone / 'media').exists())
        import registry
        self.assertIn('main', registry.read(self.app)['workspaces'])

    def test_dispatcher_runs_workspaces_in_parallel_but_one_job_per_workspace(self):
        import time
        import registry
        other = self.clone.parent / 'two'
        shutil.copytree(self.clone, other)
        registry.register(self.app, 'two', 'Two', parent=None, fork_commit=None, created_at='2026-01-01T00:00:00Z')
        worker.atomic_json(self.engine / 'config/apps.json', {'max_parallel_jobs': 3, 'apps': {'demo': self.app},
                                                              'agent': {'engine': 'codex'}})
        binary = self.root / 'bin'
        binary.mkdir()
        barrier = self.root / 'barrier'
        barrier.mkdir()
        # The fake editor only finishes once a second job is editing at the same time.
        codex = binary / 'codex'
        codex.write_text('#!/usr/bin/env python3\nimport sys, time\nfrom pathlib import Path\na=sys.argv\n'
                         'if "--dangerously-bypass-approvals-and-sandbox" not in a: Path(a[a.index("-o")+1]).write_text("OK"); sys.exit(0)\n'
                         'space=Path(a[a.index("-C")+1]); b=Path(%r)\n'
                         '(b / space.name).write_text("here")\n'
                         'for _ in range(200):\n'
                         '    if len(list(b.iterdir())) >= 2: break\n'
                         '    time.sleep(0.05)\n'
                         'else: sys.exit(3)\n'
                         '(space/"style.css").write_text(space.name)\n' % str(barrier))
        codex.chmod(0o755)
        self.job(job_id='j_par_1', workspace='main')
        self.job(job_id='j_par_2', workspace='two')
        self.job(job_id='j_par_3', workspace='main')
        env = dict(os.environ, HOME=str(self.root / 'home'), PATH=str(binary) + ':' + os.environ['PATH'])
        proc = subprocess.Popen(['bash', str(self.engine / 'orchestrator/daemon.sh')], env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            done = {}
            for _ in range(600):
                if proc.poll() is not None:
                    self.fail(proc.stderr.read().decode())
                for jid in ('j_par_1', 'j_par_2', 'j_par_3'):
                    path = self.worker.jobs / (jid + '.status.json')
                    if path.exists() and worker.read_json(path).get('status') in worker.TERMINAL:
                        done[jid] = worker.read_json(path)
                if len(done) == 3:
                    break
                time.sleep(0.05)
            self.assertEqual({k: v['status'] for k, v in done.items()}, {'j_par_1': 'done', 'j_par_2': 'done', 'j_par_3': 'done'})
            self.assertEqual(worker.git(self.clone, 'rev-list', '--count', 'HEAD'), '3')
            self.assertEqual(worker.git(other, 'rev-list', '--count', 'HEAD'), '2')
            self.assertEqual(worker.git(self.clone, 'status', '--porcelain'), '')
        finally:
            proc.terminate()
            proc.wait(timeout=20)
            proc.stderr.close()

    def test_host_changes_are_committed_before_a_job(self):
        (self.clone / 'data.json').write_text('{"tiles": 1}')
        (self.clone / '.DS_Store').write_bytes(b'junk')
        _, path = self.job()
        with self.fake_edit(lambda space: (space / 'style.css').write_text('blue')):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        log = worker.git(self.clone, 'log', '--format=%s|%an').splitlines()
        self.assertEqual(log[0], 'Make it blue|SayAndShape')
        self.assertEqual(log[1], 'Changes made in the app admin|App admin')
        self.assertEqual((self.clone / 'data.json').read_text(), '{"tiles": 1}')
        self.assertEqual(worker.git(self.clone, 'status', '--porcelain'), '')
        self.assertNotIn('.DS_Store', worker.git(self.clone, 'ls-files'))

    def test_promote_replays_fork_commits_into_parent_and_remembers_it(self):
        import registry, rollback_policy
        (self.clone / 'style.css').write_text('blue')
        self.commit('parent change')
        _, fork = self.job('fork', job_id='j_p_fork', workspace='child', source='main', name='Child')
        self.worker.process(fork)
        kid = self.clone.parent / 'child'
        (kid / 'kid.txt').write_text('one')
        worker.git(kid, 'add', '-A')
        worker.git(kid, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'First child change', '--author=Tom <sayandshape@local>')
        (kid / 'kid.txt').write_text('two')
        worker.git(kid, 'add', '-A')
        worker.git(kid, 'commit', '-qm', 'Second child change')
        kid_head = worker.git(kid, 'rev-parse', 'HEAD')
        described = {w['slug']: w for w in registry.describe(self.app)['workspaces']}
        self.assertEqual(described['child']['promote'], dict(target='main', commits=2, files=[dict(path='kid.txt', added=1, deleted=0)]))
        self.assertIsNone(described['main']['promote'])
        _, path = self.job('promote', job_id='j_promote', workspace='main', source='child', author='Tom')
        with self.fake_edit(lambda space: None):
            self.worker.process(path)
        status = worker.read_json(self.worker.jobs / 'j_promote.status.json')
        self.assertEqual((status['status'], status['promoted_commits']), ('done', 2))
        self.assertEqual((self.clone / 'kid.txt').read_text(), 'two')
        log = worker.git(self.clone, 'log', '--format=%s|%an').splitlines()
        self.assertEqual(log[:2], ['Second child change|SayAndShape', 'First child change|Tom'])
        self.assertEqual(registry.read(self.app)['workspaces']['child']['promoted_head'], kid_head)
        self.assertEqual(worker.git(kid, 'rev-parse', 'HEAD'), kid_head)
        history = rollback_policy.history(self.clone, self.worker.policy_path({'app_id': 'demo', 'workspace': 'main'}))
        self.assertEqual(len(history['commits']), 3)
        self.assertTrue(history['commits'][0]['can_rollback'])
        self.assertEqual(list(self.worker.runtime.iterdir()), [])
        _, again = self.job('promote', job_id='j_promote_again', workspace='main', source='child')
        with self.fake_edit(lambda space: None):
            self.worker.process(again)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_promote_again.status.json')['status'], 'blocked')
        (kid / 'kid.txt').write_text('three')
        worker.git(kid, 'add', '-A')
        worker.git(kid, 'commit', '-qm', 'Third')
        _, third = self.job('promote', job_id='j_promote_3', workspace='main', source='child')
        with self.fake_edit(lambda space: None):
            self.worker.process(third)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_promote_3.status.json')['promoted_commits'], 1)
        self.assertEqual(worker.git(self.clone, 'rev-list', '--count', 'HEAD'), '5')

    def test_promote_conflict_blocks_and_leaves_parent_untouched(self):
        (self.clone / 'style.css').write_text('blue')
        self.commit('parent')
        _, fork = self.job('fork', job_id='j_c_fork', workspace='child', source='main', name='Child')
        self.worker.process(fork)
        kid = self.clone.parent / 'child'
        (kid / 'style.css').write_text('green')
        worker.git(kid, 'add', '-A')
        worker.git(kid, 'commit', '-qm', 'Child green')
        (self.clone / 'style.css').write_text('red')
        head = self.commit('parent red')
        _, path = self.job('promote', job_id='j_c_promote', workspace='main', source='child')
        with self.fake_edit(lambda space: None):
            self.worker.process(path)
        status = worker.read_json(self.worker.jobs / 'j_c_promote.status.json')
        self.assertEqual(status['status'], 'blocked')
        self.assertIn('style.css', status['blocked_reason'])
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), head)
        self.assertEqual((self.clone / 'style.css').read_text(), 'red')
        self.assertEqual(list(self.worker.runtime.iterdir()), [])

    def test_promote_from_root_variant_lands_in_public(self):
        import registry
        other = self.clone.parent / 'legacy'
        shutil.copytree(self.clone, other)
        registry.register(self.app, 'legacy', 'Legacy', parent=None, fork_commit=None, created_at='2026-01-01T00:00:00Z', source='legacy')
        (other / 'extra.txt').write_text('x')
        worker.git(other, 'add', '-A')
        worker.git(other, 'commit', '-qm', 'Legacy change')
        described = {w['slug']: w for w in registry.describe(self.app)['workspaces']}
        self.assertEqual((described['legacy']['promote']['target'], described['legacy']['promote']['commits']), ('main', 1))
        _, path = self.job('promote', job_id='j_root_promote', workspace='main', source='legacy')
        with self.fake_edit(lambda space: None):
            self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_root_promote.status.json')['status'], 'done')
        self.assertTrue((self.clone / 'extra.txt').exists())

    def test_change_result_file_is_sanitised_into_status_and_never_committed(self):
        job, path = self.job()
        def edit(space):
            (space / 'style.css').write_text('body{color:blue}\n')
            self.worker.result_path(job).write_text(json.dumps({
                'summary': 'The wall is blue now.', 'points': ['Blue background', 7, ''],
                'questions': [{'text': 'The tiles too?', 'type': 'single', 'options': ['Yes', {'label': 'No', 'description': 'leave as is'}, 'Yes']},
                              {'text': 'Only one option', 'type': 'multi', 'options': ['A']}, {'type': 'text'}],
                'suggestion': 'does not belong here', 'html': '<script>'}))
        with self.fake_edit(edit): self.worker.process(path)
        status = self.status()
        self.assertEqual(status['status'], 'done')
        self.assertEqual(status['result'], {
            'summary': 'The wall is blue now.', 'points': ['Blue background'],
            'questions': [{'id': 'q1', 'text': 'The tiles too?', 'type': 'single',
                           'options': [{'label': 'Yes', 'description': ''}, {'label': 'No', 'description': 'leave as is'}]},
                          {'id': 'q2', 'text': 'Only one option', 'type': 'text', 'options': []}]})
        self.assertEqual(worker.git(self.clone, 'show', '--name-only', '--format=', 'HEAD'), 'style.css')
        self.assertFalse(self.worker.result_path(job).exists())

    def test_questions_only_result_finishes_without_commit(self):
        job, path = self.job()
        answer = 'Here is the result:\n```json\n{"summary": "I need a decision first.", "questions": [{"text": "Which color?", "options": ["Blue", "Green"]}]}\n```'
        with self.fake_edit(lambda space: answer): self.worker.process(path)
        status = self.status()
        self.assertEqual((status['status'], status['commit_hash']), ('done', None))
        self.assertEqual(status['result']['questions'][0]['type'], 'single')
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), self.baseline)

    def test_plain_console_answer_becomes_summary(self):
        self.assertEqual(worker.load_result(self.root / 'missing.json', 'All done.')['summary'], 'All done.')
        self.assertIsNone(worker.load_result(self.root / 'missing.json', ''))

    def test_discuss_answers_read_only_keeps_context_and_delete_drops_chat(self):
        seen = []
        def run(args, job, timeout, output=None, env=None, cwd=None, stdin_text=None, **kwargs):
            seen.append((args, cwd, stdin_text))
            self.worker.result_path(job).write_text(json.dumps({'summary': 'Answer %d' % len(seen), 'suggestion': 'Make it blue'}))
            Path(output).write_text('')
            return ''
        job, path = self.job('discuss', transcript='What can I change?', author='Maria')
        with patch.object(self.worker, 'run', side_effect=run): self.worker.process(path)
        status = self.status()
        self.assertEqual((status['status'], status['result']['summary'], status['result']['suggestion']), ('done', 'Answer 1', 'Make it blue'))
        args, cwd, prompt = seen[0]
        self.assertEqual(Path(cwd), self.clone)
        self.assertNotIn('--dangerously-skip-permissions', args)
        self.assertIn('Edit(/' + str(self.worker.result_path(job)) + ')', args)
        self.assertIn('What can I change?', prompt)
        self.assertIn('in the language the user used', prompt)
        self.assertEqual(worker.git(self.clone, 'rev-parse', 'HEAD'), self.baseline)
        self.assertEqual(worker.git(self.clone, 'status', '--porcelain'), '')
        job2, path2 = self.job('discuss', job_id='j_test_2', transcript='And then?')
        with patch.object(self.worker, 'run', side_effect=run): self.worker.process(path2)
        self.assertIn('User (Maria): What can I change?', seen[1][2])
        self.assertIn('Suggested job: Make it blue', seen[1][2])
        chat = worker.read_json(self.worker.jobs / '.chat-demo-main.json')['messages']
        self.assertEqual([m['role'] for m in chat], ['user', 'assistant', 'user', 'assistant'])
        # A failed question stores nothing.
        def fail(*a, **k): raise RuntimeError('broken')
        job3, path3 = self.job('discuss', job_id='j_test_3', transcript='Once more')
        with patch.object(self.worker, 'run', side_effect=fail): self.worker.process(path3)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_test_3.status.json')['status'], 'failed')
        self.assertEqual(len(self.worker.chat_read(job3)), 4)

    # ── Interface language ("language" in config/apps.json) ──

    def set_language(self, lang):
        config = worker.read_json(self.engine / 'config/apps.json')
        config['language'] = lang
        worker.atomic_json(self.engine / 'config/apps.json', config)

    def reason(self, job_id):
        return worker.read_json(self.worker.jobs / (job_id + '.status.json'))['blocked_reason']

    def test_job_messages_are_english_by_default_and_german_when_configured(self):
        _, path = self.job('delete', job_id='j_del_en')
        self.worker.process(path)
        self.assertEqual(self.reason('j_del_en'), 'The public variant cannot be deleted')
        self.set_language('fr')  # anything but en/de means English
        _, path = self.job('baseline', job_id='j_base_fr', expected_head=self.baseline)
        self.worker.process(path)
        self.assertEqual(self.reason('j_base_fr'), 'No new changes to set as the baseline')
        self.set_language('de')
        _, path = self.job('delete', job_id='j_del_de')
        self.worker.process(path)
        self.assertEqual(self.reason('j_del_de'), 'Die öffentliche Variante kann nicht gelöscht werden')
        # Raised in repo_state, which does not know the language.
        _, path = self.job('baseline', job_id='j_base_de', expected_head=self.baseline)
        self.worker.process(path)
        self.assertEqual(self.reason('j_base_de'), 'Keine neuen Änderungen zum Übernehmen vorhanden')
        _, path = self.job(job_id='j_bad_de', workspace='Not a slug')
        self.worker.process(path)
        self.assertEqual(self.reason('j_bad_de'), 'Ungültige Variante')
        # A message with a variable part.
        job, _ = self.job(job_id='j_slow_de')
        with self.assertRaises(RuntimeError) as raised:
            self.worker.run(['sleep', '5'], job, 0)
        self.worker.fail(job, raised.exception)
        self.assertEqual(self.reason('j_slow_de'), 'Zeitlimit von 0 Sekunden erreicht')
        self.worker.status(job, 'running')
        self.worker.recover()
        self.assertEqual(self.reason('j_slow_de'), 'Durch Neustart unterbrochen; bitte erneut beauftragen')

    def test_german_commit_subjects_and_rollback_lock_reason(self):
        self.set_language('de')
        (self.clone / 'style.css').write_text('body{color:green}\n')
        first = self.commit('Make it green')
        (self.clone / 'data.json').write_text('{"tiles": 1}')
        _, path = self.job()
        with self.fake_edit(lambda space: (space / 'style.css').write_text('body{color:blue}\n')):
            self.worker.process(path)
        self.assertEqual(self.status()['status'], 'done')
        log = worker.git(self.clone, 'log', '--format=%s|%an').splitlines()
        self.assertEqual(log[:2], ['Make it blue|SayAndShape', 'Änderungen über die Verwaltung der App|App-Verwaltung'])
        _, path = self.job('rollback', job_id='j_undo_de', commit_hash=first)
        self.worker.process(path)
        self.assertEqual(self.reason('j_undo_de'), 'Spätere Änderungen bearbeiten dieselben Dateien. Diese zuerst zurücknehmen.')
        head = worker.git(self.clone, 'rev-parse', 'HEAD')
        _, path = self.job('baseline', job_id='j_base_de', expected_head=head)
        self.worker.process(path)
        self.assertEqual(worker.read_json(self.worker.jobs / 'j_base_de.status.json')['status'], 'done')
        self.assertTrue(worker.git(self.clone, 'log', '-1', '--format=%s', 'refs/sayandshape/state').startswith('SayAndShape: neue Basis 20'))
        _, path = self.job('fork', job_id='j_fork_de', workspace='winter', source='main', name='Winter')
        self.worker.process(path)
        self.assertEqual(worker.git(self.clone.parent / 'winter', 'log', '-1', '--format=%s', 'refs/sayandshape/state'),
                         'SayAndShape: Abzweigung')

    def test_registry_and_migration_texts_follow_language(self):
        def registry_message():
            result = subprocess.run([sys.executable, str(self.engine / 'orchestrator/registry.py'), 'list',
                                     str(self.engine / 'config/apps.json'), 'unknown'], capture_output=True, text=True)
            return json.loads(result.stdout)['message']
        self.assertEqual(registry_message(), 'Variants not readable: Unknown app')
        self.set_language('de')
        self.assertEqual(registry_message(), 'Varianten nicht lesbar: Unbekannte App')
        shutil.copytree(self.clone, self.clone.parent / 'user_7')
        subprocess.run([sys.executable, str(self.engine / 'orchestrator/migrate_workspaces.py'), '--apply'],
                       check=True, capture_output=True)
        import registry
        self.assertEqual(registry.read(self.app)['workspaces']['user-7']['name'], 'Variante von Nutzer 7')

if __name__ == '__main__': unittest.main(verbosity=2)
