import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import rollback_policy as policy
from worker import git


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sayandshape-policy-')
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name) / 'repo'
        self.repo.mkdir()
        self.cache = Path(self.tmp.name) / 'cache.json'
        git(self.repo, 'init', '-q')
        git(self.repo, 'config', 'user.name', 'Test')
        git(self.repo, 'config', 'user.email', 'test@local')
        self.commit('base.txt', 'baseline', 'baseline')

    def commit(self, name, text, message):
        (self.repo / name).write_text(text)
        git(self.repo, 'add', '-A'); git(self.repo, 'commit', '-qm', message)
        return git(self.repo, 'rev-parse', 'HEAD')

    def report(self, decisions):
        head, _ = policy.snapshot(self.repo)
        self.cache.write_text(json.dumps(dict(version=policy.VERSION, head=head, decisions=decisions)))

    def test_latest_always_allowed_without_audit(self):
        sha = self.commit('a.txt', 'one', 'first')
        self.assertTrue(policy.check(self.repo, self.cache, sha)['allowed'])

    def test_same_file_blocks_older_and_unlocks_after_latest_removed(self):
        first = self.commit('a.txt', 'one', 'first')
        second = self.commit('a.txt', 'two', 'second')
        before = policy.history(self.repo, self.cache)['commits']
        self.assertTrue(before[0]['can_rollback'])
        self.assertFalse(before[1]['can_rollback'])
        self.assertEqual(before[1]['dependent_commits'], [second])
        git(self.repo, 'reset', '--hard', first)
        self.assertTrue(policy.check(self.repo, self.cache, first)['allowed'])

    def test_shared_files_cannot_be_overridden_by_model(self):
        first = self.commit('a.txt', 'one', 'first')
        self.commit('a.txt', 'two', 'second')
        self.report([dict(hash=first, state='independent', dependent_commits=[], reason='model says safe')])
        self.assertFalse(policy.check(self.repo, self.cache, first)['allowed'])

    def test_cross_file_semantic_dependency_blocks(self):
        first = self.commit('helper.php', '<?php function helper() {}', 'helper')
        second = self.commit('page.php', '<?php helper();', 'use helper')
        self.report([dict(hash=first, state='dependent', dependent_commits=[second], reason='The later page calls this function.')])
        answer = policy.check(self.repo, self.cache, first)
        self.assertFalse(answer['allowed'])
        self.assertIn('function', answer['reason'])

    def test_five_independent_changes_allow_only_third_removal(self):
        hashes = [self.commit(f'{i}.txt', str(i), f'edit {i}') for i in range(1, 6)]
        self.report([dict(hash=sha, state='independent', dependent_commits=[], reason='Independent file') for sha in hashes[:-1]])
        self.assertTrue(policy.check(self.repo, self.cache, hashes[2])['allowed'])
        git(self.repo, 'rebase', '--onto', hashes[1], hashes[2])
        self.assertFalse((self.repo / '3.txt').exists())
        self.assertTrue(all((self.repo / f'{i}.txt').exists() for i in [1, 2, 4, 5]))
        # Rebase changes commit IDs; stale permissions are never reused.
        entries = policy.history(self.repo, self.cache)['commits']
        self.assertTrue(entries[0]['can_rollback'])
        self.assertTrue(all(not entry['can_rollback'] for entry in entries[1:]))
        self.report([dict(hash=entry['hash'], state='independent', dependent_commits=[], reason='Re-checked') for entry in entries[1:]])
        self.assertTrue(all(entry['can_rollback'] for entry in policy.history(self.repo, self.cache)['commits']))

    def test_unknown_independence_is_denied(self):
        first = self.commit('a.txt', 'one', 'first')
        self.commit('b.txt', 'two', 'second')
        self.assertFalse(policy.check(self.repo, self.cache, first)['allowed'])

    def test_missing_or_invalid_decisions_do_not_unlock(self):
        first = self.commit('a.txt', 'one', 'first')
        self.commit('b.txt', 'two', 'second')
        for report in ['broken', '[]', '{"version": 0}', json.dumps({'version': 1, 'head': git(self.repo, 'rev-parse', 'HEAD'), 'decisions': [{'hash': first, 'state': 'independent', 'dependent_commits': [], 'reason': ''}]})]:
            self.cache.write_text(report)
            self.assertFalse(policy.check(self.repo, self.cache, first)['allowed'])
            self.assertTrue(policy.history(self.repo, self.cache)['commits'][0]['can_rollback'])

    def test_earlier_hash_not_valid_as_dependent(self):
        first = self.commit('a.txt', 'one', 'first')
        self.commit('b.txt', 'two', 'second')
        head, commits = policy.snapshot(self.repo)
        report = dict(version=1, head=head, decisions=[dict(hash=first, state='dependent', dependent_commits=[first], reason='invalid')])
        with self.assertRaises(ValueError): policy.validate_report(report, head, commits)

    def test_prompt_covers_semantic_dependencies_and_latest_exception(self):
        self.commit('a.txt', 'one', 'first')
        self.commit('b.txt', 'two', 'second')
        head, commits = policy.snapshot(self.repo)
        text = policy.audit_prompt(self.repo, head, commits)
        for word in ['DOM IDs', 'indirectly', 'NEWEST', 'uncertain', 're-checked', 'in English']:
            self.assertIn(word, text)

    def test_baseline_never_offered(self):
        self.assertEqual(policy.history(self.repo, self.cache)['commits'], [])

    def test_lock_reasons_follow_language(self):
        root = git(self.repo, 'rev-parse', 'HEAD')
        first = self.commit('a.txt', 'one', 'first')
        self.commit('a.txt', 'two', 'second')
        self.commit('b.txt', 'three', 'third')
        english = policy.history(self.repo, self.cache)['commits']
        self.assertEqual([c['blocked_reason'] for c in english[1:]],
                         ['Dependencies have not been reliably checked yet. Undo later changes first.',
                          'Later changes edit the same files. Undo those first.'])
        german = policy.history(self.repo, self.cache, 'de')['commits']
        self.assertEqual([c['blocked_reason'] for c in german[1:]],
                         ['Abhängigkeiten noch nicht sicher geprüft. Zuerst spätere Änderungen zurücknehmen.',
                          'Spätere Änderungen bearbeiten dieselben Dateien. Diese zuerst zurücknehmen.'])
        self.assertEqual(policy.check(self.repo, self.cache, first, 'de')['reason'], german[2]['blocked_reason'])
        self.assertEqual(policy.check(self.repo, self.cache, root, 'de')['reason'],
                         'Änderung gehört nicht zum aktuellen sichtbaren Verlauf.')

    def test_prompt_asks_for_reasons_in_configured_language(self):
        self.commit('a.txt', 'one', 'first')
        self.commit('b.txt', 'two', 'second')
        head, commits = policy.snapshot(self.repo)
        text = policy.audit_prompt(self.repo, head, commits, 'de')
        self.assertIn('write them in German', text)
        self.assertNotIn('in English', text)

    def test_cli_reads_language_from_engine_config(self):
        # The panel's history comes from the command line; it reads config/apps.json next to orchestrator/.
        engine = Path(self.tmp.name) / 'engine'
        (engine / 'orchestrator').mkdir(parents=True)
        (engine / 'config').mkdir()
        for name in ('rollback_policy.py', 'repo_state.py', 'i18n.py'):
            shutil.copy(Path(policy.__file__).parent / name, engine / 'orchestrator' / name)
        self.commit('a.txt', 'one', 'first')
        self.commit('a.txt', 'two', 'second')
        def reason():
            out = subprocess.run([sys.executable, str(engine / 'orchestrator/rollback_policy.py'), 'history',
                                  str(self.repo), str(self.cache)], capture_output=True, text=True, check=True).stdout
            return json.loads(out)['commits'][1]['blocked_reason']
        self.assertEqual(reason(), 'Later changes edit the same files. Undo those first.')
        (engine / 'config/apps.json').write_text(json.dumps({'language': 'de', 'apps': {}}))
        self.assertEqual(reason(), 'Spätere Änderungen bearbeiten dieselben Dateien. Diese zuerst zurücknehmen.')

if __name__ == '__main__': unittest.main(verbosity=2)
