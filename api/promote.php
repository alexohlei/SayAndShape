<?php
// Replay a variant's changes into its parent (or the public variant) as individually undoable commits.
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
$body = sayandshapeBody();
$app = sayandshapeApp($body['app_id'] ?? null);
$source = sayandshapeWorkspace($app, $body['workspace'] ?? null);
$public = sayandshapePublicSlug($app);
if ($source === $public) sayandshapeFail('The public variant has no parent variant', 409);
$registry = sayandshapeRegistry($app);
$parent = $registry[$source]['parent'] ?? null;
$parentExists = is_string($parent) && $parent !== $source && preg_match(SAYANDSHAPE_SLUG, $parent)
    && ($parent === $public || isset($registry[$parent]) || is_dir(sayandshapeWorkspaceDir($app, $parent) . '/.git'));
$body['source'] = $source;
$body['workspace'] = $parentExists ? $parent : $public;
sayandshapeEnqueue($user, $body, 'promote');
