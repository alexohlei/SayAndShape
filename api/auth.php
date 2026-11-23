<?php
require_once __DIR__ . '/i18n.php';
if (!defined('SAYANDSHAPE_DEMO_USER_ID')) define('SAYANDSHAPE_DEMO_USER_ID', 1);
const SAYANDSHAPE_SLUG = '/^[a-z0-9][a-z0-9-]{0,39}$/D';
const SAYANDSHAPE_RESERVED_SLUGS = ['sayandshape', 'api', 'widget', 'admin', 'u', 'w'];

function sayandshapeEngineDir(): string { return dirname(__DIR__); }

/** ID of this engine installation. The session name and the login are tied to it. */
function sayandshapeAdminScope(): string {
    return hash('sha256', realpath(sayandshapeEngineDir()) ?: sayandshapeEngineDir());
}

function sayandshapeRawConfig(): array {
    static $config = null;
    if ($config === null) {
        $data = json_decode((string) @file_get_contents(sayandshapeEngineDir() . '/config/apps.json'), true);
        $config = is_array($data) ? $data : [];
    }
    return $config;
}

function sayandshapeLoadAppsConfig(): array {
    $data = sayandshapeRawConfig();
    if (!isset($data['apps']) || !is_array($data['apps'])) sayandshapeFail('Configuration not available', 503);
    return $data;
}

/* ── Login ──────────────────────────────────────────────────────────────
   Two ways, chosen per project in config/apps.json → apps.<id>.auth:
   - "engine" (default): own login page at /sayandshape/login/, one password for the engine
     (bin/sayandshape passwd, config/auth.json). Applies to all projects of this engine.
   - "host": the app's own admin session (session_name, session_key, user_key). It applies only to
     the project whose router the request came through, unless auth.engine_admin is set.
   The engine login always works as well, also in projects using "host". */

/** The project whose sayandshape-router.php the request came through (or null when called directly). */
function sayandshapeContextAppId(): ?string {
    return defined('SAYANDSHAPE_APP_ID') && is_string(SAYANDSHAPE_APP_ID) ? SAYANDSHAPE_APP_ID : null;
}

function sayandshapeContextApp(): array {
    $id = sayandshapeContextAppId();
    $app = $id === null ? null : (sayandshapeRawConfig()['apps'][$id] ?? null);
    return is_array($app) ? $app : [];
}

function sayandshapeIsHttps(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

const SAYANDSHAPE_SESSION_DAYS = 14;
function sayandshapeEngineSessionName(): string { return 'SAYANDSHAPE_' . substr(sayandshapeAdminScope(), 0, 16); }

/** Engine sessions live in their own directory so the host's session clean-up does not end them early. */
function sayandshapeSessionStore(bool $engine): void {
    static $hostPath = null;
    if ($hostPath === null) $hostPath = (string) session_save_path();
    if (!$engine) { session_save_path($hostPath); return; }
    $dir = sayandshapeEngineDir() . '/jobs/.sessions';
    if (!is_dir($dir)) @mkdir($dir, 0770, true);
    if (is_dir($dir) && is_writable($dir)) {
        session_save_path($dir);
        ini_set('session.gc_maxlifetime', (string) (SAYANDSHAPE_SESSION_DAYS * 86400));
    }
}

/**
 * Opens an existing session by cookie. Never creates one, so anonymous visitors get no session cookie.
 * It also never sends a cookie: PHP would otherwise set the cookie of a session opened by its ID again on every
 * request, with default attributes. That replaced the login's cookie (14 days, HttpOnly, SameSite) by one that
 * scripts can read and that ends with the browser session, and it did the same to the app's own session cookie.
 */
function sayandshapeOpenSession(string $name, bool $engine): bool {
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    $id = $_COOKIE[$name] ?? null;
    if (!is_string($id) || !preg_match('/^[A-Za-z0-9,-]{16,256}$/D', $id) || headers_sent()) return false;
    sayandshapeSessionStore($engine);
    session_name($name);
    session_id($id);
    return @session_start(['use_cookies' => 0]);
}

/** Who is logged in: ['user' => int, 'app' => ?string]. `app` is the only project this login may touch (null: all). */
function sayandshapeAdminIdentity(): ?array {
    static $identity = false;
    if ($identity !== false) return $identity;
    $identity = null;
    $auth = sayandshapeContextApp()['auth'] ?? [];
    if (is_array($auth) && ($auth['mode'] ?? 'engine') === 'host') {
        $name = $auth['session_name'] ?? null;
        $name = is_string($name) && preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $name) ? $name : session_name();
        $key = is_string($auth['session_key'] ?? null) && $auth['session_key'] !== '' ? $auth['session_key'] : 'admin_logged_in';
        $userKey = is_string($auth['user_key'] ?? null) && $auth['user_key'] !== '' ? $auth['user_key'] : 'user_id';
        if (sayandshapeOpenSession($name, false) && !empty($_SESSION[$key])) {
            $identity = ['user' => (int) ($_SESSION[$userKey] ?? SAYANDSHAPE_DEMO_USER_ID),
                         'app' => !empty($auth['engine_admin']) ? null : sayandshapeContextAppId()];
        }
        // Release the session lock before filesystem/process operations and polling.
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        if ($identity !== null) return $identity;
    }
    if (sayandshapeOpenSession(sayandshapeEngineSessionName(), true)
        && hash_equals(sayandshapeAdminScope(), (string) ($_SESSION['sayandshape_admin'] ?? ''))) {
        $identity = ['user' => SAYANDSHAPE_DEMO_USER_ID, 'app' => null];
    }
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    return $identity;
}

