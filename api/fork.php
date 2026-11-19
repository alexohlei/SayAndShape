<?php
// Create a new workspace: a local git clone of another workspace, or a fresh copy of the source app.
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();
$body = sayandshapeBody();
$app = sayandshapeApp($body['app_id'] ?? null);
if (!is_string($body['name'] ?? null)) sayandshapeFail('Name required');
$name = trim($body['name']);
if ($name === '' || mb_strlen($name, 'UTF-8') > 60) sayandshapeFail('Name must be 1–60 characters');
$slug = isset($body['slug']) && is_string($body['slug']) ? trim($body['slug']) : sayandshapeSlugify($name);
if ($slug === '' || !preg_match(SAYANDSHAPE_SLUG, $slug) || in_array($slug, SAYANDSHAPE_RESERVED_SLUGS, true)) {
    sayandshapeFail('No valid ID can be made from this name');
}
$source = $body['source'] ?? null;
if ($source === '' || $source === 'base') $source = null;
if ($source !== null) $source = sayandshapeWorkspace($app, $source);
if ($slug === sayandshapePublicSlug($app) || isset(sayandshapeRegistry($app)[$slug]) || is_dir(sayandshapeWorkspaceDir($app, $slug))) {
    sayandshapeFail('A variant with this name already exists', 409);
}
$body['workspace'] = $slug;
$body['source'] = $source;
$body['name'] = $name;
sayandshapeEnqueue($user, $body, 'fork');
