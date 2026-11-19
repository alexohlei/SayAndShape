<?php
// Facts about a directory on this server for the setup page: size, file count, large subfolders, entry file.
require_once __DIR__ . '/auth.php';
sayandshapeRequireEngineAdmin();
$body = sayandshapeBody();
$path = $body['path'] ?? null;
if (!is_string($path) || $path === '' || $path[0] !== '/') sayandshapeFail('Folder must be an absolute path');
$real = realpath($path);
if ($real === false || !is_dir($real)) sayandshapeFail('Folder not found', 404);
if (!is_readable($real)) sayandshapeFail('Folder not readable', 403);

function sayandshapeWalk(string $dir, int &$seen, int $limit): array {
    $files = 0; $bytes = 0;
    try {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
                                                  RecursiveIteratorIterator::LEAVES_ONLY, RecursiveIteratorIterator::CATCH_GET_CHILD);
        foreach ($iterator as $entry) {
            if (++$seen > $limit) break;
            if ($entry->isFile() && !$entry->isLink()) { $files++; $bytes += $entry->getSize(); }
        }
    } catch (Throwable $e) { /* unreadable subtree: report what was counted */ }
    return [$files, $bytes];
}

$seen = 0; $limit = 200000; $files = 0; $bytes = 0; $dirs = [];
foreach (scandir($real) ?: [] as $entry) {
    if ($entry === '.' || $entry === '..' || $entry === '.git') continue;
    $full = "$real/$entry";
    if (is_link($full)) continue;
    if (is_dir($full)) {
        [$n, $b] = sayandshapeWalk($full, $seen, $limit);
        $dirs[] = ['name' => $entry, 'files' => $n, 'bytes' => $b];
        $files += $n; $bytes += $b;
    } elseif (is_file($full)) { $files++; $bytes += filesize($full); }
}
usort($dirs, fn($a, $b) => $b['bytes'] <=> $a['bytes']);
$index = null;
foreach (['index.php', 'index.html'] as $candidate) if (file_exists("$real/$candidate")) { $index = $candidate; break; }
$dataNames = ['media', 'uploads', 'upload', 'content', 'import', 'images', 'img', 'videos', 'photos', 'files', 'storage', 'cache'];
$suggested = [];
foreach ($dirs as $dir) {
    if ($dir['bytes'] > 10 * 1024 * 1024 || in_array(strtolower($dir['name']), $dataNames, true)) $suggested[] = $dir['name'];
}
sayandshapeJsonResponse(['success' => true, 'path' => $real, 'files' => $files, 'bytes' => $bytes, 'dirs' => array_slice($dirs, 0, 12),
    'index' => $index, 'git' => is_dir("$real/.git"), 'suggested_shared' => $suggested, 'truncated' => $seen > $limit]);
