<?php
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
$body = sayandshapeBody();
if (!is_string($body['commit_hash'] ?? null) || !preg_match('/^[0-9a-f]{7,64}$/D', $body['commit_hash'])) {
    sayandshapeFail('Invalid commit');
}
$app = sayandshapeApp($body['app_id'] ?? null);
$workspace = sayandshapeWorkspace($app, $body['workspace'] ?? null);
$policy = sayandshapeRollbackPolicy($body['app_id'], $workspace, $body['commit_hash']);
if (!($policy['allowed'] ?? false)) sayandshapeFail($policy['reason'] ?? 'Undo blocked', 409);
$body['commit_hash'] = $policy['hash'];
$body['expected_head'] = $policy['head'];
sayandshapeEnqueue($user, $body, 'rollback');
