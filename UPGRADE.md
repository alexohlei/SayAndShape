# Upgrade: from per-user clones to variants

This guide brings an existing installation (one clone per user under
`clones/<app>/user_<id>/`, tab on the right edge) up to date with variants, the floating panel,
parallel processing and the setup page. The examples use an app at `/var/www/my-app` with the
engine in `/var/www/SayAndShape`; adjust paths and ID accordingly.

All Git repositories stay local on the server. There is no remote.

## Version 1.1.0: agent sandbox, deleting inside the site, cache buster

Replace the engine files (step 1 below, or `bin/sayandshape update`) and restart the worker.
Then run `bin/sayandshape doctor`.

- **Agent sandbox, on by default.** Until now the AI agent edited with every permission of the
  worker's user (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`).
  It now runs in the sandbox of its CLI and can write only to the working copy of a change; it has
  no network access. What an existing installation needs:
  - Claude Code 2.1.257 or newer (`claude update`).
  - On Linux with Claude Code: `sudo apt install bubblewrap socat`. Without them every change
    request fails ("Execution failed") instead of running unprotected; `doctor` reports it as `FAIL`.
  - Inside a container that cannot start a nested sandbox, and only there, switch it off:
    `bin/sayandshape agent --sandbox off` (`"sandbox": false` under `agent` in `config/apps.json`).
  - Requests that relied on the agent fetching something from the internet or touching other
    folders no longer work. That is the point.
- **Deleting inside the site is allowed.** The guardrail no longer rejects requests to remove
  content, pages, images or files of the site itself. It still rejects everything that reaches
  beyond the site. `max_files_per_change` also limits how many files one request may delete.
- **Cache buster.** Every published change counts a cache version per variant up; the router
  appends it to the stylesheets, scripts and images of the pages it serves (`?v=12`) and sends all
  files with `Cache-Control: no-cache`. Nothing has to be configured. A project with its own
  `sayandshape-router.php` ("custom version" in `doctor`) does not get this.
- The diff review also blocks `shell_exec`, `popen` and `pcntl_exec` in added code.
- **Edit button missing on some pages or after a browser restart** (seen mostly in Firefox), two
  causes, both fixed:
  - Pages a browser had loaded before the login were reused from its cache, without the panel.
    Pages are now revalidated and count as changed once the panel is part of them.
  - Every API call set the session cookie again without lifetime, `HttpOnly` and `SameSite`. The
    login then ended with the browser session while the button's hint cookie stayed for 14 days,
    and scripts of the site could read the session ID. With `auth.mode: "host"` the same happened
    to the app's own session cookie. People who are logged in should log in once more after the
    update, so that their cookie gets its attributes back.

## English or German interface

From this version on, the panel, the login page, the setup page and the worker's messages (job
status, block reasons, the commit subjects the worker writes) are **English by default** and can be
switched to German. The CLI (`bin/sayandshape`) and the installation are English only. The AI agent
answers in the language of the request: result summaries, follow-up questions and the Discuss chat
follow the language the person wrote or spoke in, whatever the setting is.

To keep the German interface of earlier versions, set it once after updating:

```bash
bin/sayandshape language de        # or on /sayandshape/setup/ → Settings → Language
```

The setting is the top-level `"language"` in `config/apps.json` (`"en"` or `"de"`); a missing value
means English. Commit subjects in existing histories stay as they are; the worker recognizes the
English and the German forms, so nothing has to be rewritten.

Replace the engine files (step 1 below, or `bin/sayandshape update` for a Git checkout) and restart
the worker.

## As of 2026-11-18 (2): installable package, own login, bundled router

New installations follow `INSTALL.md` (`bin/sayandshape add …`). For an **existing** installation
the following changes; without step 2 the engine no longer recognizes the app's admins (HTTP 401,
the panel does not appear).

1. **Files:** in addition to `api/`, `orchestrator/`, `widget/`, `setup/` there are now `router/`,
   `login/`, `bin/`, `install.sh` and `VERSION` (see step 1 below). `config/apps.json` is no longer
   shipped with the repository (template: `config/apps.example.json`); your own file stays.
