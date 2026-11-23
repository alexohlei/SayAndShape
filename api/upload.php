<?php
// Files attached to a change request in "Edit". GET ?app_id= returns what the project accepts.
// POST with Content-Type application/octet-stream carries one piece of a file in its body:
//   ?app_id=&name=&size=   first piece; the answer names the upload's id and the name it is stored under
//   ?id=&offset=           next piece, offset = bytes received so far (409 with `received` if it does not fit)
//   ?id=&remove=1          discard the upload
// Files live in jobs/.uploads/ as <id>.bin with their facts in <id>.json. submit.php attaches finished uploads to a
// job and the worker hands them to the agent. Pieces keep every request below the limits of PHP (post_max_size) and
// Nginx (client_max_body_size), so no server setting has to change for large files.
require_once __DIR__ . '/auth.php';
$user = sayandshapeRequireAdmin();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $limits = sayandshapeUploadLimits(sayandshapeApp($_GET['app_id'] ?? null));
    sayandshapeJsonResponse(['success' => true] + $limits + ['chunk_bytes' => SAYANDSHAPE_UPLOAD_CHUNK]);
    exit;
}

sayandshapeRequirePost('application/octet-stream');
const SAYANDSHAPE_UPLOAD_PIECE = 8388608;   // largest piece accepted; the panel sends SAYANDSHAPE_UPLOAD_CHUNK
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > SAYANDSHAPE_UPLOAD_PIECE) sayandshapeFail('Request too large', 413);
$dir = sayandshapeUploadDir();

if (isset($_GET['id'])) {
    $meta = sayandshapeUploadMeta($_GET['id']);
    // Do not disclose whether another user's upload exists.
    if ($meta === null || ($meta['user_id'] ?? null) !== $user) sayandshapeFail('Upload not found', 404);
    sayandshapeApp($meta['app_id'] ?? null);
    if (!empty($_GET['remove'])) {
        @unlink("$dir/{$meta['id']}.bin");
        @unlink("$dir/{$meta['id']}.json");
        sayandshapeJsonResponse(['success' => true, 'removed' => $meta['id']]);
        exit;
    }
    $offset = $_GET['offset'] ?? '';
    if (!is_string($offset) || !ctype_digit($offset)) sayandshapeFail('Invalid upload');
    $offset = (int) $offset;
} else {
    $appId = $_GET['app_id'] ?? null;
    $limits = sayandshapeUploadLimits(sayandshapeApp($appId));
    if ($limits['max_files'] < 1) sayandshapeFail('Uploads are switched off for this project', 403);
    $name = is_string($_GET['name'] ?? null) ? sayandshapeUploadName($_GET['name'], $limits['types']) : null;
    if ($name === null) sayandshapeFail('This file type is not allowed here', 415);
    $size = $_GET['size'] ?? '';
    if (!is_string($size) || !ctype_digit($size) || strlen($size) > 12) sayandshapeFail('Invalid upload');
    $size = (int) $size;
    if ($size < 1) sayandshapeFail('The file is empty');
    if ($size > $limits['max_bytes']) sayandshapeFail('The file is too large (max. {max} MB)', 413, ['max' => intdiv($limits['max_bytes'], 1048576)]);
    if (!is_dir($dir)) {
        @mkdir($dir, 0770, true);
        @chmod($dir, 02770);   // like jobs/: new files inherit the group, so the worker of another user can read and remove them
    }
    // Uploads nobody sent a job with: files and facts go together, judged by the facts' age.
    foreach (glob("$dir/u_*.bin") ?: [] as $old) {
        $facts = substr($old, 0, -4) . '.json';
        if ((int) @filemtime(is_file($facts) ? $facts : $old) < time() - SAYANDSHAPE_UPLOAD_HOURS * 3600) {
            @unlink($old);
            @unlink($facts);
        }
    }
    $meta = ['id' => 'u_' . time() . '_' . $user . '_' . bin2hex(random_bytes(8)), 'user_id' => $user, 'app_id' => $appId,
             'name' => $name, 'size' => $size, 'complete' => false, 'created_at' => gmdate('c')];
    $offset = 0;
    try {
        if (!is_dir($dir) || !touch("$dir/{$meta['id']}.bin") || !chmod("$dir/{$meta['id']}.bin", 0660)) throw new RuntimeException('File could not be saved');
        sayandshapeAtomicJson("$dir/{$meta['id']}.json", $meta);
    } catch (Throwable $e) {
        @unlink("$dir/{$meta['id']}.bin");
        sayandshapeFail('Upload could not be saved (write permission on jobs/?)', 503);
    }
}

$out = @fopen("$dir/{$meta['id']}.bin", 'c+b');
if (!$out || !flock($out, LOCK_EX)) sayandshapeFail('Upload could not be saved (write permission on jobs/?)', 503);
try {
    $have = (int) fstat($out)['size'];
    if ($offset !== $have) {
        // A piece whose answer got lost, or one out of order: the panel continues at `received`.
        sayandshapeJsonResponse(['success' => false, 'message' => sayandshapeT('Upload out of order'), 'id' => $meta['id'],
                                 'received' => $have, 'complete' => $have === $meta['size']], 409);
        exit;
    }
    $room = min(SAYANDSHAPE_UPLOAD_PIECE, $meta['size'] - $have);
    $in = fopen('php://input', 'rb');
    fseek($out, 0, SEEK_END);
    $copied = $in ? (int) stream_copy_to_stream($in, $out, $room + 1) : 0;
    if ($copied > $room || ($copied === 0 && $room > 0)) {
        ftruncate($out, $have);
        sayandshapeFail('Invalid upload');   // more data than announced, or a piece without data
    }
    if (!fflush($out)) {
        ftruncate($out, $have);
        sayandshapeFail('Upload could not be saved (write permission on jobs/?)', 503);
    }
    $have += $copied;
    if ($have === $meta['size'] && empty($meta['complete'])) {
        $meta['complete'] = true;
        sayandshapeAtomicJson("$dir/{$meta['id']}.json", $meta);
    }
    sayandshapeJsonResponse(['success' => true, 'id' => $meta['id'], 'name' => $meta['name'], 'size' => $meta['size'],
                             'received' => $have, 'complete' => $have === $meta['size']]);
} catch (Throwable $e) {
    sayandshapeJsonResponse(['success' => false, 'message' => sayandshapeT('Upload could not be saved (write permission on jobs/?)')], 503);
} finally {
    flock($out, LOCK_UN);
    fclose($out);
}