function sayandshapeIsAdmin(): bool { return sayandshapeAdminIdentity() !== null; }

/** May edit the project(s) this login covers. Returns the user ID. */
function sayandshapeRequireAdmin(): int {
    $identity = sayandshapeAdminIdentity();
    if ($identity === null) sayandshapeFail('Not logged in', 401);
    if ($identity['user'] < 1) sayandshapeFail('Invalid user', 403);
    return $identity['user'];
}

function sayandshapeRequireAuth(): int { return sayandshapeRequireAdmin(); }

function sayandshapeIsEngineAdmin(): bool {
    $identity = sayandshapeAdminIdentity();
    return $identity !== null && $identity['app'] === null;
}

/** May configure the engine itself (projects, AI settings): engine login, or a host login with auth.engine_admin. */
function sayandshapeRequireEngineAdmin(): int {
    $user = sayandshapeRequireAdmin();
    if (!sayandshapeIsEngineAdmin()) sayandshapeFail('This requires the SayAndShape login', 403);
    return $user;
}

function sayandshapePasswordHash(): ?string {
    $data = json_decode((string) @file_get_contents(sayandshapeEngineDir() . '/config/auth.json'), true);
    $hash = is_array($data) ? ($data['password_hash'] ?? null) : null;
    return is_string($hash) && $hash !== '' ? $hash : null;
}

/** Failed logins per address: 'check' asks, 'fail' records one, 'ok' clears. True means blocked for now. */
function sayandshapeLoginGuard(string $op): bool {
    $handle = @fopen(sayandshapeEngineDir() . '/jobs/.login-attempts.json', 'c+');
    if (!$handle || !flock($handle, LOCK_EX)) return false;
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '-');
    $data = json_decode((string) stream_get_contents($handle), true);
    $recent = [];
    foreach (is_array($data) ? $data : [] as $key => $times) {
        $times = array_values(array_filter((array) $times, fn($t) => is_int($t) && $t > time() - 600));
        if ($times) $recent[$key] = $times;
    }
    $blocked = count($recent[$ip] ?? []) >= 8;
    if ($op === 'fail' && !$blocked) $recent[$ip][] = time();
    if ($op === 'ok') unset($recent[$ip]);
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($recent));
    flock($handle, LOCK_UN);
    fclose($handle);
    return $blocked;
}

function sayandshapeCookieOptions(int $expires): array {
    return ['expires' => $expires, 'path' => '/', 'samesite' => 'Lax', 'secure' => sayandshapeIsHttps()];
}

