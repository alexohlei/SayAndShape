<?php
/**
 * SayAndShape setup page: register and configure projects (apps) without editing JSON by hand.
 * Reached through a project's router at {mount}/sayandshape/setup/. Requires the SayAndShape login
 * (or a host admin session with auth.engine_admin), because projects here are folders on this server.
 * Reads and writes config/apps.json through api/apps.php; inspects folders through api/inspect_dir.php.
 */
require_once dirname(__DIR__) . '/api/auth.php';
$loggedIn = sayandshapeIsEngineAdmin();
$engineDir = sayandshapeEngineDir();
$language = sayandshapeLanguage();
$t = fn(string $text, array $html = []): string => sayandshapeTHtml($text, $html);
// Texts the page script shows, in the interface language (English text → shown text, see api/i18n.php).
$scriptTexts = ['Request failed', 'Remove {value}', 'Edit project: {name}', 'Add project', 'Save', 'Create project', 'Folder not found.',
    'Absolute path. “Check” shows the size, files and large folders.', '/path/to/project', 'No projects set up yet.',
    '{n} variant', '{n} variants', '{n} in progress', 'nothing running', 'folder missing', 'Edit', 'Open app',
    'Service running', 'Service not running', 'Checking…', 'Folder found · {files} files · {mb} MB', '{index} present',
    'no index.php/index.html', 'contains .git', 'Saved.',
    'Remove the project “{id}” from SayAndShape? The files of the app and its variants stay on the server.', 'Project removed.',
    'Low', 'Medium', 'High', 'Very high', 'Maximum', 'Other ID…', 'Saved: {engine} · {model}'];