2. **Login:** the default is now SayAndShape's own login page `/sayandshape/login/` with a password
   (`bin/sayandshape passwd`). To keep using the app's admin session, add it to the project:

   ```json
   "auth": { "mode": "host", "session_name": "MYAPPSESSID", "session_key": "admin_logged_in", "engine_admin": true },
   "allowed_origins": ["https://www.example.org"],
   "serve": "prefix"
   ```

   - `session_name` is the name of the app's session cookie (the value it passes to
     `session_name()`; omit it if the app does not set its own name). Until now this name was
     hard-coded in `api/auth.php`.
   - The former additional check of `$_SESSION['admin_scope']` is gone.
   - `engine_admin: true` keeps the previous behavior that the app's admins may also open
     `/sayandshape/setup/`. Without it the app's session is valid for this one project only, and
     the setup page requires the SayAndShape login.
   - `allowed_origins` lists further origins that may call the API (until now hard-coded in
     `api/auth.php`); only needed if the app is embedded from a different address. Requests
     from the app's own address are always allowed.
   - `serve: "prefix"` keeps the previous behavior (variants only under `/w/…`). It only takes
     effect with the bundled router (item 3).
3. **Router:** your own `sayandshape-router.php` in the app keeps working unchanged;
   `bin/sayandshape doctor` reports it as a "custom version". The bundled router
   (`router/router.php`) now supports sub-paths, range requests, PHP pages inside their variant
   and inserting the panel automatically. To switch (keeps the old file as `.bak`, rewrites the
   `.htaccess` block):
   `bin/sayandshape add /path/to/app --id <id> --server apache --serve prefix --force`.
   The old `/u/<id>/` addresses are not included.
   Important with your own router: it must reject paths starting with a dot (`/w/main/.git/…`,
   `.env`); the bundled one does.
4. **Worker:** `sayandshape-router.php` is no longer copied into new variants. Starting it through
   `orchestrator/daemon.sh` and the `sayandshape-daemon` service stays the same; new is
   `bin/sayandshape daemon start|stop|status` for development machines.
5. The engine folder now contains an `.htaccess` that denies all direct web access (Apache).
   If you served the widget or the API directly from the engine folder instead of through
   `sayandshape-router.php`, switch to the router.