/** Engine login with the shared password. Returns '' on success, otherwise the message to show. */
function sayandshapeLogin(string $password): string {
    $hash = sayandshapePasswordHash();
    if ($hash === null) return sayandshapeT('No password has been set yet. Run on the server: bin/sayandshape passwd');
    if (sayandshapeLoginGuard('check')) return sayandshapeT('Too many failed attempts. Please try again in a few minutes.');
    if (!password_verify($password, $hash)) {
        sayandshapeLoginGuard('fail');
        usleep(300000);
        return sayandshapeT('Wrong password.');
    }
    sayandshapeLoginGuard('ok');
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    sayandshapeSessionStore(true);
    foreach (glob(sayandshapeEngineDir() . '/jobs/.sessions/sess_*') ?: [] as $old) {
        if (@filemtime($old) < time() - SAYANDSHAPE_SESSION_DAYS * 86400) @unlink($old);
    }
    $life = SAYANDSHAPE_SESSION_DAYS * 86400;
    session_name(sayandshapeEngineSessionName());
    session_set_cookie_params(['lifetime' => $life, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => sayandshapeIsHttps()]);
    session_id(session_create_id());
    if (!@session_start(['use_cookies' => 1])) return sayandshapeT('Login could not be saved (write permission on jobs/?)');
    $_SESSION['sayandshape_admin'] = sayandshapeAdminScope();
    session_write_close();
    // Not a secret: it only tells the router that showing the panel is worthwhile. The API does the real check.
    setcookie('sayandshape_ui', '1', sayandshapeCookieOptions(time() + $life));
    return '';
}

function sayandshapeLogout(): void {
    if (sayandshapeOpenSession(sayandshapeEngineSessionName(), true)) {
        $_SESSION = [];
        session_destroy();
    }
    setcookie(sayandshapeEngineSessionName(), '', ['httponly' => true] + sayandshapeCookieOptions(1));
    setcookie('sayandshape_ui', '', sayandshapeCookieOptions(1));
}

function sayandshapeJsonResponse(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
}

/** Ends the request with an error. $message is English with {name} placeholders for $vars; it is sent in the interface language. */
function sayandshapeFail(string $message, int $status = 400, array $vars = []): never {
    sayandshapeJsonResponse(['success' => false, 'message' => sayandshapeT($message, $vars)], $status);
    exit;
}

/** Same host (any scheme, so TLS-terminating proxies work) or an origin listed under allowed_origins. */
function sayandshapeOriginAllowed(string $origin): bool {
    $origin = strtolower(rtrim($origin, '/'));
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if ($host !== '' && in_array($origin, ["https://$host", "http://$host"], true)) return true;
    $extra = array_merge((array) (sayandshapeRawConfig()['allowed_origins'] ?? []), (array) (sayandshapeContextApp()['allowed_origins'] ?? []));
    foreach ($extra as $allowed) {
        if (is_string($allowed) && strtolower(rtrim($allowed, '/')) === $origin) return true;
    }
    return false;
}

function sayandshapeBody(): array {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        sayandshapeFail('POST required', 405);
    }
    // Protection against cross-site requests: only real JSON requests (a foreign form cannot send
    // application/json) and, if the browser sends an Origin, only from this site itself.
    $type = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if ($type !== 'application/json') sayandshapeFail('Request not allowed', 403);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if ($origin !== null && !sayandshapeOriginAllowed((string) $origin)) sayandshapeFail('Request not allowed', 403);
    $raw = file_get_contents('php://input', false, null, 0, 65537);
    if (strlen($raw) > 65536) sayandshapeFail('Request too large', 413);
    $data = json_decode($raw, true);
    if (!is_array($data) || !str_starts_with(ltrim($raw), '{')) sayandshapeFail('Invalid JSON');
    return $data;
}

/** A registered project. A host login is confined to the project it came in through. */
function sayandshapeApp($id): array {
    if (!is_string($id) || !preg_match('/^[a-z0-9_-]+$/D', $id)) sayandshapeFail('Invalid project');
    $apps = sayandshapeLoadAppsConfig()['apps'];
    if (!isset($apps[$id]) || !is_array($apps[$id])) sayandshapeFail('Unknown project');
    $only = sayandshapeAdminIdentity()['app'] ?? null;
    if ($only !== null && $only !== $id) sayandshapeFail('No access to this project', 403);
    return $apps[$id];
}

/* ── Workspaces (variants) ──────────────────────────────────────────── */

