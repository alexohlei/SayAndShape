<?php
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
$body = sayandshapeBody();
$job = sayandshapeJob($body['job_id'] ?? null, $user);
$status = sayandshapeJobStatus($job);
if (in_array($status['status'], ['done', 'failed', 'blocked', 'cancelled'], true)) {
    sayandshapeJsonResponse(['success' => true, 'status' => $status]);
    exit;
}
try {
    // Only the worker writes status; a cancel request is not a confirmed cancellation.
    sayandshapeAtomicJson(sayandshapeEngineDir() . '/jobs/' . $job['job_id'] . '.cancel', ['requested_at' => gmdate('c')]);
    sayandshapeJsonResponse(['success' => true, 'status' => sayandshapeJobStatus($job)], 202);
} catch (Throwable $e) {
    sayandshapeFail('Cancellation could not be requested', 503);
}
