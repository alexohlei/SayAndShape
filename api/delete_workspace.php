<?php
// Remove a workspace and its local repository. The public workspace and parents of other workspaces are protected.
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
$body = sayandshapeBody();
$app = sayandshapeApp($body['app_id'] ?? null);
$workspace = sayandshapeWorkspace($app, $body['workspace'] ?? null);
if ($workspace === sayandshapePublicSlug($app)) sayandshapeFail('The public variant cannot be deleted', 409);
foreach (sayandshapeRegistry($app) as $entry) {
    if (($entry['parent'] ?? null) === $workspace) sayandshapeFail('Delete the variants derived from it first', 409);
}
sayandshapeEnqueue($user, $body, 'delete');
