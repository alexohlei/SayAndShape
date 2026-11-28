<?php
/**
 * SayAndShape front controller for one project.
 *
 * Included by the project's sayandshape-router.php stub (written by `bin/sayandshape add`), which defines
 * SAYANDSHAPE_APP_ID and SAYANDSHAPE_ENGINE_DIR. Works as the router script of `php -S` and behind the
 * Apache/Nginx rules that `bin/sayandshape add` generates.
 *
 *   {mount}/sayandshape/login/     engine login
 *   {mount}/sayandshape/setup/     project setup page
 *   {mount}/sayandshape/api/*.php  API
 *   {mount}/sayandshape/widget/*   panel assets
 *   {mount}/w/{slug}/…         a variant
 *   {mount}/…                  serve "root": the public variant; serve "prefix": the app itself
 *
 * {mount} is the URL path the project lives under ('' at the domain root).
 *
 * Cache buster: HTML pages get a version appended to the addresses of their own stylesheets, scripts, images and
 * media. It names the file's change time and the variant's cache version, which the worker counts up with every
 * publication (?v=N-mtime; ?v=mtime before the first one; ?v=N for a file that cannot be found). A version the
 * page already carries (?v=2025) is replaced for files of the site, so a change also shows on pages that version
 * by hand, and changes made outside SayAndShape count too. Every file is sent with "Cache-Control: no-cache", so
 * browsers ask again and get a short 304 while a file is unchanged.
 */

const SAYANDSHAPE_RT_SLUG = '[a-z0-9][a-z0-9-]{0,39}';
const SAYANDSHAPE_RT_TYPES = [
    'html' => 'text/html; charset=utf-8', 'htm' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8', 'json' => 'application/json',
    'map' => 'application/json', 'xml' => 'application/xml', 'txt' => 'text/plain; charset=utf-8', 'csv' => 'text/csv; charset=utf-8',
    'md' => 'text/markdown; charset=utf-8', 'webmanifest' => 'application/manifest+json', 'wasm' => 'application/wasm',
    'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp',
    'avif' => 'image/avif', 'svg' => 'image/svg+xml', 'ico' => 'image/x-icon', 'bmp' => 'image/bmp',
    'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'otf' => 'font/otf', 'eot' => 'application/vnd.ms-fontobject',
    'mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime', 'ogv' => 'video/ogg',
    'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'ogg' => 'audio/ogg', 'wav' => 'audio/wav', 'flac' => 'audio/flac',
    'pdf' => 'application/pdf', 'zip' => 'application/zip', 'vtt' => 'text/vtt', 'ics' => 'text/calendar',
];
/** File types whose addresses get the cache version: what a page loads, not what it links to. */
const SAYANDSHAPE_RT_ASSETS = 'css|js|mjs|webmanifest|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot'
    . '|mp4|m4v|webm|mov|ogv|mp3|m4a|ogg|wav|flac|vtt';

/** Plain-text status response; $text is English and is sent in the interface language (api/i18n.php). */
function sayandshapeRtStatus(int $code, string $text): bool {
    require_once dirname(__DIR__) . '/api/i18n.php';
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo sayandshapeT($text);
    return true;
}

function sayandshapeRtRedirect(string $path, int $code): bool {
    $query = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_QUERY);
    header('Location: ' . str_replace('%2F', '/', rawurlencode($path)) . ($query !== '' ? "?$query" : ''), true, $code);
    return true;
}

/** Adds the panel's script tag before </body>. Pages that already carry it stay as they are. */
function sayandshapeRtInject(string $html, string $tag): string {
    if (stripos($html, 'sayandshape-widget.js') !== false) return $html;
    $at = strripos($html, '</body>');
    return $at === false ? $html : substr($html, 0, $at) . $tag . "\n" . substr($html, $at);
}

/** A variant's cache version (0: none yet). The worker writes it into the variant's .git folder. */
function sayandshapeRtVersion(string $root): int {
    $text = @file_get_contents("$root/.git/sayandshape-cache-version");
    return is_string($text) && preg_match('/^\s*(\d{1,9})\s*$/', $text, $m) ? (int) $m[1] : 0;
}

/**
 * Where the cache buster looks for the files a page loads: the variant folder, the app folder for shared
 * directories, the URL paths the variant answers under and the folder of the page's address.
 */
