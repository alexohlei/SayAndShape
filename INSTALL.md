# Installing SayAndShape

This file is written for AI coding agents (Claude Code, Codex, …) and works just as well for
people. Follow it from top to bottom. Every step ends with a check; do not continue while a
check fails.

**Goal:** SayAndShape is installed on this machine and connected to one web project, so that
people who log in can change the site by text or voice, while visitors see the site as before.

**Done when:**

- `bin/sayandshape doctor` reports no `FAIL`,
- `bin/sayandshape check <id> --url <site address>` reports `All checks passed`,
- the user has the login address and the password.

## What it works with

| Project | Supported |
|---|---|
| Static sites (HTML, CSS, JS, images), in a domain root or a sub-folder | yes |
| Plain PHP sites and apps (pages are `.php` files, includes, sessions) | yes |
| Several sites or sub-sites on one server | yes, one engine serves all of them |
| PHP apps that route every URL through one front controller with their own rewrite rules (WordPress, Laravel, …) | no: variants map URLs to files and do not emulate those rules |
| Sites that need a build step (Vite, Astro, Hugo) or their own server process (Node, Django) | no |

Web servers: Apache (via `.htaccess`), Nginx (one `location` block), PHP's built-in server.

## Before you start

Find these out yourself where you can (look at the project, the web server configuration, the
running processes). Ask the user only for what you cannot determine.

1. **Project folder**: the directory the web server serves for this site, e.g. `/var/www/blog`.
   If you were asked to install SayAndShape "for the website in this folder", it is the directory
   you were started in: the site is already published from there.
2. **Address**: the URL under which that folder is reachable, including a sub-path if there is
   one, e.g. `https://example.org` or `https://example.org/blog`. Look it up: the virtual host
   whose `DocumentRoot` (Apache) or `root` (Nginx) is the project folder or a parent of it names
   the host (`ServerName`, `server_name`), and a listener on port 443 means `https`. Ask the user
   only if no configuration or several addresses fit.