function sayandshapePublicSlug(array $app): string {
    $slug = $app['public_workspace'] ?? 'main';
    if (!is_string($slug) || !preg_match(SAYANDSHAPE_SLUG, $slug)) sayandshapeFail('Invalid configuration', 503);
    return $slug;
}

function sayandshapeRegistry(array $app): array {
    $file = rtrim($app['clone_dir'], '/') . '/workspaces.json';
    if (!file_exists($file)) return [];
    $data = json_decode(@file_get_contents($file), true);
    if (!is_array($data) || ($data['version'] ?? null) !== 1 || !is_array($data['workspaces'] ?? null)) {
        sayandshapeFail('Variant registry temporarily unreadable', 503);
    }
    return $data['workspaces'];
}

/** Validates a workspace slug and returns it. The public workspace always exists (created lazily by the worker). */
function sayandshapeWorkspace(array $app, $slug): string {
    if (!is_string($slug) || !preg_match(SAYANDSHAPE_SLUG, $slug)) sayandshapeFail('Invalid variant');
    if ($slug === sayandshapePublicSlug($app)) return $slug;
    $registry = sayandshapeRegistry($app);
    if (isset($registry[$slug]) || is_dir(rtrim($app['clone_dir'], '/') . "/$slug/.git")) return $slug;
    sayandshapeFail('Variant not found', 404);
}

function sayandshapeWorkspaceDir(array $app, string $slug): string {
    return rtrim($app['clone_dir'], '/') . '/' . $slug;
}

function sayandshapeSlugify(string $name): string {
    $text = mb_strtolower(trim($name), 'UTF-8');
    // Transliterate German umlauts in names people type ("Grün" → "gruen").
    $text = str_replace(['ä', 'ö', 'ü', 'ß'], ['ae', 'oe', 'ue', 'ss'], $text);
    $text = trim(preg_replace('/[^a-z0-9]+/', '-', $text), '-');
    $text = trim(substr($text, 0, 40), '-');
    if ($text === '' || in_array($text, SAYANDSHAPE_RESERVED_SLUGS, true) || !preg_match(SAYANDSHAPE_SLUG, $text)) return '';
    return $text;
}

/** Display name chosen in the browser under the shared login; stored with jobs and used as commit author. */
function sayandshapeAuthor(array $body): ?string {
    $author = $body['author'] ?? null;
    if ($author === null || $author === '') return null;
    if (!is_string($author)) sayandshapeFail('Invalid name');
    $author = trim(preg_replace('/[<>\r\n]/', '', $author));
    if ($author === '' || mb_strlen($author, 'UTF-8') > 60) sayandshapeFail('Name must be 1–60 characters');
    return $author;
}

