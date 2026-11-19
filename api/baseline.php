<?php
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
$body = sayandshapeBody();
$app = sayandshapeApp($body['app_id'] ?? null);
$workspace = sayandshapeWorkspace($app, $body['workspace'] ?? null);
$history = sayandshapeRollbackPolicy($body['app_id'], $workspace);
if (empty($history['commits'])) sayandshapeFail('No new changes to adopt as baseline', 409);
$body['expected_head'] = $history['head'];
sayandshapeEnqueue($user, $body, 'baseline');