function sayandshapeRtBustContext(int $version, string $root, string $base, array $shared, string $urlRoot, string $mount, string $sub): array {
    $pageDir = str_ends_with($sub, '/') ? rtrim($sub, '/') : rtrim(dirname($sub), '/');
    $shared = array_values(array_filter(array_map(static fn($dir): string => trim((string) $dir, '/'), $shared), 'strlen'));
    return ['version' => $version, 'root' => $root, 'base' => $base, 'shared' => $shared,
            'url' => $urlRoot, 'mount' => $mount, 'dir' => $pageDir];
}

/** The file of the site an address names (relative or root-absolute), or null. Never a file outside the site. */
function sayandshapeRtAssetFile(string $path, array $ctx): ?string {
    $path = rawurldecode(html_entity_decode($path, ENT_QUOTES | ENT_HTML5));
    if ($path === '' || str_contains($path, "\0") || str_contains($path, '\\')) return null;
    if ($path[0] === '/') {
        if ($ctx['url'] !== '' && str_starts_with($path, $ctx['url'] . '/')) $path = substr($path, strlen($ctx['url']));
        elseif ($ctx['mount'] === '' || str_starts_with($path, $ctx['mount'] . '/')) $path = substr($path, strlen($ctx['mount']));
        else return null;                                                               // outside this project
    } else {
        $path = $ctx['dir'] . '/' . $path;
    }
    $parts = [];
    foreach (explode('/', $path) as $segment) {
        if ($segment === '' || $segment === '.') continue;
        if ($segment === '..') { if (!$parts) return null; array_pop($parts); continue; }
        if ($segment[0] === '.') return null;                                           // never dotfiles or .git
        $parts[] = $segment;
    }
    if (!$parts) return null;
    $rel = implode('/', $parts);
    $roots = [$ctx['root']];
    if ($ctx['base'] !== '' && $ctx['base'] !== $ctx['root']) {
        foreach ($ctx['shared'] as $dir) {
            if (str_starts_with("$rel/", "$dir/")) { $roots[] = $ctx['base']; break; }
        }
    }
    foreach ($roots as $root) {
        $real = realpath($root);
        $file = $real === false ? false : realpath("$real/$rel");
        if ($file !== false && str_starts_with($file, "$real/") && is_file($file)) return $file;
    }
    return null;
}

/** One address with its version, if it names a file of this site that a page loads. */
function sayandshapeRtBustUrl(string $url, array $ctx): string {
    if ($url === '' || preg_match('~^\s*(?:[a-z][a-z0-9+.-]*:|//|#)~i', $url)) return $url;     // other sites, data:, anchors
    [$rest, $fragment] = array_pad(explode('#', $url, 2), 2, null);
    [$path, $query] = array_pad(explode('?', $rest, 2), 2, null);
    if (!preg_match('~\.(?:' . SAYANDSHAPE_RT_ASSETS . ')$~i', $path)) return $url;
    $file = sayandshapeRtAssetFile($path, $ctx);
    $version = $ctx['version'];
    if ($file !== null) $stamp = ($version > 0 ? "$version-" : '') . filemtime($file);
    elseif ($version > 0) $stamp = (string) $version;
    else return $url;
    $query ??= '';
    if (preg_match('~(?:^|&|&amp;)v=~i', $query)) {
        if ($file === null) return $url;                     // an address the site versions itself and we cannot check
        $query = preg_replace('~(^|&amp;|&)v=[^&]*~i', '${1}v=' . $stamp, $query, 1);
    } else {
        $query = ($query !== '' ? $query . '&amp;' : '') . "v=$stamp";
    }
    return $path . '?' . $query . ($fragment !== null ? "#$fragment" : '');
}

/**
 * Cache buster for a page: href/src/poster of <link>, <script>, <img>, <source>, <video>, <audio> and <track> get ?v=….
 * Module scripts stay as they are: the same module under two addresses would be loaded and run twice.
 */
function sayandshapeRtBust(string $html, array $ctx): string {
    $out = preg_replace_callback('~<(?:link|script|img|source|video|audio|track)\b[^>]*>~i', static function (array $tag) use ($ctx): string {
        if (preg_match('~\s(?:type\s*=\s*["\']?module|rel\s*=\s*["\']?modulepreload)\b~i', $tag[0])) return $tag[0];
        return preg_replace_callback('~(\s(?:href|src|poster)\s*=\s*)(["\'])(.*?)\2~is',
            static fn(array $m): string => $m[1] . $m[2] . sayandshapeRtBustUrl($m[3], $ctx) . $m[2], $tag[0]) ?? $tag[0];
    }, $html);
    return $out ?? $html;
}

