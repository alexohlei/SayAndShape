<?php
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
if (isset($_GET['job_id'])) {
    $job = sayandshapeJob($_GET['job_id'], $user);
} else {
    $appId = $_GET['app_id'] ?? null;
    $app = sayandshapeApp($appId);
    $workspace = sayandshapeWorkspace($app, $_GET['workspace'] ?? null);
    $job = sayandshapeActiveJob($appId, $workspace);
}
sayandshapeJsonResponse(['success' => true, 'status' => $job ? sayandshapeJobStatus($job) : null]);
