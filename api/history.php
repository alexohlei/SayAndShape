<?php
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
$appId = $_GET['app_id'] ?? null;
$app = sayandshapeApp($appId);
$workspace = sayandshapeWorkspace($app, $_GET['workspace'] ?? null);
sayandshapeJsonResponse(sayandshapeRollbackPolicy($appId, $workspace) + ['workspace' => $workspace]);
