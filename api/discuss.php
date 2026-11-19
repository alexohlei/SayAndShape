<?php
// "Discuss" section: GET returns the variant's chat, POST {message} asks a question (a read-only job,
// nothing is changed), POST {clear: true} clears the chat – the AI agent then starts without prior context.
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $appId = $_GET['app_id'] ?? null;
    $app = sayandshapeApp($appId);
    $workspace = sayandshapeWorkspace($app, $_GET['workspace'] ?? null);
    sayandshapeJsonResponse(['success' => true, 'workspace' => $workspace, 'messages' => sayandshapeChat($appId, $workspace)]);
    exit;
}

$body = sayandshapeBody();
if (!empty($body['clear'])) {
    $appId = $body['app_id'] ?? null;
    $app = sayandshapeApp($appId);
    $workspace = sayandshapeWorkspace($app, $body['workspace'] ?? null);
    $active = sayandshapeActiveJob($appId, $workspace);
    if ($active && ($active['action'] ?? '') === 'discuss') {
        sayandshapeJsonResponse(['success' => false, 'message' => sayandshapeT('A question is still running. Please wait or cancel it.'), 'job_id' => $active['job_id']], 409);
        exit;
    }
    $file = sayandshapeChatPath($appId, $workspace);
    if (file_exists($file) && !unlink($file)) sayandshapeFail('Chat could not be cleared', 503);
    sayandshapeJsonResponse(['success' => true, 'workspace' => $workspace, 'messages' => []]);
    exit;
}

if (!is_string($body['message'] ?? null)) sayandshapeFail('Question required');
$body['transcript'] = trim($body['message']);
if ($body['transcript'] === '' || strlen($body['transcript']) > 10000) sayandshapeFail('Question must be 1–10000 bytes');
sayandshapeEnqueue($user, $body, 'discuss');
