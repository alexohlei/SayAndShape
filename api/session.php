<?php
require_once __DIR__ . '/auth.php';
$identity = sayandshapeAdminIdentity();
sayandshapeJsonResponse(['success' => true, 'logged_in' => $identity !== null, 'user_id' => $identity['user'] ?? null,
                     'engine_admin' => $identity !== null && $identity['app'] === null, 'language' => sayandshapeLanguage()]);