3. **Web server**: Apache, Nginx or `php -S`.
4. **Login**: by default SayAndShape brings its own login page. Only if the project already has
   an admin area whose login should be reused, see [Using the project's own login](#using-the-projects-own-login).
5. **AI agent**: the changes are carried out by the `claude` or the `codex` command line tool.
   Step 1 shows which of them are installed and signed in. Ask the user which one to use when
   both are available, and whether it should use its existing sign-in (for example a
   subscription) or an API key.
6. **Interface language**: the panel, login and setup page are English by default and can be
   switched to German. Use German when the user writes to you in German or asks for it; otherwise
   keep English.
7. **Isolation**: look at what else lives on this machine. SayAndShape lets an AI agent change
   files here, so the recommended place for it is a container or a small VM that holds only the
   sites people may edit. If the machine also holds other sites, databases or credentials, tell
   the user before you continue and point them to "Safety" in `README.md`; go on when they agree.

Rules for this installation:

- Do not edit the project's pages. The only things added to the project folder are
  `sayandshape-router.php` and, on Apache, one marked block at the top of `.htaccess`. Both are
  written by `bin/sayandshape add` and removed by `bin/sayandshape remove`.
- The engine must live **outside every document root**. It holds configuration, the job queue
  and Git repositories.
- Use `sudo` only where a step says so, and tell the user when you do.
- Show the generated password to the user once. Do not write it into files or commit it.
- An API key is only ever passed to `bin/sayandshape agent --api-key-stdin`. Do not put it into a
  command line, a file of your own or the project.
- Leave the agent sandbox on. It is the default and keeps the AI agent's write access inside the
  working copy of a change. Switch it off (`bin/sayandshape agent --sandbox off`) only when the
  user asks for it and the installation runs inside a container or VM.

## Step 1: Get the engine

Choose the engine folder `ENGINE`: a directory outside every document root that the web server
user can read. Good choices: next to the document root (`/var/www/SayAndShape` when sites live in
`/var/www/<site>`), or `~/SayAndShape` on a development machine. One engine per machine is
enough; if `ENGINE` already exists, reuse it and skip to step 2.

The repository is private. Use whichever access this machine has:

```bash
gh repo clone alexohlei/SayAndShape "$ENGINE"                       # GitHub CLI, signed in
git clone git@github.com:alexohlei/SayAndShape.git "$ENGINE"        # or SSH key with access
```

Or let the installer pick the method and run the first checks:

```bash
gh api -H 'Accept: application/vnd.github.raw' repos/alexohlei/SayAndShape/contents/install.sh \
  | bash -s -- --dir "$ENGINE"
```

If cloning fails with a permission error, stop and tell the user: the machine needs access to
the repository (`gh auth login`, or an SSH/deploy key). Do not look for other sources.

Then:

```bash
"$ENGINE/bin/sayandshape" init      # creates config/apps.json, jobs/, clones/ (keeps existing ones)
"$ENGINE/bin/sayandshape" doctor
```

`init` looks for `claude` and `codex`, prints their versions and whether they are signed in, and
ends with `Using: …`. In a terminal it asks which agent to use and how it signs in.
Without a terminal (an AI coding agent runs the installation) it asks nothing: it takes the
installed agent, `claude` if both are there. Apply the user's answer from "Before you start":

```bash
"$ENGINE/bin/sayandshape" agent                                   # what is installed, signed in and selected
"$ENGINE/bin/sayandshape" agent --engine codex                    # use Codex with its own sign-in
printenv ANTHROPIC_API_KEY | "$ENGINE/bin/sayandshape" agent --engine claude --api-key-stdin
"$ENGINE/bin/sayandshape" agent --login                           # drop the stored key, use the CLI's sign-in again
```

An API key is stored in `$ENGINE/.agent-keys.json`, readable only by the user who ran the
command (run it as the worker user, step 4), and is handed to the agent as `ANTHROPIC_API_KEY`
(claude) or `CODEX_API_KEY` (codex). It then takes precedence over a sign-in of that CLI.

**Check:** `doctor` lists no `FAIL` under "Prerequisites". Two `WARN` lines (worker not
running, no password) are expected at this point.

If something is missing:

| `doctor` says | Fix |
|---|---|
| PHP missing or older than 8.1 | install PHP 8.1+ (CLI and the web server's PHP) |
| Python older than 3.9 | install Python 3.9+ |
| `jq` / `git` not found | install them (`apt install jq git`, `brew install jq git`) |
| AI agent "claude" not in PATH | install it with the command `doctor` prints, or switch: `bin/sayandshape agent --engine codex` |
| Agent sandbox: `bwrap` / `socat` not found (Linux, claude) | `sudo apt install bubblewrap socat` (or the distribution's equivalent); needs `sudo`, tell the user. Without them every change request fails |
| Agent sandbox: Claude Code … does not block reads (`WARN`) | update Claude Code (`claude update`) to 2.1.257 or newer |
| AI agent … not signed in (`WARN`) | sign in as the worker user (`claude auth login`, `codex login`), or store an API key: `bin/sayandshape agent --api-key-stdin` |

The AI agent CLI must be installed, and signed in or given an API key, **for the
operating-system user that runs the worker** (step 4). `doctor` checks the sign-in of the user
who runs it. `bin/sayandshape agent --test` sends a one-word request through the selected agent the
way the worker does and so proves that the sign-in or key works; it costs a few tokens, so ask
the user first.

## Step 2: Connect the project

Look first, without writing anything:

```bash
"$ENGINE/bin/sayandshape" add /path/to/project --url https://example.org/blog --server apache --dry-run
```

Review what it prints:

- `shared_dirs`: folders that are **not** copied into every variant (uploads, media, large
  content). They are detected by size and name. Add or remove some with
  `--shared media,uploads` (`--shared ""` for none). Folders the site's code lives in must not
  be listed.
- `allowed_changes`: one sentence describing what people may change. It becomes part of the
  check every request passes before anything is edited. Write it for this site with
  `--allowed "Texts, colors, layout and images of the pages. No changes to forms or the checkout."`
- `extra_blocked_files`: files that are never changed. Add the project's sensitive files with
  `--blocked ".env,config.php,.htaccess,sayandshape-router.php,includes/db.php"`.

Then run the same command without `--dry-run`. It registers the project in
`config/apps.json`, writes `sayandshape-router.php` into the project and wires the web server:

| `--server` | What `add` does | What you still do |
|---|---|---|
| `apache` | puts a marked block at the top of the project's `.htaccess` | make sure `mod_rewrite` is enabled and the directory allows overrides (`AllowOverride FileInfo` or `All`) |
| `nginx` | writes `config/nginx-<id>.conf` and prints it | put that `location` block into the site's `server { }` block, set `fastcgi_pass` to the server's PHP-FPM socket, then `sudo nginx -t && sudo nginx -s reload` |
| `php` | prints the start command | run it: `php -S localhost:8080 -t /path/to/project /path/to/project/sayandshape-router.php` |

Useful options (all optional, `bin/sayandshape add --help` lists them):

| Option | Meaning |
|---|---|
| `--id blog` | short identifier (default: derived from the folder name) |
| `--name "Neighborhood blog"` | display name |
| `--serve root` | default: visitors get the published variant at the site's normal addresses |
| `--serve prefix` | the site itself stays untouched at its addresses; variants exist only under `/w/<variant>/` and `/` redirects to `/w/main/` |
| `--public main` | name of the variant visitors see |

`add` can be run again at any time to change settings; it never duplicates anything.

**Check:** `"$ENGINE/bin/sayandshape" doctor` shows the project with `[OK] sayandshape-router.php
points to this engine` and no `FAIL`.

## Step 3: Set the login password

```bash
"$ENGINE/bin/sayandshape" passwd --generate
```

It prints the password once; note it for the user. (Skip this step only if every project uses
the project's own login.) To set a chosen password instead: `bin/sayandshape passwd` (asks twice)
or `printf '%s\n' "$PASSWORD" | bin/sayandshape passwd --stdin`.

## Step 4: Start the worker

The worker runs the queued change requests with the AI agent. It must run as a user that is
signed in to `claude` (or `codex`) or can read the stored API key, and that can write `jobs/`
and `clones/`.

Development machine:

```bash
"$ENGINE/bin/sayandshape" daemon start      # log: $ENGINE/daemon.log · stop: daemon stop
```

Server, so that it survives reboots (needs `sudo`; tell the user):

```bash
"$ENGINE/bin/sayandshape" service --user <worker-user> | sudo tee /etc/systemd/system/sayandshape-daemon.service >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable --now sayandshape-daemon
```

On macOS `bin/sayandshape service` prints a launchd plist and the two commands to load it.

**If the web server and the worker run as different users** (typical on servers: `www-data`
and a login user), both need write access to the queue, the variants and the configuration:

```bash
sudo usermod -aG www-data <worker-user>                     # then start a new login session
sudo chgrp -R www-data "$ENGINE/jobs" "$ENGINE/clones" "$ENGINE/config"
sudo chmod -R g+rwX "$ENGINE/jobs" "$ENGINE/clones" "$ENGINE/config"
sudo find "$ENGINE/jobs" "$ENGINE/clones" -type d -exec chmod g+s {} +
```

The web server user must also be able to read the rest of `ENGINE` and the project folder; the
worker must be able to read the project folder.

**Check:** `"$ENGINE/bin/sayandshape" daemon status` says `Worker running` (or
`systemctl is-active sayandshape-daemon` says `active`).

## Step 5: Verify

```bash
"$ENGINE/bin/sayandshape" check <id> --url https://example.org/blog
```

It requests the site the way a browser does and must end with `All checks passed`. Otherwise it
marks each failing check with `FAIL` and ends with `<n> check(s) failed`.

| Failed check | Usual cause |
|---|---|
| API reachable | requests are not reaching `sayandshape-router.php`: Apache without `mod_rewrite`/`AllowOverride`, Nginx block missing or not reloaded, wrong `--url` |
| Start page is served | project has no `index.php`/`index.html`, or the web server user cannot read the engine or project folder |
| Panel is inserted for logged-in users | the start page has no `</body>` tag (the panel is inserted before it) |
| Repository data is not reachable | the engine or its `clones/` folder is inside a document root: move the engine out |
| HTTP 500 anywhere | read the web server's PHP error log; most often a permission problem on `ENGINE` |

## Step 6: Hand over

If the interface should be German (see "Before you start"), switch it now; it applies to all
projects of this engine and can be changed back at any time:

```bash
"$ENGINE/bin/sayandshape" language de      # or en; also on /sayandshape/setup/ → Settings
```

Tell the user, in their language:

1. Login: `<address>/sayandshape/login/` with the password from step 3.
2. After logging in, a round helper button appears at the bottom right of every page of the
   site. It opens the panel: **Edit** (describe a change by text or voice),
   **Discuss** (ask questions, nothing is changed), **History** (undo), **Variants**
   (try things in a copy and merge them later). In German: **Bearbeiten**, **Diskutieren**,
   **Verlauf**, **Varianten**.
3. The first change takes a little longer: SayAndShape copies the site into its first variant.
4. The original project folder is never modified. Removing SayAndShape again:
   `bin/sayandshape remove <id>`.
5. Safety: everyone who has the password can give the AI agent instructions. The agent works in
   a sandbox and can only write to a copy of the site, but the recommended setup remains a
   container or VM that holds nothing else ("Safety" in `README.md`). Say plainly whether this
   installation runs in one.

Do not submit a real change request yourself to "test" it unless the user asks: each request
runs the AI agent and costs budget.

## Using the project's own login

If the project has an admin area and its admins should be the ones who may edit, connect it
with the project's PHP session instead of the SayAndShape login:

```bash
"$ENGINE/bin/sayandshape" add /path/to/project --auth host --session-key admin_logged_in
```

- `--session-key`: the key in `$_SESSION` that is truthy for a logged-in admin (default
  `admin_logged_in`). Find it in the project's login code.
- `--session-name`: the name of the project's session cookie if it calls `session_name()`
  (default: PHP's standard name). The session cookie must be valid for the path `/`.
- The numeric user ID is read from `$_SESSION['user_id']` if present.
- Such a login may only edit this one project. Add `--engine-admin` if these admins may also
  open the setup page `/sayandshape/setup/`, where any folder on the server can be registered.
- The SayAndShape login keeps working in addition.

## More projects, sub-sites, changes, removal

- **Another site or sub-site:** run step 2 again with its folder and address. The same engine,
  password and worker serve all projects. A sub-site that has its own folder and address (for
  example `/var/www/site/shop` at `https://example.org/shop`) is simply another project.
- **Change settings:** run `bin/sayandshape add <folder> …` again, or use `/sayandshape/setup/` in the
  browser (after login). The file behind both is `config/apps.json`.
- **Update the engine:** `bin/sayandshape update` (pulls the latest version and restarts a worker
  started with `daemon start`; restart a systemd service yourself).
- **Remove a project:** `bin/sayandshape remove <id>` deletes `sayandshape-router.php` and the
  `.htaccess` block and unregisters the project. The project's files stay as they were; its
  variants stay in `clones/<id>/` unless you add `--purge`.
- **Which AI runs the changes:** `bin/sayandshape agent` (agent, API key or the CLI's sign-in), or
  `/sayandshape/setup/` → "Settings" (agent, model, effort). The settings are `agent` in
  `config/apps.json`; an API key and the agent sandbox (`--sandbox on|off`) can only be set on the
  command line.
- **Interface language:** `/sayandshape/setup/` → "Settings" → "Language", or
  `bin/sayandshape language en|de`. Stored as `language` in `config/apps.json`. The AI writes its
  summaries and answers in the language of each request, whatever this setting is.

## How the wiring works (for troubleshooting)

```text
browser ──► web server ──► <project>/sayandshape-router.php ──► ENGINE/router/router.php
                                                              ├─ /sayandshape/login/, /sayandshape/setup/, /sayandshape/api/*, /sayandshape/widget/*
                                                              ├─ /w/<variant>/…   files of that variant (ENGINE/clones/<id>/<variant>/)
                                                              └─ everything else  the published variant (serve: root)
```

- `sayandshape-router.php` is three lines: the project ID, the engine path, and an include of the
  engine's router. It contains no logic and is regenerated by `add`.
- Until the first change request, the published variant does not exist yet and the router
  serves the project folder itself.
- The panel's script tag is inserted into HTML pages on the fly, only for browsers that have
  logged in. Pages that already contain a `sayandshape-widget.js` tag are left alone.
- Links and assets that start with `/` work inside variants too: such a request coming from a
  page under `/w/<variant>/` is redirected into that variant.
- Paths starting with a dot (`.git`, `.env`, `.htaccess`) are never served from a variant.
- With `serve: root` every file of the project is delivered through PHP (with caching headers and
  byte ranges). That is fine for ordinary sites; for very busy ones put a cache in front or use
  `--serve prefix`, which leaves the live site to the web server.
- Cache buster: pages get each of their own stylesheets, scripts and images versioned with the file's
  change time and the variant's cache version, which every published change counts up
  (`css/site.css?v=12-1795185311`); a `v=` the page sets itself is replaced. Files are
  sent with `Cache-Control: no-cache`, so browsers ask again and get a short `304` while a file is
  unchanged. Nothing has to be set up for this, and the site's files are not edited for it.
- The engine folder carries an `.htaccess` that denies all direct web access (Apache). Nginx has
  no such safety net, so there the engine really must be outside the document root.

Reference for everything after installation (variants, safety checks, permissions, API):
[AGENTS.md](AGENTS.md) and [orchestrator/README.md](orchestrator/README.md).