$scriptTable = [];
foreach ($scriptTexts as $text) $scriptTable[$text] = sayandshapeT($text);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Frame-Options: SAMEORIGIN');
?>
<!DOCTYPE html>
<html lang="<?= $language ?>">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SayAndShape · <?= $t('Setup') ?></title>
<style>
  :root { --rs-accent: #4F46E5; --rs-accent-soft: #EEF2FF; --rs-text: #18181B; --rs-muted: #52525B; --rs-faint: #71717A;
          --rs-border: #E4E4E7; --rs-bg: #F4F4F5; --rs-card: #FFFFFF; --rs-ok: #166534; --rs-ok-bg: #DCFCE7; --rs-warn: #92400E; --rs-warn-bg: #FEF3C7; --rs-danger: #B91C1C; }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--rs-bg); color: var(--rs-text); font: 14px/1.5 Inter, system-ui, -apple-system, sans-serif; }
  header { display: flex; align-items: center; gap: 14px; padding: 14px 24px; background: var(--rs-card); border-bottom: 1px solid var(--rs-border); flex-wrap: wrap; }
  header strong { font-size: 15px; }
  header .sub { color: var(--rs-faint); font-size: 13px; }
  .pill { padding: 4px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; }
  .pill-warn { background: var(--rs-warn-bg); color: var(--rs-warn); }
  .pill-ok { background: var(--rs-ok-bg); color: var(--rs-ok); }
  .pill-bad { background: #FEE2E2; color: var(--rs-danger); }
  .spacer { flex: 1; }
  main { display: flex; flex-wrap: wrap; gap: 24px; padding: 24px; max-width: 1240px; }
  aside { flex: 1 1 300px; display: flex; flex-direction: column; gap: 10px; }
  h2 { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--rs-muted); text-transform: uppercase; letter-spacing: .06em; }
  .card { background: var(--rs-card); border: 1px solid var(--rs-border); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
  .card.active { border-left: 3px solid var(--rs-accent); }
  .card .title { display: flex; align-items: center; gap: 8px; font-weight: 700; }
  .tag { padding: 1px 7px; background: var(--rs-bg); color: var(--rs-muted); border-radius: 999px; font-size: 10.5px; font-weight: 600; }
  .path { font-size: 12px; color: var(--rs-muted); word-break: break-all; }
  .facts { display: flex; gap: 14px; font-size: 12px; color: #3F3F46; flex-wrap: wrap; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  button, .btn { padding: 7px 11px; border-radius: 8px; border: 1px solid #D4D4D8; background: var(--rs-card); color: #3F3F46; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; text-decoration: none; }
  button:hover, .btn:hover { background: var(--rs-bg); }
  button.primary { background: var(--rs-accent); border-color: var(--rs-accent); color: #fff; }
  button.primary:hover { background: #4338CA; }
  button.danger { color: var(--rs-danger); border-color: #FECACA; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  form { flex: 2 1 520px; background: var(--rs-card); border: 1px solid var(--rs-border); border-radius: 14px; padding: 22px 24px; display: flex; flex-direction: column; gap: 16px; }
  form h1 { margin: 0; font-size: 17px; }
  form p.lead { margin: 0; color: var(--rs-muted); font-size: 12.5px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  .field { display: flex; flex-direction: column; gap: 6px; }
  label { font-size: 12px; font-weight: 600; color: #3F3F46; }
  label span { font-weight: 400; color: var(--rs-faint); }
  input[type=text], input[type=number], textarea { padding: 9px 12px; border: 1px solid #D4D4D8; border-radius: 9px; font: inherit; font-size: 13px; color: var(--rs-text); width: 100%; }
  input:focus, textarea:focus { outline: 2px solid var(--rs-accent-soft); border-color: var(--rs-accent); }
  input[readonly] { background: #FAFAFA; color: var(--rs-muted); }
  textarea { resize: vertical; min-height: 70px; }
  .hint { font-size: 11.5px; color: var(--rs-faint); }
  .hint.ok { color: var(--rs-ok); }
  .hint.bad { color: var(--rs-danger); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border: 1px solid #D4D4D8; border-radius: 9px; min-height: 42px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; }
  .chip-red { background: #FEE2E2; color: #991B1B; } .chip-blue { background: #E0E7FF; color: #3730A3; }
  .chip button { padding: 0 2px; border: none; background: none; font-size: 12px; color: inherit; cursor: pointer; }
  .chips input { flex: 1; min-width: 90px; border: none; padding: 3px 4px; font-size: 12.5px; }
  .chips input:focus { outline: none; }
  .suggest { display: flex; flex-wrap: wrap; gap: 6px; }
  .suggest button { padding: 3px 8px; border: 1px dashed #A5B4FC; color: var(--rs-accent); border-radius: 999px; font-size: 11.5px; background: #fff; }
  details { border: 1px solid var(--rs-border); border-radius: 10px; padding: 8px 12px; }
  summary { cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--rs-muted); }
  details .grid { margin-top: 12px; }
  .actions { display: flex; align-items: center; gap: 10px; padding-top: 10px; border-top: 1px solid var(--rs-border); flex-wrap: wrap; }
  .msg { font-size: 12.5px; padding: 9px 12px; border-radius: 9px; }
  .msg.ok { background: var(--rs-ok-bg); color: var(--rs-ok); } .msg.bad { background: #FEE2E2; color: var(--rs-danger); }
  pre { margin: 0; padding: 10px 12px; background: #0F172A; color: #E2E8F0; border-radius: 9px; font-size: 11.5px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .gate { max-width: 460px; margin: 80px auto; background: var(--rs-card); border: 1px solid var(--rs-border); border-radius: 14px; padding: 28px; }
  .gate h1 { margin: 0 0 10px; font-size: 18px; }
  .hidden { display: none !important; }
  .check { display: flex; gap: 8px; align-items: center; }
  .check input { width: auto; }
  select { padding: 8px 10px; border: 1px solid #D4D4D8; border-radius: 9px; font: inherit; font-size: 13px; color: var(--rs-text); background: #fff; width: 100%; }
  .seg { display: flex; border: 1px solid #D4D4D8; border-radius: 9px; overflow: hidden; }
  .seg label { flex: 1; text-align: center; padding: 7px 8px; cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--rs-muted); }
  .seg input { position: absolute; opacity: 0; pointer-events: none; }
  .seg label:has(input:checked) { background: var(--rs-accent); color: #fff; }
  .seg label:has(input:focus-visible) { outline: 2px solid var(--rs-accent); outline-offset: -2px; }
  #agent-card .field { gap: 4px; }
  #agent-card h3 { margin: 6px 0 0; padding-top: 8px; border-top: 1px solid var(--rs-border); font-size: 12.5px; font-weight: 700; }
</style>
</head>
<body>
<?php if (!$loggedIn): ?>
<main class="gate">
  <h1>SayAndShape · <?= $t('Setup') ?></h1>
  <p><?= $t('This page is only for SayAndShape administrators.') ?></p>
  <p><a class="btn" href="../login/"><?= $t('Log in') ?></a></p>
</main>
<?php else: ?>
<header>
  <strong>SayAndShape</strong><span class="sub"><?= $t('Setup') ?></span>
  <span class="pill pill-warn"><?= $t('Administrators only') ?></span>
  <span class="spacer"></span>
  <span id="daemon" class="pill pill-bad"><?= $t('Checking the service…') ?></span>
  <span id="writable" class="pill pill-warn hidden"><?= $t('Configuration not writable') ?></span>
  <a class="btn" href="../login/"><?= $t('Login') ?></a>
</header>
<main>
  <aside>
    <h2><?= $t('Settings') ?></h2>
    <div class="card" id="agent-card">
      <div class="field">
        <label for="setting-language"><?= $t('Language') ?></label>
        <select id="setting-language">
          <option value="en"<?= $language === 'en' ? ' selected' : '' ?>>English</option>
          <option value="de"<?= $language === 'de' ? ' selected' : '' ?>>Deutsch</option>
        </select>
      </div>
      <h3><?= $t('AI agent') ?></h3>
      <div class="field">
        <label>Engine <span><?= $t('for all projects') ?></span></label>
        <div class="seg" role="radiogroup" aria-label="Engine">
          <label><input type="radio" name="agent-engine" value="claude"> Claude (claude -p)</label>
          <label><input type="radio" name="agent-engine" value="codex"> Codex</label>
        </div>
      </div>
      <div class="field">
        <label for="agent-model"><?= $t('Model') ?></label>
        <select id="agent-model"></select>
        <input id="agent-model-custom" type="text" maxlength="80" class="hidden" placeholder="<?= $t('Model ID, e.g. claude-opus-5-5') ?>">
      </div>
      <div class="field">
        <label for="agent-effort"><?= $t('Effort') ?></label>
        <select id="agent-effort"></select>
      </div>
      <div class="row" style="align-items:center"><button id="agent-save" type="button" class="primary"><?= $t('Save') ?></button><span id="agent-msg" class="hint"></span></div>
      <span class="hint"><?= $t('Takes effect with the next job, no restart needed. Claude runs without fast mode.') ?></span>
    </div>
    <h2><?= $t('Projects') ?></h2>
    <div id="projects"></div>
    <div class="row"><button id="new" type="button" class="primary">+ <?= $t('Add project') ?></button></div>
    <p class="hint"><?= $t("Users don't see this page. They only get the panel in their app.") ?></p>
  </aside>
  <form id="form" autocomplete="off">
    <div>
      <h1 id="form-title"><?= $t('Add project') ?></h1>
      <p class="lead"><?= $t("On the first job, SayAndShape copies the web app into the public variant and sets up everything else itself. The app's folder stays unchanged.") ?></p>
    </div>
    <div id="msg" class="msg hidden"></div>
    <div class="grid">
      <div class="field"><label for="f-name"><?= $t('Name') ?></label><input id="f-name" type="text" maxlength="60" placeholder="<?= $t('e.g. Neighborhood blog') ?>"></div>
      <div class="field"><label for="f-id"><?= $t('ID') ?> <span><?= $t('generated automatically') ?></span></label><input id="f-id" type="text" maxlength="40" pattern="[a-z0-9][a-z0-9_-]*"></div>
    </div>
    <div class="field">
      <label for="f-dir"><?= $t('Web app folder on the server') ?></label>
      <div class="row"><input id="f-dir" type="text" placeholder="<?= $t('/var/www/my-app') ?>" style="flex:1"><button id="inspect" type="button"><?= $t('Check') ?></button></div>
      <span id="dir-hint" class="hint"><?= $t('Absolute path. “Check” shows the size, files and large folders.') ?></span>
    </div>
    <div class="field">
      <label for="f-allowed"><?= $t('What may users change?') ?> <span><?= $t('in your own words') ?></span></label>
      <textarea id="f-allowed" maxlength="600" placeholder="<?= $t('Look, layout, colors, animations, texts and content of the site. No changes to login, server or configuration.') ?>"></textarea>
      <span class="hint"><?= $t('This becomes the rule every request is checked against before anything is changed.') ?></span>
    </div>
    <div class="grid">
      <div class="field">
        <label><?= $t('Protected files') ?></label>
        <div class="chips" id="chips-blocked"><input id="in-blocked" type="text" placeholder="<?= $t('Type a file, press Enter') ?>"></div>
        <span class="hint"><?= $t('Never changed, not even on request. Patterns like {example} are allowed.', ['example' => '<code>config/*.php</code>']) ?></span>
      </div>
      <div class="field">
        <label><?= $t('Shared folders') ?> <span><?= $t('images, uploads, content') ?></span></label>
        <div class="chips" id="chips-shared"><input id="in-shared" type="text" placeholder="<?= $t('Type a folder, press Enter') ?>"></div>
        <div id="suggest" class="suggest"></div>
        <span class="hint"><?= $t('Not copied per variant; served from the app folder instead.') ?></span>
      </div>
    </div>
    <div class="grid">
      <div class="field">
        <label for="f-parallel"><?= $t('Parallel changes') ?> <span><?= $t('for all projects') ?></span></label>
        <input id="f-parallel" type="number" min="1" max="16" value="3" style="width:100px">
        <span class="hint"><?= $t('Every running change uses AI budget.') ?></span>
      </div>
      <div class="field">
        <label for="f-url"><?= $t('App URL') ?> <span><?= $t('optional, for links') ?></span></label>
        <input id="f-url" type="text" maxlength="300" placeholder="<?= $t('https://example.org/my-app/') ?>">
      </div>
    </div>
    <details>
      <summary><?= $t('Advanced') ?></summary>
      <div class="grid">
        <div class="field"><label for="f-public"><?= $t('Public variant') ?></label><input id="f-public" type="text" value="main" maxlength="40"></div>
        <div class="field"><label for="f-maxfiles"><?= $t('Files per change') ?></label><input id="f-maxfiles" type="number" min="1" max="200" value="20" style="width:100px"></div>
        <div class="field">
          <label><?= $t('Blocked terms') ?> <span><?= $t('regex, applied before the AI check') ?></span></label>
          <div class="chips" id="chips-patterns"><input id="in-patterns" type="text" placeholder="<?= $t('Term, press Enter') ?>"></div>
        </div>
        <div class="field">
          <label class="check"><input id="f-auto" type="checkbox" checked> <?= $t("Automatically keep changes made in the app's admin area") ?></label>
          <span class="hint"><?= $t('Uploads and settings from the app are saved as a separate entry before each job.') ?></span>
        </div>
      </div>
    </details>
    <div class="actions">
      <button id="save" type="submit" class="primary"><?= $t('Create project') ?></button>
      <button id="cancel" type="button"><?= $t('Cancel') ?></button>
      <button id="remove" type="button" class="danger hidden"><?= $t('Remove project') ?></button>
      <span class="spacer"></span>
      <span class="hint"><?= $t("Takes a few seconds. The app's files are not deleted.") ?></span>
    </div>
    <details id="integration" class="hidden">
      <summary><?= $t('Connecting the app (one-time, technical)') ?></summary>
      <p class="hint"><?= $t('A project created here must be connected to the web server once, on the server. This command writes {router} (and, for Apache, the rewrite rules) into the project folder; after that the panel appears automatically:', ['router' => '<code>sayandshape-router.php</code>']) ?></p>
      <pre id="snippet-script"></pre>
      <p class="hint"><?= $t('Options such as {nginx} or {url}, and everything else: see INSTALL.md in the engine folder.', ['nginx' => '<code>--server nginx</code>', 'url' => '<code>--url</code>']) ?></p>
    </details>
  </form>
</main>
<script>
(function () {
  'use strict';
  const API = location.pathname.replace(/\/setup\/?.*$/, '') + '/api';
  const ENGINE_DIR = <?= json_encode($engineDir, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?>;
  const LANGUAGE = <?= json_encode($language) ?>;
  const TEXTS = <?= json_encode($scriptTable, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?>;
  // The English text is the key; {name} placeholders are filled from vars.
  const t = (text, vars) => (TEXTS[text] || text).replace(/\{(\w+)\}/g, (all, name) => vars && name in vars ? String(vars[name]) : all);
  const $ = id => document.getElementById(id);
  const chips = { blocked: [], shared: [], patterns: [] };
  let apps = [], editing = null, globalParallel = 1;

  async function call(endpoint, body) {
    const options = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    const res = await fetch(API + '/' + endpoint, Object.assign({ cache: 'no-store' }, options));
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('Request failed'));
    return data;
  }

  function message(text, ok) {
    const el = $('msg');
    el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'bad');
    el.classList.toggle('hidden', !text);
  }

  // German umlauts become ae/oe/ue/ss, so IDs from German names stay readable.
  function slugify(name) {
    return name.trim().toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  }

  function renderChips(kind) {
    const box = $('chips-' + kind);
    const input = $('in-' + kind);
    box.querySelectorAll('.chip').forEach(c => c.remove());
    chips[kind].forEach((value, index) => {
      const chip = document.createElement('span');
      chip.className = 'chip ' + (kind === 'shared' ? 'chip-blue' : 'chip-red');
      chip.textContent = value;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '✕'; remove.setAttribute('aria-label', t('Remove {value}', { value: value }));
      remove.addEventListener('click', () => { chips[kind].splice(index, 1); renderChips(kind); });
      chip.appendChild(remove);
      box.insertBefore(chip, input);
    });
  }

  function addChip(kind, value) {
    value = value.trim().replace(/^\/+|\/+$/g, '');
    if (!value || chips[kind].includes(value)) return;
    chips[kind].push(value);
    renderChips(kind);
  }

  ['blocked', 'shared', 'patterns'].forEach(kind => {
    $('in-' + kind).addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip(kind, e.target.value); e.target.value = ''; }
    });
    $('in-' + kind).addEventListener('blur', e => { addChip(kind, e.target.value); e.target.value = ''; });
  });

  $('f-name').addEventListener('input', () => { if (!editing) $('f-id').value = slugify($('f-name').value); });

  function fill(app) {
    editing = app ? app.id : null;
    $('form-title').textContent = app ? t('Edit project: {name}', { name: app.name || app.id }) : t('Add project');
    $('save').textContent = app ? t('Save') : t('Create project');
    $('remove').classList.toggle('hidden', !app);
    $('integration').classList.toggle('hidden', !app);
    $('f-name').value = app ? (app.name || app.id) : '';
    $('f-id').value = app ? app.id : '';
    $('f-id').readOnly = !!app;
    $('f-dir').value = app ? (app.base_dir || '') : '';
    $('f-allowed').value = app ? (app.allowed_changes || '') : '';
    $('f-url').value = app ? (app.app_url || '') : '';
    $('f-public').value = app ? (app.public_workspace || 'main') : 'main';
    $('f-maxfiles').value = app ? (app.max_files_per_change || 20) : 20;
    $('f-auto').checked = app ? app.auto_commit_host_changes !== false : true;
    $('f-parallel').value = globalParallel;
    chips.blocked = app ? (app.extra_blocked_files || []).slice() : ['.env', 'config.php'];
    chips.shared = app ? (app.shared_dirs || []).slice() : [];
    chips.patterns = app ? (app.extra_blocked_patterns || []).slice() : [];
    ['blocked', 'shared', 'patterns'].forEach(renderChips);
    $('suggest').textContent = '';
    $('dir-hint').textContent = app && !app.base_exists ? t('Folder not found.') : t('Absolute path. “Check” shows the size, files and large folders.');
    $('dir-hint').className = 'hint' + (app && !app.base_exists ? ' bad' : '');
    if (app) $('snippet-script').textContent = ENGINE_DIR + '/bin/sayandshape add ' + (app.base_dir || t('/path/to/project')) + ' --id ' + app.id;
    message('', true);
    document.querySelectorAll('#projects .card').forEach(card => card.classList.toggle('active', card.dataset.id === editing));
  }

  function renderProjects() {
    const box = $('projects');
    box.textContent = '';
    if (!apps.length) {
      const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = t('No projects set up yet.');
      box.appendChild(empty);
    }
    apps.forEach(app => {
      const card = document.createElement('div');
      card.className = 'card' + (app.id === editing ? ' active' : '');
      card.dataset.id = app.id;
      const title = document.createElement('div'); title.className = 'title';
      title.textContent = app.name || app.id;
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = app.id; title.appendChild(tag);
      const path = document.createElement('div'); path.className = 'path'; path.textContent = app.base_dir || '';
      const facts = document.createElement('div'); facts.className = 'facts';
      facts.textContent = [t(app.variants === 1 ? '{n} variant' : '{n} variants', { n: app.variants }),
        app.active_jobs ? t('{n} in progress', { n: app.active_jobs }) : t('nothing running')]
        .concat(app.base_exists ? [] : [t('folder missing')]).join(' · ');
      const row = document.createElement('div'); row.className = 'row';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = t('Edit');
      edit.addEventListener('click', () => fill(app));
      row.appendChild(edit);
      if (app.app_url) {
        const open = document.createElement('a'); open.className = 'btn'; open.textContent = t('Open app');
        open.href = app.app_url.replace(/\/+$/, '') + '/w/' + (app.public_workspace || 'main') + '/'; open.target = '_blank'; open.rel = 'noopener';
        row.appendChild(open);
      }
      card.append(title, path, facts, row);
      box.appendChild(card);
    });
  }

  async function load() {
    try {
      const data = await call('apps.php');
      apps = data.apps; globalParallel = data.max_parallel_jobs;
      $('daemon').textContent = data.daemon_running ? t('Service running') : t('Service not running');
      $('daemon').className = 'pill ' + (data.daemon_running ? 'pill-ok' : 'pill-bad');
      $('writable').classList.toggle('hidden', data.config_writable);
      $('save').disabled = !data.config_writable;
      renderProjects();
      if (editing === null) $('f-parallel').value = globalParallel;
    } catch (err) { message(err.message, false); }
  }

  $('inspect').addEventListener('click', async () => {
    const hint = $('dir-hint');
    hint.textContent = t('Checking…'); hint.className = 'hint';
    try {
      const data = await call('inspect_dir.php', { path: $('f-dir').value.trim() });
      const mb = (data.bytes / 1048576).toFixed(1);
      hint.textContent = [t('Folder found · {files} files · {mb} MB', { files: data.files, mb: mb }),
        data.index ? t('{index} present', { index: data.index }) : t('no index.php/index.html')]
        .concat(data.git ? [t('contains .git')] : []).join(' · ');
      hint.className = 'hint ' + (data.index ? 'ok' : 'bad');
      const box = $('suggest');
      box.textContent = '';
      data.dirs.filter(d => data.suggested_shared.includes(d.name) && !chips.shared.includes(d.name)).forEach(d => {
        const b = document.createElement('button'); b.type = 'button';
        b.textContent = '+ ' + d.name + '/ (' + (d.bytes / 1048576).toFixed(0) + ' MB)';
        b.addEventListener('click', () => { addChip('shared', d.name); b.remove(); });
        box.appendChild(b);
      });
      if (!$('f-name').value && !editing) { $('f-name').value = data.path.split('/').pop(); $('f-id').value = slugify($('f-name').value); }
    } catch (err) { hint.textContent = err.message; hint.className = 'hint bad'; }
  });

  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    ['blocked', 'shared', 'patterns'].forEach(kind => { addChip(kind, $('in-' + kind).value); $('in-' + kind).value = ''; });
    const body = {
      id: editing || $('f-id').value.trim() || slugify($('f-name').value),
      name: $('f-name').value.trim() || undefined,
      base_dir: $('f-dir').value.trim(),
      allowed_changes: $('f-allowed').value.trim(),
      app_url: $('f-url').value.trim(),
      public_workspace: $('f-public').value.trim() || 'main',
      max_files_per_change: parseInt($('f-maxfiles').value, 10) || 20,
      max_parallel_jobs: parseInt($('f-parallel').value, 10) || 1,
      auto_commit_host_changes: $('f-auto').checked,
      extra_blocked_files: chips.blocked, shared_dirs: chips.shared, extra_blocked_patterns: chips.patterns
    };
    $('save').disabled = true;
    try {
      const data = await call('apps.php', body);
      message(t('Saved.'), true);
      await load();
      fill(apps.find(a => a.id === data.id) || data.app);
      message(t('Saved.'), true);
    } catch (err) { message(err.message, false); }
    $('save').disabled = false;
  });

  $('cancel').addEventListener('click', () => fill(null));
  $('new').addEventListener('click', () => fill(null));
  $('remove').addEventListener('click', async () => {
    if (!editing || !confirm(t('Remove the project “{id}” from SayAndShape? The files of the app and its variants stay on the server.', { id: editing }))) return;
    try { await call('apps.php', { id: editing, remove: true }); fill(null); await load(); message(t('Project removed.'), true); }
    catch (err) { message(err.message, false); }
  });

  // ── Settings: language and AI agent (api/agent.php) ──
  const agentState = { agent: null, models: {}, efforts: [] };
  const EFFORT_LABELS = { low: t('Low'), medium: t('Medium'), high: t('High'), xhigh: t('Very high'), max: t('Maximum') };
  const engineNow = () => (document.querySelector('input[name=agent-engine]:checked') || {}).value || 'claude';

  function renderAgentModels() {
    const engine = engineNow();
    const current = agentState.agent[engine + '_model'];
    const select = $('agent-model');
    select.textContent = '';
    const list = agentState.models[engine] || [];
    list.forEach(m => select.add(new Option(m.label + ' (' + m.id + ')', m.id)));
    select.add(new Option(t('Other ID…'), '__custom'));
    const known = list.some(m => m.id === current);
    select.value = known ? current : '__custom';
    $('agent-model-custom').value = known ? '' : current;
    $('agent-model-custom').classList.toggle('hidden', known);
  }

  async function loadAgent() {
    try {
      const data = await call('agent.php');
      Object.assign(agentState, { agent: data.agent, models: data.models, efforts: data.efforts });
      $('setting-language').value = data.language || LANGUAGE;
      document.querySelectorAll('input[name=agent-engine]').forEach(r => { r.checked = r.value === data.agent.engine; });
      $('agent-effort').textContent = '';
      data.efforts.forEach(e => $('agent-effort').add(new Option(EFFORT_LABELS[e] || e, e)));
      $('agent-effort').value = data.agent.effort;
      renderAgentModels();
      $('agent-save').disabled = !data.config_writable;
    } catch (err) { $('agent-msg').textContent = err.message; $('agent-msg').className = 'hint bad'; }
  }

  document.querySelectorAll('input[name=agent-engine]').forEach(r => r.addEventListener('change', renderAgentModels));
  $('agent-model').addEventListener('change', () => {
    const custom = $('agent-model').value === '__custom';
    $('agent-model-custom').classList.toggle('hidden', !custom);
    if (custom) $('agent-model-custom').focus();
  });
  $('agent-save').addEventListener('click', async () => {
    const engine = engineNow();
    const model = $('agent-model').value === '__custom' ? $('agent-model-custom').value.trim() : $('agent-model').value;
    const body = { language: $('setting-language').value, engine: engine, effort: $('agent-effort').value };
    body[engine + '_model'] = model;
    $('agent-save').disabled = true;
    try {
      const data = await call('agent.php', body);
      // A new language needs the page in that language: reload it.
      if (data.language !== LANGUAGE) { location.reload(); return; }
      agentState.agent = data.agent;
      $('agent-msg').textContent = t('Saved: {engine} · {model}', { engine: engine === 'claude' ? 'Claude' : 'Codex', model: model });
      $('agent-msg').className = 'hint ok';
    } catch (err) { $('agent-msg').textContent = err.message; $('agent-msg').className = 'hint bad'; }
    $('agent-save').disabled = false;
  });

  fill(null);
  load();
  loadAgent();
  setInterval(load, 15000);
})();
</script>
<?php endif; ?>
</body>
</html>
