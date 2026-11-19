<?php
// Change the display name of a workspace; its slug and URL stay the same.
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
$body = sayandshapeBody();
$app = sayandshapeApp($body['app_id'] ?? null);
sayandshapeWorkspace($app, $body['workspace'] ?? null);
if (!is_string($body['name'] ?? null)) sayandshapeFail('Name required');
$body['name'] = trim($body['name']);
if ($body['name'] === '' || mb_strlen($body['name'], 'UTF-8') > 60) sayandshapeFail('Name must be 1–60 characters');
sayandshapeEnqueue($user, $body, 'rename');