/** Output filter for PHP pages: only HTML responses get the cache buster and the panel's tag. */
function sayandshapeRtFilterOutput(string $output, ?string $tag, array $ctx): string {
    foreach (headers_list() as $header) {
        if (stripos($header, 'Content-Type:') === 0 && stripos($header, 'text/html') === false) return $output;
    }
    $html = sayandshapeRtBust($output, $ctx);
    if ($tag !== null) $html = sayandshapeRtInject($html, $tag);
    if ($html !== $output && !headers_sent()) header_remove('Content-Length');     // the page's own length no longer fits
    return $html;
}

/** Static file with conditional requests and byte ranges (video seeking). Browsers revalidate it on every use. */
function sayandshapeRtSend(string $file, ?string $tag, ?array $ctx = null): bool {
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $type = SAYANDSHAPE_RT_TYPES[$ext] ?? 'application/octet-stream';
    $head = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD';
    $page = $ext === 'html' || $ext === 'htm';
    header('Content-Type: ' . $type);
    header('Cache-Control: no-cache');
    $match = $_SERVER['HTTP_IF_NONE_MATCH'] ?? null;
    if ($page) {
        // A page changes with the files it loads, the cache version and the panel's tag, not only with its own
        // file: its ETag is taken from what is sent.
        $html = (string) file_get_contents($file);
        if ($ctx !== null) $html = sayandshapeRtBust($html, $ctx);
        if ($tag !== null) $html = sayandshapeRtInject($html, $tag);
        $etag = '"' . substr(md5($html), 0, 20) . '"';
        header('ETag: ' . $etag);
        header('Vary: Cookie');                      // with or without the panel: the login decides
        if ($match !== null && trim($match) === $etag) {
            http_response_code(304);
            return true;
        }
        header('Content-Length: ' . strlen($html));
        if (!$head) echo $html;
        return true;
    }
    $size = filesize($file);
    $mtime = filemtime($file);
    $etag = '"' . dechex($mtime) . '-' . dechex($size) . '"';
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
    header('Accept-Ranges: bytes');
    $since = $_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? null;
    if ($match !== null ? trim($match) === $etag : ($since !== null && strtotime($since) >= $mtime)) {
        http_response_code(304);
        return true;
    }
    $start = 0;
    $end = $size - 1;
    if ($size > 0 && preg_match('/^bytes=(\d*)-(\d*)$/', (string) ($_SERVER['HTTP_RANGE'] ?? ''), $m) && ($m[1] !== '' || $m[2] !== '')) {
        if ($m[1] === '') { $start = max(0, $size - (int) $m[2]); }
        else { $start = (int) $m[1]; if ($m[2] !== '') $end = min($end, (int) $m[2]); }
        if ($start > $end) {
            header("Content-Range: bytes */$size");
            http_response_code(416);
            return true;
        }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    if ($head) return true;
    while (ob_get_level() > 0) ob_end_clean();
    $handle = fopen($file, 'rb');
    fseek($handle, $start);
    $left = $end - $start + 1;
    while ($left > 0 && !feof($handle) && !connection_aborted()) {
        $chunk = fread($handle, (int) min(262144, $left));
        if ($chunk === false || $chunk === '') break;
        echo $chunk;
        $left -= strlen($chunk);
        flush();
    }
    fclose($handle);
    return true;
}

/** The file a URL path names inside $root, or null. Directories resolve to their index file. */
function sayandshapeRtResolve(string $root, string $sub): ?string {
    $file = rtrim($root . $sub, '/');
    if (is_dir($file)) {
        foreach (['index.php', 'index.html', 'index.htm'] as $index) {
            if (is_file("$file/$index")) return "$file/$index";
        }
        return null;
    }
    return is_file($file) ? $file : null;
}

/**
 * Handles the request. Returns true when a response was sent, false when the request is not ours,
 * or ['file' => …, 'tag' => …, 'bust' => …] for a PHP page of the app, which the caller runs in the global scope.
 */
function sayandshapeRoute() {
    $engine = rtrim(SAYANDSHAPE_ENGINE_DIR, '/');
    $appId = SAYANDSHAPE_APP_ID;
    $config = json_decode((string) @file_get_contents("$engine/config/apps.json"), true);
    $app = is_array($config) && is_array($config['apps'][$appId] ?? null) ? $config['apps'][$appId] : null;

    $path = rawurldecode(explode('?', (string) ($_SERVER['REQUEST_URI'] ?? '/'), 2)[0]);
    if ($path === '' || $path[0] !== '/' || str_contains($path, "\0") || str_contains($path, '\\')
        || in_array('..', explode('/', $path), true)) {
        return sayandshapeRtStatus(400, 'Bad request');
    }

    // Where the project is mounted: the rewrite target tells us, otherwise the configured address.
    $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
    if (PHP_SAPI === 'cli-server') $mount = '';
    elseif (str_ends_with($script, '/sayandshape-router.php')) $mount = substr($script, 0, -strlen('/sayandshape-router.php'));
    else $mount = rtrim((string) parse_url((string) ($app['app_url'] ?? ''), PHP_URL_PATH), '/');
    if ($mount !== '' && $path !== $mount && !str_starts_with($path, "$mount/")) return false;
    $rel = substr($path, strlen($mount));
    if ($rel === '') return sayandshapeRtRedirect("$mount/", 301);
    if (!defined('SAYANDSHAPE_MOUNT')) define('SAYANDSHAPE_MOUNT', $mount);
    if ($rel === '/sayandshape-router.php') return sayandshapeRtStatus(404, 'Not found');

    // ── Engine ──
    if ($rel === '/sayandshape' || $rel === '/sayandshape/') return sayandshapeRtRedirect("$mount/sayandshape/login/", 302);
    if ($rel === '/sayandshape/login' || $rel === '/sayandshape/setup') return sayandshapeRtRedirect("$mount$rel/", 301);
    if ($rel === '/sayandshape/login/') { require "$engine/login/index.php"; return true; }
    if ($rel === '/sayandshape/setup/') { require "$engine/setup/index.php"; return true; }
    if (preg_match('#^/sayandshape/api/([a-z_]+\.php)$#', $rel, $m) && is_file("$engine/api/{$m[1]}") && $m[1] !== 'auth.php') {
        require "$engine/api/{$m[1]}";
        return true;
    }
    if (preg_match('#^/sayandshape/widget/([a-zA-Z0-9._-]+)$#', $rel, $m) && $m[1][0] !== '.' && is_file("$engine/widget/{$m[1]}")) {
        return sayandshapeRtSend("$engine/widget/{$m[1]}", null);         // revalidated: an updated panel loads at once
    }
    if (str_starts_with($rel, '/sayandshape/')) return sayandshapeRtStatus(404, 'Not found');
    if ($app === null) return PHP_SAPI === 'cli-server' ? false : sayandshapeRtStatus(503, 'SayAndShape: project not registered');

    // ── Variants ──
    $clones = rtrim((string) ($app['clone_dir'] ?? "$engine/clones/$appId"), '/');
    $base = rtrim((string) ($app['base_dir'] ?? ''), '/');
    $public = is_string($app['public_workspace'] ?? null) && preg_match('#^' . SAYANDSHAPE_RT_SLUG . '$#D', $app['public_workspace'])
        ? $app['public_workspace'] : 'main';
    $rootMode = ($app['serve'] ?? 'root') !== 'prefix';

    if (preg_match('#^/w/' . SAYANDSHAPE_RT_SLUG . '$#D', $rel)) return sayandshapeRtRedirect("$mount$rel/", 301);
    $prefix = '';
    if (preg_match('#^/w/(' . SAYANDSHAPE_RT_SLUG . ')(/.*)$#D', $rel, $m)) {
        [$slug, $sub, $prefix] = [$m[1], $m[2], "/w/{$m[1]}"];
    } elseif ($rootMode) {
        // A root-absolute link or asset (/css/site.css) requested from inside another variant belongs to that variant.
        $referer = parse_url((string) ($_SERVER['HTTP_REFERER'] ?? ''));
        $refHost = is_array($referer) ? strtolower(($referer['host'] ?? '') . (isset($referer['port']) ? ':' . $referer['port'] : '')) : '';
        if ($refHost !== '' && $refHost === strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''))
            && preg_match('#^' . preg_quote($mount, '#') . '/w/(' . SAYANDSHAPE_RT_SLUG . ')/#', (string) ($referer['path'] ?? ''), $m)
            && $m[1] !== $public && is_dir("$clones/{$m[1]}/.git")) {
            return sayandshapeRtRedirect("$mount/w/{$m[1]}$rel", 307);
        }
        [$slug, $sub] = [$public, $rel];
    } else {
        if ($rel === '/') return sayandshapeRtRedirect("$mount/w/$public/", 302);
        return false;
    }

    // Never serve repository data, dotfiles or the router stub from a variant.
    foreach (explode('/', $sub) as $segment) {
        if ($segment !== '' && $segment[0] === '.' && $segment !== '.well-known') return sayandshapeRtStatus(404, 'Not found');
    }
    if ($sub === '/sayandshape-router.php' || $sub === '/sayandshape-router.php.bak') return sayandshapeRtStatus(404, 'Not found');

    $root = "$clones/$slug";
    if (!is_dir("$root/.git")) {
        if ($slug !== $public) return sayandshapeRtStatus(404, 'Variant not found');
        $root = $base;                               // public variant not created yet: show the app itself
    }
    if ($root === '' || !is_dir($root)) return sayandshapeRtStatus(503, 'SayAndShape: project folder not found');
    $version = sayandshapeRtVersion($root);          // of the variant, also for files that come from a shared directory
    $bust = sayandshapeRtBustContext($version, $root, $base, (array) ($app['shared_dirs'] ?? []), $mount . $prefix, $mount, $sub);
    if (is_dir($root . $sub) && !str_ends_with($sub, '/')) return sayandshapeRtRedirect("$mount$prefix$sub/", 301);
    $file = sayandshapeRtResolve($root, $sub);
    if ($file === null && $root !== $base && $base !== '') {
        foreach ((array) ($app['shared_dirs'] ?? []) as $dir) {      // shared directories live in the app, not in the variant
            $dir = trim((string) $dir, '/');
            if ($dir !== '' && str_starts_with(ltrim($sub, '/'), "$dir/") && ($file = sayandshapeRtResolve($base, $sub)) !== null) {
                $root = $base;
                break;
            }
        }
    }
    if ($file === null) return sayandshapeRtStatus(404, 'Not found');

    // The panel is added for people who may edit: with the engine login (hint cookie) or, for projects
    // using the app's own admin session, on every page (the panel then checks the session itself).
    $tag = null;
    $hostAuth = is_array($app['auth'] ?? null) && ($app['auth']['mode'] ?? 'engine') === 'host';
    if (($app['inject_widget'] ?? true) && ($hostAuth || !empty($_COOKIE['sayandshape_ui']))) {
        $tag = '<script src="' . htmlspecialchars("$mount/sayandshape/widget/sayandshape-widget.js", ENT_QUOTES) . '" data-app="'
             . htmlspecialchars($appId, ENT_QUOTES) . '" data-workspace="' . $slug . '"></script>';
    }

    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    if ($ext !== 'php') {
        if (preg_match('/^(phtml|phar|phps|php\d)$/', $ext)) return sayandshapeRtStatus(404, 'Not found');
        return sayandshapeRtSend($file, $tag, $bust);
    }
    // Let the page see itself the way a web server would present it.
    $_SERVER['SCRIPT_FILENAME'] = $file;
    $_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = $mount . $prefix . substr($file, strlen($root));
    if ($mount === '') $_SERVER['DOCUMENT_ROOT'] = $root;
    return ['file' => $file, 'tag' => $tag, 'bust' => $bust];
}

$__sayandshape = sayandshapeRoute();
if (is_array($__sayandshape)) {
    [$__sayandshapeTag, $__sayandshapeBust] = [$__sayandshape['tag'], $__sayandshape['bust']];
    if ($__sayandshapeTag !== null) {
        ob_start(static fn(string $output): string => sayandshapeRtFilterOutput($output, $__sayandshapeTag, $__sayandshapeBust));
    } elseif (stripos((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'text/html') !== false) {
        // Visitors: only page views are filtered (not API calls or event streams), in blocks of 1 MiB so that a
        // page that sends a large file never has to fit into memory. An address cut by a block border stays as it is.
        ob_start(static fn(string $output): string => sayandshapeRtFilterOutput($output, null, $__sayandshapeBust), 1048576);
    }
    $__sayandshapeFile = $__sayandshape['file'];
    unset($__sayandshape);
    chdir(dirname($__sayandshapeFile));      // relative includes resolve inside the variant, not the original app
    require $__sayandshapeFile;
    return true;
}
if ($__sayandshape === false && PHP_SAPI !== 'cli-server') return sayandshapeRtStatus(404, 'Not found');
return $__sayandshape;
