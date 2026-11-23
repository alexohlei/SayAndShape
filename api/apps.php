<?php
// Projects for the setup page: GET lists config/apps.json with facts, POST saves or removes one project.
require_once __DIR__ . '/auth.php';
sayandshapeRequireEngineAdmin();
$configPath = sayandshapeEngineDir() . '/config/apps.json';

function sayandshapeDaemonRunning(): bool {
    $lock = sayandshapeEngineDir() . '/jobs/.worker.lock';
    if (!file_exists($lock)) return false;
    $handle = @fopen($lock, 'r');
    if (!$handle) return false;
    $free = flock($handle, LOCK_EX | LOCK_NB);
    if ($free) flock($handle, LOCK_UN);
    fclose($handle);
    return !$free;
}

function sayandshapeStringField(array $body, array $existing, string $key, int $max, string $default = ''): string {
    if (!array_key_exists($key, $body)) return (string) ($existing[$key] ?? $default);
    if (!is_string($body[$key])) sayandshapeFail('Field {key} must be text', 400, ['key' => $key]);
    $value = trim($body[$key]);
    if (mb_strlen($value, 'UTF-8') > $max) sayandshapeFail('Field {key} is too long (max. {max} characters)', 400, ['key' => $key, 'max' => $max]);
    return $value;
}

function sayandshapeListField(array $body, array $existing, string $key, int $max, bool $paths): array {
    if (!array_key_exists($key, $body)) return array_values(array_filter((array) ($existing[$key] ?? []), 'is_string'));
    if (!is_array($body[$key])) sayandshapeFail('Field {key} must be a list', 400, ['key' => $key]);
    $out = [];
    foreach ($body[$key] as $item) {
        if (!is_string($item)) sayandshapeFail('Field {key}: only text allowed', 400, ['key' => $key]);
        $item = trim($item);
        if ($paths) $item = trim($item, '/');
        if ($item === '') continue;
        if (strlen($item) > 200 || str_contains($item, "\0")) sayandshapeFail('Field {key}: invalid entry', 400, ['key' => $key]);
        if ($paths && (str_contains($item, '..') || str_starts_with($item, '/'))) sayandshapeFail("Field {key}: only relative paths without '..'", 400, ['key' => $key]);
        $out[] = $item;
    }
    if (count($out) > $max) sayandshapeFail('Field {key}: at most {max} entries', 400, ['key' => $key, 'max' => $max]);
    return array_values(array_unique($out));
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $config = sayandshapeLoadAppsConfig();
    $apps = [];
    foreach ($config['apps'] as $id => $app) {
        if (!is_array($app)) continue;
        $cloneDir = rtrim((string) ($app['clone_dir'] ?? ''), '/');
        $variants = 0;
        if ($cloneDir !== '' && file_exists("$cloneDir/workspaces.json")) {
            $data = json_decode(@file_get_contents("$cloneDir/workspaces.json"), true);
            $variants = is_array($data['workspaces'] ?? null) ? count($data['workspaces']) : 0;
        }
        $apps[] = $app + ['id' => $id, 'base_exists' => is_dir((string) ($app['base_dir'] ?? '')),
                          'variants' => $variants, 'active_jobs' => count(sayandshapeActiveJobs($id))];
    }
    sayandshapeJsonResponse(['success' => true, 'engine_dir' => sayandshapeEngineDir(),
        'max_parallel_jobs' => (int) ($config['max_parallel_jobs'] ?? 1), 'daemon_running' => sayandshapeDaemonRunning(),
        'config_writable' => is_writable($configPath) && is_writable(dirname($configPath)),
        'upload_types_default' => SAYANDSHAPE_UPLOAD_TYPES, 'apps' => $apps]);
    exit;
}