function sayandshapeRunPython(array $args): array {
    $proc = proc_open(['python3', ...$args], [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
    if (!is_resource($proc)) sayandshapeFail('Helper process not available', 503);
    $output = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $exit = proc_close($proc);
    $data = json_decode($output, true);
    if ($exit !== 0 || !is_array($data)) sayandshapeFail('Helper process failed', 503);
    return $data;
}

/** Registry entries with Git facts for one app, merged with the active job per workspace. */
function sayandshapeWorkspaces(string $appId): array {
    $app = sayandshapeApp($appId);
    $data = sayandshapeRunPython([sayandshapeEngineDir() . '/orchestrator/registry.py', 'list',
                              sayandshapeEngineDir() . '/config/apps.json', $appId]);
    $active = sayandshapeActiveJobs($appId);
    foreach ($data['workspaces'] as &$item) {
        $item['active_job'] = $active[$item['slug']] ?? null;
    }
    unset($item);
    $data['pending_forks'] = array_values(array_filter($active, fn($job) => ($job['action'] ?? '') === 'fork'));
    return $data;
}

/* ── Jobs ───────────────────────────────────────────────────────────── */

function sayandshapeAtomicJson(string $path, array $data, bool $pretty = false): void {
    $tmp = tempnam(dirname($path), '.pending-');
    if ($tmp === false) throw new RuntimeException('Temporary file could not be created');
    try {
        $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | ($pretty ? JSON_PRETTY_PRINT : 0));
        if (file_put_contents($tmp, $json) !== strlen($json) || !chmod($tmp, 0660) || !rename($tmp, $path)) {
            throw new RuntimeException('File could not be saved');
        }
    } finally {
        if (file_exists($tmp)) unlink($tmp);
    }
}

function sayandshapeJob($id, int $user): array {
    if (!is_string($id) || !preg_match('/^j_[a-z0-9_]+$/D', $id)) sayandshapeFail('Invalid job ID');
    $job = json_decode(@file_get_contents(sayandshapeEngineDir() . '/jobs/' . $id . '.json'), true);
    // Do not disclose whether another user's job exists.
    if (!is_array($job) || ($job['user_id'] ?? null) !== $user) sayandshapeFail('Job not found', 404);
    sayandshapeApp($job['app_id'] ?? null);
    return $job;
}

function sayandshapeJobStatus(array $job): array {
    $file = sayandshapeEngineDir() . '/jobs/' . $job['job_id'] . '.status.json';
    $status = file_exists($file) ? json_decode(file_get_contents($file), true) : null;
    if (file_exists($file) && !is_array($status)) sayandshapeFail('Job status temporarily not available', 503);
    $status ??= ['job_id' => $job['job_id'], 'status' => 'pending', 'phase' => 'queued'];
    $status['action'] = $job['action'] ?? 'change';
    $status['workspace'] = $job['workspace'] ?? null;
    if (isset($job['author'])) $status['author'] = $job['author'];
    // The request itself, so the panel can show it next to the result and build follow-up answers.
    if (isset($job['transcript'])) $status['prompt'] = $job['transcript'];
    if (isset($job['submitted_at'])) $status['submitted_at'] = $job['submitted_at'];
    if (($job['action'] ?? '') === 'fork') {
        $status['source'] = $job['source'] ?? null;
        $status['name'] = $job['name'] ?? null;
    }
    $status['cancel_requested'] = file_exists(sayandshapeEngineDir() . '/jobs/' . $job['job_id'] . '.cancel');
    return $status;
}

function sayandshapeIsTerminal(array $status): bool {
    return in_array($status['status'] ?? '', ['done', 'failed', 'blocked', 'cancelled'], true);
}

/** All non-terminal jobs of an app, keyed by workspace (one active job per workspace). */
function sayandshapeActiveJobs(string $appId): array {
    $result = [];
    foreach (glob(sayandshapeEngineDir() . '/jobs/j_*.json') as $path) {
        if (str_ends_with($path, '.status.json')) continue;
        $job = json_decode(file_get_contents($path), true);
        if (!is_array($job) || ($job['app_id'] ?? '') !== $appId || !is_string($job['workspace'] ?? null)) continue;
        $status = sayandshapeJobStatus($job);
        if (sayandshapeIsTerminal($status)) continue;
        $result[$job['workspace']] = $status + ['user_id' => $job['user_id'] ?? null, 'submitted_at' => $job['submitted_at'] ?? null,
                                               'prompt' => mb_substr((string) ($job['transcript'] ?? $job['name'] ?? ''), 0, 80, 'UTF-8')];
    }
    return $result;
}

function sayandshapeActiveJob(string $appId, string $workspace): ?array {
    foreach (glob(sayandshapeEngineDir() . '/jobs/j_*.json') as $path) {
        if (str_ends_with($path, '.status.json')) continue;
        $job = json_decode(file_get_contents($path), true);
        if (!is_array($job) || ($job['app_id'] ?? '') !== $appId || ($job['workspace'] ?? null) !== $workspace) continue;
        if (!sayandshapeIsTerminal(sayandshapeJobStatus($job))) return $job;
    }
    return null;
}

function sayandshapeEnqueue(int $user, array $body, string $action): void {
    $appId = $body['app_id'] ?? null;
    $app = sayandshapeApp($appId);
    $workspace = $body['workspace'] ?? null;
    if ($action === 'fork') {
        // The new slug was validated by fork.php; its directory must not exist yet.
        if (!is_string($workspace) || !preg_match(SAYANDSHAPE_SLUG, $workspace)) sayandshapeFail('Invalid variant');
    } else {
        $workspace = sayandshapeWorkspace($app, $workspace);
    }
    if ($action === 'promote') {
        $body['source'] = sayandshapeWorkspace($app, $body['source'] ?? null);
        $busy = sayandshapeActiveJob($appId, $body['source']);
        if ($busy) {
            sayandshapeJsonResponse(['success' => false, 'message' => sayandshapeT('A job is already running in the source variant'), 'job_id' => $busy['job_id']], 409);
            exit;
        }
    }
    $author = sayandshapeAuthor($body);
    $dir = sayandshapeEngineDir() . '/jobs';
    if (!is_dir($dir) && !mkdir($dir, 02775, true)) sayandshapeFail('Queue not available', 503);
    $lock = fopen($dir . '/.enqueue.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) sayandshapeFail('Queue not available', 503);
    try {
        $active = sayandshapeActiveJob($appId, $workspace);
        if ($active) {
            sayandshapeJsonResponse(['success' => false, 'message' => sayandshapeT('A job is already running in this variant'), 'job_id' => $active['job_id']], 409);
            return;
        }
        if ($action === 'fork' && (isset(sayandshapeRegistry($app)[$workspace]) || is_dir(sayandshapeWorkspaceDir($app, $workspace)))) {
            sayandshapeFail('A variant with this name already exists', 409);
        }
        $id = 'j_' . time() . '_' . $user . '_' . bin2hex(random_bytes(8));
        $job = ['job_id' => $id, 'user_id' => $user, 'app_id' => $appId, 'workspace' => $workspace, 'action' => $action,
                'submitted_at' => gmdate('c'), 'status' => 'pending'];
        if ($author !== null) $job['author'] = $author;
        if ($action === 'baseline') $job['expected_head'] = $body['expected_head'];
        if ($action === 'change' || $action === 'discuss') $job['transcript'] = $body['transcript'];
        if ($action === 'rollback') {
            $job['commit_hash'] = $body['commit_hash'];
            $job['expected_head'] = $body['expected_head'];
        }
        if ($action === 'fork') {
            $job['source'] = $body['source'];
            $job['name'] = $body['name'];
        }
        if ($action === 'promote') $job['source'] = $body['source'];
        if ($action === 'rename') $job['name'] = $body['name'];
        sayandshapeAtomicJson($dir . '/' . $id . '.json', $job);
        sayandshapeJsonResponse(['success' => true, 'job_id' => $id, 'workspace' => $workspace], 202);
    } catch (Throwable $e) {
        sayandshapeJsonResponse(['success' => false, 'message' => sayandshapeT('Job could not be saved')], 503);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function sayandshapeRollbackPolicy(string $appId, string $workspace, ?string $hash = null): array {
    $app = sayandshapeApp($appId);
    $clone = sayandshapeWorkspaceDir($app, $workspace);
    if (!is_dir($clone . '/.git')) {
        return ['success' => true, 'allowed' => false, 'reason' => sayandshapeT('No change history yet'), 'commits' => [], 'archives' => [], 'active_count' => 0];
    }
    $script = sayandshapeEngineDir() . '/orchestrator/rollback_policy.py';
    $cache = sayandshapeEngineDir() . '/jobs/.rollback-policy-' . $appId . '-' . $workspace . '.json';
    $args = [$script, $hash === null ? 'history' : 'check', $clone, $cache];
    if ($hash !== null) $args[] = $hash;
    $proc = proc_open(['python3', ...$args], [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
    if (!is_resource($proc)) sayandshapeFail('Dependencies could not be checked', 503);
    $output = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $exit = proc_close($proc);
    $data = json_decode($output, true);
    if ($exit !== 0 || !is_array($data)) sayandshapeFail('Dependencies could not be checked', 503);
    return $data;
}

/* ── Discuss (chat per variant) ─────────────────────────────────────── */

function sayandshapeChatPath(string $appId, string $workspace): string {
    return sayandshapeEngineDir() . '/jobs/.chat-' . $appId . '-' . $workspace . '.json';
}

/** Stored exchanges of a variant's discussion; written by the worker, cleared from the panel. */
function sayandshapeChat(string $appId, string $workspace): array {
    $data = json_decode((string) @file_get_contents(sayandshapeChatPath($appId, $workspace)), true);
    $messages = is_array($data) && is_array($data['messages'] ?? null) ? $data['messages'] : [];
    return array_values(array_filter($messages, 'is_array'));
}
