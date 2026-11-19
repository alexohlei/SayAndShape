<?php
// All workspaces (variants) of an app with Git facts and the active job per workspace.
require_once __DIR__ . '/auth.php';
sayandshapeRequireAdmin();
$appId = $_GET['app_id'] ?? null;
sayandshapeApp($appId);
sayandshapeJsonResponse(sayandshapeWorkspaces($appId));
