<?php
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
sayandshapeEnqueue($user, sayandshapeBody(), 'reset');