$body = sayandshapeBody();
$config = sayandshapeLoadAppsConfig();
$id = $body['id'] ?? null;
if (!is_string($id) || !preg_match('/^[a-z0-9][a-z0-9_-]{0,39}$/D', $id)) sayandshapeFail('ID: only lowercase letters, digits, - and _ (max. 40)');
if (!empty($body['remove'])) {
    if (!isset($config['apps'][$id])) sayandshapeFail('Project not found', 404);
    unset($config['apps'][$id]);
    try { sayandshapeAtomicJson($configPath, $config, true); } catch (Throwable $e) { sayandshapeFail('Configuration could not be saved (write permission?)', 503); }
    sayandshapeJsonResponse(['success' => true, 'removed' => $id]);
    exit;
}
$existing = is_array($config['apps'][$id] ?? null) ? $config['apps'][$id] : [];
$engineDir = sayandshapeEngineDir();
$baseDir = $body['base_dir'] ?? $existing['base_dir'] ?? null;
if (!is_string($baseDir) || $baseDir === '' || $baseDir[0] !== '/') sayandshapeFail('Folder must be an absolute path');
$real = realpath($baseDir);
if ($real === false || !is_dir($real)) sayandshapeFail('Folder not found');
if ($real === '/' || str_starts_with($real . '/', $engineDir . '/') || str_starts_with($engineDir . '/', $real . '/')) {
    sayandshapeFail('This folder cannot be used as a project');
}
$app = $existing;
$app['name'] = sayandshapeStringField($body, $existing, 'name', 60, $id);
$app['base_dir'] = $real;
$app['clone_dir'] = is_string($existing['clone_dir'] ?? null) && $existing['clone_dir'] !== '' ? $existing['clone_dir'] : "$engineDir/clones/$id";
$app['serve_base'] = '/w/';
$public = sayandshapeStringField($body, $existing, 'public_workspace', 40, 'main');
if (!preg_match(SAYANDSHAPE_SLUG, $public) || in_array($public, SAYANDSHAPE_RESERVED_SLUGS, true)) sayandshapeFail('Public variant: invalid ID');
$app['public_workspace'] = $public;
$app['app_url'] = sayandshapeStringField($body, $existing, 'app_url', 300);
$app['shared_dirs'] = sayandshapeListField($body, $existing, 'shared_dirs', 20, true);
$app['allowed_changes'] = sayandshapeStringField($body, $existing, 'allowed_changes', 600);
$app['extra_blocked_files'] = sayandshapeListField($body, $existing, 'extra_blocked_files', 100, true);
$app['extra_blocked_patterns'] = sayandshapeListField($body, $existing, 'extra_blocked_patterns', 100, false);
$maxFiles = $body['max_files_per_change'] ?? $existing['max_files_per_change'] ?? 20;
if (!is_int($maxFiles) || $maxFiles < 1 || $maxFiles > 200) sayandshapeFail('Files per change: 1 to 200');
$app['max_files_per_change'] = $maxFiles;
// Files people attach to a request (api/upload.php): how many, how large, which types.
$uploadFiles = $body['max_upload_files'] ?? $existing['max_upload_files'] ?? 10;
if (!is_int($uploadFiles) || $uploadFiles < 0 || $uploadFiles > 50) sayandshapeFail('Uploads per request: 0 to 50');
$app['max_upload_files'] = $uploadFiles;
$uploadMb = $body['max_upload_mb'] ?? $existing['max_upload_mb'] ?? 25;
if (!is_int($uploadMb) || $uploadMb < 1 || $uploadMb > 200) sayandshapeFail('Upload size: 1 to 200 MB');
$app['max_upload_mb'] = $uploadMb;
if (array_key_exists('upload_types', $body)) {
    $types = [];
    foreach (sayandshapeListField($body, $existing, 'upload_types', 200, false) as $type) {
        $type = strtolower(ltrim($type, '.'));
        if (!preg_match('/^[a-z0-9]{1,10}$/D', $type)) sayandshapeFail('Upload types: only file endings such as jpg or pdf');
        if (in_array($type, SAYANDSHAPE_UPLOAD_BLOCKED, true)) sayandshapeFail('Files of the type {type} can never be uploaded', 400, ['type' => $type]);
        $types[] = $type;
    }
    $types = array_values(array_unique($types));
    // The standard list is not stored, so a project without a list of its own follows later versions of it.
    $standard = !$types || (!array_diff($types, SAYANDSHAPE_UPLOAD_TYPES) && !array_diff(SAYANDSHAPE_UPLOAD_TYPES, $types));
    if ($standard) unset($app['upload_types']); else $app['upload_types'] = $types;
}
$auto = $body['auto_commit_host_changes'] ?? $existing['auto_commit_host_changes'] ?? true;
if (!is_bool($auto)) sayandshapeFail('auto_commit_host_changes must be true or false');
$app['auto_commit_host_changes'] = $auto;
if (array_key_exists('max_parallel_jobs', $body)) {
    $parallel = $body['max_parallel_jobs'];
    if (!is_int($parallel) || $parallel < 1 || $parallel > 16) sayandshapeFail('Parallel changes: 1 to 16');
    $config['max_parallel_jobs'] = $parallel;
}
$config['apps'][$id] = $app;
try { sayandshapeAtomicJson($configPath, $config, true); } catch (Throwable $e) { sayandshapeFail('Configuration could not be saved (write permission on config/?)', 503); }
sayandshapeJsonResponse(['success' => true, 'id' => $id, 'app' => $app + ['id' => $id], 'max_parallel_jobs' => (int) ($config['max_parallel_jobs'] ?? 1)]);