6. New runtime files in `jobs/`: `.sessions/` (sessions of SayAndShape's own login, 14 days) and
   `.login-attempts.json` (failed attempts). As before, the web server needs write access there.

## Renaming ReShapeAI → SayAndShape

The project was called ReShapeAI for a while. The rename changes folders, URLs, file names and
identifiers: `ReShapeAI/` → `SayAndShape/`, `bin/reshape` → `bin/sayandshape`, `/reshape/…` →
`/sayandshape/…`, `reshape-router.php` → `sayandshape-router.php`, `reshape-widget.js|css` →
`sayandshape-widget.js|css`, `RESHAPE_APP_ID` → `SAYANDSHAPE_APP_ID`, `reshape-daemon` →
`sayandshape-daemon`, `~/.local/state/reshape-ai/` → `~/.local/state/sayandshape/`. To switch an
existing installation (adjust the example paths):

```bash
cd /var/www
sudo systemctl stop reshape-daemon            # only once no job is running
mv ReShapeAI SayAndShape
sed -i 's#/ReShapeAI/#/SayAndShape/#g' SayAndShape/config/apps.json   # clone_dir paths
rm my-app/reshape-router.php
sed -i '/^# BEGIN ReShapeAI$/,/^# END ReShapeAI$/d' my-app/.htaccess    # old block (Apache)
SayAndShape/bin/sayandshape add /var/www/my-app --id my-app           # rewrites router and block
```

Then:
- Nginx: `config/nginx-<id>.conf` has been regenerated; replace the `location` block in
  `server { }` and reload Nginx.
- systemd service: remove the old unit and create a new one with `bin/sayandshape service`
  (`sayandshape-daemon`). The old runtime directory `~/.local/state/reshape-ai/` is no longer
  read; so only stop the daemon while no job is running.
- If you insert the panel yourself (`inject_widget: false`): change the script tag to
  `…/sayandshape/widget/sayandshape-widget.js`.
- Login: everyone logs in once more, now at `/sayandshape/login/`. Password and projects are
  kept.

Baseline and archives are stored in every clone in `refs/reshape/state`. The worker keeps reading
this ref as long as `refs/sayandshape/state` is missing, and writes the new one with the next job.
In the browser, launcher position, docking state and drafts start fresh once (keys
`sayandshape:…`). New commits carry `sayandshape@local` instead of `reshape@local`; older ones
stay unchanged.

## Renaming PersonaEngine → SayAndShape

The project was originally called PersonaEngine. The rename changes folders, URLs, file names and
identifiers: `PersonaEngine/` → `SayAndShape/`, `/persona/…` → `/sayandshape/…`,
`persona-router.php` → `sayandshape-router.php`, `persona-widget.js|css` → `sayandshape-widget.js|css`,
`PERSONA_APP_ID` → `SAYANDSHAPE_APP_ID`, `persona-daemon` → `sayandshape-daemon`,
`~/.local/state/persona-engine/` → `~/.local/state/sayandshape/`. To switch an existing
installation (paths as in the reference installation, adjust otherwise):

```bash
cd /var/www
sudo systemctl stop persona-daemon            # only once no job is running
mv PersonaEngine SayAndShape
sed -i 's#/PersonaEngine/#/SayAndShape/#g' SayAndShape/config/apps.json   # clone_dir paths
mv my-app/persona-router.php my-app/sayandshape-router.php
```

Then, in the app:
- `sayandshape-router.php`: replace its content with the current router (AGENTS.md, step 3, or
  your own version with sub-paths and range requests) and set `SAYANDSHAPE_APP_ID`.
- `.htaccess`: replace `persona` in the rewrite rules with `sayandshape`; the target is
  `sayandshape-router.php`.
- Script tag: `<script src="…/sayandshape/widget/sayandshape-widget.js" data-app="…">`.
- systemd service: rename the unit to `sayandshape-daemon`, point `ExecStart` to
  `…/SayAndShape/orchestrator/daemon.sh` and `BindPaths=` to `~/.local/state/sayandshape`.
  The old runtime directory `~/.local/state/persona-engine/` is no longer read; so only stop
  the daemon while no job is running.

Baseline and archives are stored in every clone in `refs/persona/state`. The worker keeps reading
this ref as long as `refs/sayandshape/state` is missing, and writes the new one with the next job.
To switch right away (as the daemon user):

```bash
for d in SayAndShape/clones/*/*/; do
  git -C "$d" rev-parse -q --verify refs/persona/state >/dev/null \
    && git -C "$d" update-ref refs/sayandshape/state refs/persona/state
done
```

In the browser, launcher position, docking state, drafts and the name under "Your name" start
fresh once, because they are stored under new keys (`sayandshape:…`). Bookmarks to
`/persona/setup/` now point to `/sayandshape/setup/`. New commits carry `sayandshape@local`
instead of `persona@local`; older ones stay unchanged.

## As of 2026-11-18: helper button, docking, result file, Discuss

For installations that already use variants, step 1 (replace the engine files) and a restart of
the daemon are enough (otherwise the new job type `discuss` is rejected). New:

- Round helper button at the bottom right instead of a pill; the panel floats or docks to the
  left/right.
- Tabs "Edit", "Discuss", "History", "Variants".
- The AI writes a result file (summary, bullet points, follow-up questions); the panel shows it
  as a card, follow-up questions as clickable choices.
- "Discuss": read-only chat per variant (`api/discuss.php`, `jobs/.chat-<app>-<variant>.json`).
- Selectable AI (Claude/Codex, model, reasoning effort): `config/apps.json` → `agent`, page
  `/sayandshape/setup/`.
- Also runs in a hardened systemd service with `RestrictSUIDSGID=yes`. The runtime directory
  `~/.local/state/sayandshape/<hash>` must be writable for the service (`BindPaths=`).
- Optional in the router: serve the widget files with `Cache-Control: no-cache` and
  `Last-Modified`, so that browsers load an updated widget right away.

## 1. Replace the engine files

On the server this is safe with the daemon running, as long as no job is running at the moment
(check the panel or `ls SayAndShape/jobs/*.status.json | xargs grep -l running`):

```bash
cd /var/www
sudo systemctl stop sayandshape-daemon            # or stop the running daemon.sh
cp -a SayAndShape/config/apps.json /tmp/apps.json.bak
rsync -a --delete SayAndShape-Template/api/          SayAndShape/api/
rsync -a --delete SayAndShape-Template/orchestrator/ SayAndShape/orchestrator/
rsync -a --delete SayAndShape-Template/widget/       SayAndShape/widget/
rsync -a --delete SayAndShape-Template/setup/        SayAndShape/setup/
rsync -a --delete SayAndShape-Template/router/       SayAndShape/router/
rsync -a --delete SayAndShape-Template/login/        SayAndShape/login/
rsync -a --delete SayAndShape-Template/bin/          SayAndShape/bin/
cp SayAndShape-Template/VERSION SayAndShape-Template/install.sh SayAndShape-Template/.htaccess SayAndShape/
```

If the engine is a Git checkout (installed following `INSTALL.md`), `bin/sayandshape update` is
enough instead.

`jobs/`, `clones/` and logs stay untouched.

## 2. Extend the configuration

`SayAndShape/config/apps.json` for the app:

```json
{
  "max_parallel_jobs": 3,
  "apps": {
    "my-app": {
      "name": "My App",
      "base_dir": "/var/www/my-app",
      "clone_dir": "/var/www/SayAndShape/clones/my-app",
      "serve_base": "/w/",
      "public_workspace": "main",
      "shared_dirs": ["media", "uploads"],
      "allowed_changes": "Behavior, appearance, layout, colors, animations, texts and content of the application",
      "auto_commit_host_changes": true,
      "app_url": "https://www.example.org/my-app",
      "max_files_per_change": 20,
      "extra_blocked_patterns": [],
      "extra_blocked_files": [".env", "config.php", ".htaccess", "sayandshape-router.php"]
    }
  }
}
```

So that the setup page can save, the web server needs write access to `config/` and
`config/apps.json` (same group as for `jobs/` and `clones/`):

```bash
sudo chgrp www-data SayAndShape/config SayAndShape/config/apps.json
sudo chmod g+rwx SayAndShape/config && sudo chmod g+rw SayAndShape/config/apps.json
```

## 3. Router and rewrite rules of the app

```bash
SayAndShape/bin/sayandshape add /var/www/my-app --id my-app --server apache --serve prefix --force
php -l my-app/sayandshape-router.php
```

The command keeps an existing custom `sayandshape-router.php` as `.bak`, writes the new one and
sets the block in the `.htaccess`. New: `/w/{slug}/` for variants, falling back to the shared
folders from the baseline, and `/sayandshape/setup/` for the setup page. The old `/u/{id}/`
addresses no longer exist.

## 4. Register old clones

```bash
python3 SayAndShape/orchestrator/migrate_workspaces.py            # only shows what would happen
python3 SayAndShape/orchestrator/migrate_workspaces.py --apply    # renames and registers
```

A clone `user_1` becomes the variant `user-1` (with its own history).
The public variant `main` is created fresh from the app folder on the first job.
To make the state of `user-1` public, open `user-1` in the panel and click
"Merge into “main”": the prompt commits are merged into `main` one by one.

Note: legacy clones also contain the shared folders in Git. That stays as it is and does no
harm; new variants created from `main` are small.

## 5. Start the daemon and check

```bash
sudo systemctl start sayandshape-daemon
pgrep -af '[o]rchestrator/worker.py'           # one dispatcher process
tail -f SayAndShape/daemon.log               # jobs appear as "dispatched"
```

In the browser:
1. Log in as admin and open the app: the round helper button appears at the bottom right.
2. Drag the launcher, open it, "Variants" tab: `main` (public) and `user-1` are visible.
3. Create a "New variant" and make a change there: `main` stays unchanged.
4. In the variant, click "Merge into “main”": the prompt appears in the history of `main`.
5. Open `/sayandshape/setup/`: the project is listed, "Worker running".

## 6. No longer needed

- `migrate-clone-to-base.sh` in the project folder: replaced by "Merge into “main”".
- `data-user-id` on the script tag: ignored.
- `PERSONA` tab (old version): replaced by the launcher. The old CSS file is replaced along with it.

## Going back

Copy the engine folder back from the backup, `apps.json` from `/tmp/apps.json.bak`, and the
router and `.htaccess` from the `.bak` files. Variant directories do not disturb the old version;
for it, `user-1` would have to be called `user_1` again.
