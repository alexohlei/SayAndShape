<?php
/**
 * SayAndShape login: the engine's own sign-in for projects without (or besides) an admin area of their own.
 * Reached through a project's router at {mount}/sayandshape/login/. One shared password per engine,
 * set on the server with `bin/sayandshape passwd`.
 */
require_once dirname(__DIR__) . '/api/auth.php';

$mount = defined('SAYANDSHAPE_MOUNT') ? SAYANDSHAPE_MOUNT : '';
$app = sayandshapeContextApp();
$public = is_string($app['public_workspace'] ?? null) ? $app['public_workspace'] : 'main';
$home = ($app['serve'] ?? 'root') === 'prefix' ? "$mount/w/$public/" : "$mount/";
$error = '';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if ($origin !== null && !sayandshapeOriginAllowed((string) $origin)) {
        http_response_code(403);
        $error = sayandshapeT('Request not allowed.');
    } elseif (isset($_POST['logout'])) {
        sayandshapeLogout();
        header("Location: $mount/sayandshape/login/", true, 303);
        return;
    } else {
        $error = sayandshapeLogin((string) ($_POST['password'] ?? ''));
        if ($error === '') {
            header("Location: $home", true, 303);
            return;
        }
        http_response_code(401);
    }
}

$loggedIn = sayandshapeIsAdmin();
$engineAdmin = sayandshapeIsEngineAdmin();
$hasPassword = sayandshapePasswordHash() !== null;
$name = (string) ($app['name'] ?? sayandshapeContextAppId() ?? 'SayAndShape');
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Frame-Options: DENY');
$e = fn(string $text): string => htmlspecialchars($text, ENT_QUOTES);
$t = fn(string $text, array $html = []): string => sayandshapeTHtml($text, $html);
?>
<!DOCTYPE html>
<html lang="<?= $e(sayandshapeLanguage()) ?>">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>SayAndShape · <?= $t('Login') ?></title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: #F4F4F5; color: #18181B;
         font: 14px/1.5 Inter, system-ui, -apple-system, sans-serif; }
  main { width: 100%; max-width: 380px; background: #fff; border: 1px solid #E4E4E7; border-radius: 14px; padding: 28px;
         display: flex; flex-direction: column; gap: 14px; }
  h1 { margin: 0; font-size: 18px; }
  p { margin: 0; color: #52525B; font-size: 13px; }
  label { font-size: 12px; font-weight: 600; color: #3F3F46; }
  input { width: 100%; margin-top: 6px; padding: 10px 12px; border: 1px solid #D4D4D8; border-radius: 9px; font: inherit; }
  input:focus { outline: 2px solid #EEF2FF; border-color: #4F46E5; }
  button, .btn { display: block; width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid #4F46E5; background: #4F46E5;
                 color: #fff; font: inherit; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
  button:hover, .btn:hover { background: #4338CA; }
  .plain { background: #fff; color: #3F3F46; border-color: #D4D4D8; }
  .plain:hover { background: #F4F4F5; }
  .bad { padding: 9px 12px; border-radius: 9px; background: #FEE2E2; color: #B91C1C; font-size: 12.5px; }
  .note { padding: 9px 12px; border-radius: 9px; background: #FEF3C7; color: #92400E; font-size: 12.5px; }
  code { font-size: 12px; }
  form { display: flex; flex-direction: column; gap: 14px; }
</style>
</head>
<body>
<main>
  <h1>SayAndShape · <?= $e($name) ?></h1>
<?php if ($error !== ''): ?>
  <div class="bad" role="alert"><?= $e($error) ?></div>
<?php endif; ?>
<?php if ($loggedIn): ?>
  <p><?= $t('You are logged in. The round helper button appears at the bottom right of the pages.') ?></p>
  <a class="btn" href="<?= $e($home) ?>"><?= $t('Go to the site') ?></a>
<?php if ($engineAdmin): ?>
  <a class="btn plain" href="<?= $e("$mount/sayandshape/setup/") ?>"><?= $t('Setup') ?></a>
  <form method="post"><button class="plain" name="logout" value="1"><?= $t('Log out') ?></button></form>
<?php else: ?>
  <p><?= $t("Logged in through the app's admin area. You can log out there.") ?></p>
<?php endif; ?>
<?php else: ?>
<?php if (!$hasPassword): ?>
  <div class="note"><?= $t('No password has been set yet. Run this on the server: {command}', ['command' => '<code>bin/sayandshape passwd</code>']) ?></div>
<?php endif; ?>
  <p><?= $t('Once logged in, you can change the pages by text or voice. Visitors see none of this.') ?></p>
  <form method="post" autocomplete="off">
    <div><label for="password"><?= $t('Password') ?></label>
      <input id="password" name="password" type="password" required autofocus autocomplete="current-password"></div>
    <button type="submit"><?= $t('Log in') ?></button>
  </form>
<?php endif; ?>
</main>
</body>
</html>
