<?php
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
$body = sayandshapeBody();
if (!is_string($body['transcript'] ?? null)) sayandshapeFail('Instruction required');
$body['transcript'] = trim($body['transcript']);
if ($body['transcript'] === '' || strlen($body['transcript']) > 10000) sayandshapeFail('Instruction must be 1–10000 bytes');
$body['attachments'] = sayandshapeAttachments($user, $body);
sayandshapeEnqueue($user, $body, 'change');
