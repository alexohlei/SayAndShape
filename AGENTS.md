# SayAndShape — Guide for AI Coding Agents

SayAndShape lets logged-in people change a web project (static site or PHP app) by text or voice.
An AI agent edits a copy of the project (a *variant*); only reviewed changes are published.

## If you were asked to install SayAndShape

Follow **[INSTALL.md](INSTALL.md)** from top to bottom. In short:

```bash
gh repo clone alexohlei/SayAndShape "$ENGINE"          # engine folder, outside every document root
"$ENGINE/bin/sayandshape" init && "$ENGINE/bin/sayandshape" doctor
"$ENGINE/bin/sayandshape" agent                             # which AI agent is installed, signed in, selected
"$ENGINE/bin/sayandshape" add /path/to/project --url https://example.org --server apache|nginx|php
"$ENGINE/bin/sayandshape" passwd --generate
"$ENGINE/bin/sayandshape" daemon start
"$ENGINE/bin/sayandshape" check <id> --url https://example.org
```

Do not wire a project by hand: `bin/sayandshape add` writes the project's `sayandshape-router.php`
(three lines pointing at `router/router.php` in the engine) and the web server rules, and
`bin/sayandshape remove` takes them out again. The project's own pages are never edited; the panel's
script tag is inserted on the fly for logged-in browsers.

## If you are working on this repository

- Layout: `api/` (PHP endpoints, `auth.php` holds login and shared helpers), `router/router.php`
  (front controller for every project), `login/`, `setup/` (pages), `widget/` (panel),
  `orchestrator/` (Python worker, safety checks, Git helpers, tests), `bin/sayandshape` (CLI),
  `install.sh`, `config/apps.example.json`.
- `config/apps.json`, `config/auth.json`, `.agent-keys.json`, `jobs/` and `clones/` belong to an
  installation and are not tracked. Never copy deployed `jobs/`, clones, logs or cached permissions into this repository.
- Run the test suites listed in `orchestrator/README.md` before finishing a change. They use
  temporary repositories, local PHP test servers and simulated model runs; they never call a model.
- Standard library only (Python), no Composer or npm dependencies. PHP 8.1+, Python 3.9+,
  Bash 3.2 compatible shell scripts (macOS).
- The interface is English by default and switchable to German (`language` in `config/apps.json`).
  English text is the key: PHP translates through `sayandshapeT()` (`api/i18n.php`), the worker
  through `orchestrator/i18n.py`, the panel through its `I18N` table. A new user-facing string needs
  its German entry in the same change. The CLI and the installation are English only. The AI agent
  answers in the language of the request (result summaries, follow-up questions, Discuss chat).

## What an installation provides

- **Logged-in people** see a small round helper button ("Edit"), minimized,
  bottom right by default and draggable anywhere (visitors see the site view-only — no edit UI is rendered)
- The app is served in **variants** (workspaces): each variant is its own local
  Git clone under `/w/{slug}/`. The public variant (default `main`) is what visitors see; any
  variant can be cloned with one click and edited independently, in parallel with the others
- The launcher is a round helper button; the panel it opens floats or docks to the left/right
  window edge. Besides the views below there is **Discuss**, a read-only chat about the app
  whose answers (like the results of change requests) are shown as cards with clickable
  follow-up questions, written in the language of the request; see "Helper button, docking, Edit and Discuss" in `orchestrator/README.md`
- Clicking the launcher opens the panel with these views: **Edit** (text or voice
  request, running-job stepper, last change with undo), **Variants** (tree of variants with
  open, duplicate, merge into the parent, rename, delete) and **History** (per-change undo,
  baseline and archives)
- Admins also get `/sayandshape/setup/`, a page to register and configure projects without editing
  JSON by hand
- Voice input fills an editable text field; clicking Send (or Ctrl/Cmd+Enter) submits it
- Files can be attached to a request: dropped onto the area below the text field or chosen in the
  file dialog, several at once. The AI agent gets them with the request, copies what belongs on
  the site to a fitting place and uses it there; see "Files with a request" in `orchestrator/README.md`
- The AI agent (Claude or Codex) modifies a temporary working copy and publishes it only after successful review
- The widget reloads the page when the job completes
- Users can roll back approved independent changes (the newest is always eligible),
  reset to the current baseline, cancel a job, or establish a new baseline.
  Earlier changes then appear in dated, initially collapsed archive blocks
- "Merge into “main”" replays a variant's prompt commits into its parent (or the public
  variant) one by one, so they stay individually undoable there; conflicts block with the
  file and prompt named, and nothing changes in the target
- Files the host app writes itself (admin uploads, settings) are committed as
  "Changes made in the app admin" before a job runs, so an admin edit never blocks
  SayAndShape (`auto_commit_host_changes`, default true)

- Login is either SayAndShape's own page (`/sayandshape/login/`, one shared password per engine, set with
  `bin/sayandshape passwd`) or, per project, the project's own PHP admin session (`auth.mode: "host"`)

## Configuration (`config/apps.json`)

Written by `bin/sayandshape add` and the setup page. Per project (`apps.<id>`):

| Key | Meaning |
|---|---|
| `base_dir` | the project folder. It is copied once into the public variant and otherwise left alone; shared directories are still served from it |
| `clone_dir` | where the project's variants and their registry (`workspaces.json`) live, normally `ENGINE/clones/<id>` |
| `app_url` | public address of the project; its path is the mount point when the web server does not reveal it |
| `serve` | `root` (default): the public variant is served at the project's normal addresses. `prefix`: variants only under `/w/<slug>/`, `/` redirects to the public one, everything else is left to the web server |
| `server` | `apache`, `nginx` or `php`: which wiring `bin/sayandshape add` generated |
| `public_workspace` | slug of the variant visitors see (default `main`). Created lazily from `base_dir` on the first job; can never be deleted |
| `shared_dirs` | directories that are **not** copied into variants (uploads, media). The router serves them from `base_dir` when a variant has no own file |
| `allowed_changes` | one sentence describing what people may change; part of the read-only guardrail that judges every request |
| `auth` | `{"mode": "engine"}` (default) or `{"mode": "host", "session_name": …, "session_key": …, "user_key": …, "engine_admin": …}` |
| `inject_widget` | `false` to stop the router from inserting the panel's script tag (then add the tag yourself) |
| `allowed_origins` | additional origins that may call the API (also possible at the top level) |
| `auto_commit_host_changes` | commit files the app itself writes into a variant before a job instead of refusing the job (default true) |
| `max_files_per_change`, `extra_blocked_files`, `extra_blocked_patterns` | limits and protected files for the diff review and the prompt filter |
| `max_upload_files`, `max_upload_mb`, `upload_types` | files people may attach to a request: how many (default 10, `0` switches uploads off), how large each (default 25 MB, at most 200) and which file endings (default: images, video, audio, fonts, documents, `html`, `css`, `js`). Server code such as `php` is never accepted |

Top level: `max_parallel_jobs` (jobs at once across all projects, never more than one per variant),
`language` (`en`, the default, or `de`: interface language of the panel, login, setup page, API and
worker messages and the commit subjects the worker writes; `bin/sayandshape language` or the setup
page) and `agent` (`engine`: `claude` or `codex`, models, `effort`, and `sandbox`: on unless it is
`false`, see "The agent sandbox"; changed with `bin/sayandshape agent --sandbox on|off`, never
through the setup page or the API).

`bin/sayandshape init` detects which of the two CLIs are installed and signed in; in a terminal it asks
which one to use and whether it signs in with the CLI's own login or an API key, otherwise it takes
the installed one. `bin/sayandshape agent [--engine claude|codex] [--api-key-stdin | --login] [--test]`
changes that later. A key is stored per agent in `.agent-keys.json` in the engine folder (mode 0600,
outside `config/` because that folder is shared with the web server's group) and reaches the agent
only as `ANTHROPIC_API_KEY` or `CODEX_API_KEY` in its environment. The setup page and the API never
read or write it.

## Login and who may do what

- **Engine login** (`auth.mode: "engine"`, default): `/sayandshape/login/` checks the shared password
  (`config/auth.json`, bcrypt) and opens a session named `SAYANDSHAPE_<hash>` stored under
  `jobs/.sessions/`. It is an *engine admin*: all projects, the setup page, the AI settings.
  A non-secret cookie `sayandshape_ui` tells the router to insert the panel.
- **Host login** (`auth.mode: "host"`): the API opens the project's own PHP session
  (`session_name`, default PHP's) and treats `$_SESSION[session_key]` (default `admin_logged_in`)
  as admin; the user ID comes from `$_SESSION[user_key]` (default `user_id`, fallback 1). Such a
  login is confined to the project whose router the request came through; with
  `engine_admin: true` it counts as engine admin too. The engine login works in addition.
- Sessions are only opened when the browser sent the cookie, so visitors never get one. Opening a
  session never sets a cookie (`sayandshapeOpenSession()` starts it with `use_cookies` off): the
  cookie the login set, SayAndShape's or the app's, keeps its lifetime and attributes.
- Pages are sent with `Cache-Control: no-cache`, `Vary: Cookie` and an `ETag` that differs with and
  without the panel, so a page a browser loaded before the login is fetched again after it.
- The server side is the security boundary: every endpoint calls `sayandshapeRequireAdmin()` or
  `sayandshapeRequireEngineAdmin()` (`apps.php`, `agent.php`, `inspect_dir.php`, setup page), and
  `sayandshapeApp()` rejects other projects for a confined login. POST endpoints accept only
  `application/json` from the same host (or `allowed_origins`).

## How variants work

A **variant** (workspace, slug `[a-z0-9-]`, max 40 chars) is one local Git repository under
`clone_dir/<slug>/`, served at `/w/<slug>/`. Nothing is pushed anywhere: all Git repositories
stay on this machine.

1. The public variant (`public_workspace`, default `main`) is created on the first job: the app
   directory minus `shared_dirs` is copied and committed as "initial clone". Visitors see it at
   `/w/main/`; `/` redirects there.
2. **`fork.php`** creates a new variant as a job. From another variant it is a local
   `git clone` (objects are hard-linked, so it is fast and small); the registry records the
   parent slug and the fork commit, and the fork's baseline metadata start at that commit, so
   the parent's history is not undoable inside the fork. From the app itself (`source: null`)
   it is a fresh copy like the public variant.
3. Jobs operate in disposable working copies outside the web directory; reviewed changes are
   committed and then published to the variant. Changes in one variant never touch another.
4. `delete_workspace.php` removes a variant and its repository; the public variant and variants
   that still have children are protected. `rename_workspace.php` changes the display name only.
5. The registry `clone_dir/workspaces.json` is written only by the worker. `workspaces.php`
   returns it enriched with Git facts (head, changes since the fork, recent commits with author)
   and the active job per variant, which is what a panel needs to draw the branch tree.

The worker refuses to overwrite uncommitted changes in a published variant and checks its
baseline again before publication. Temporary copies and recovery journals live under
`~/.local/state/sayandshape/<engine-path-hash>/` for the daemon user. The working copy alone is
not a boundary; the editing agent is confined to it by the agent sandbox (see below).

Only one active job per variant is accepted (HTTP 409 includes the active job ID); different
variants run in parallel up to `max_parallel_jobs`. Submission, rollback, reset, baseline, fork,
delete and rename return HTTP 202 when queued; poll `status.php` until `done`, `failed`,
`blocked`, or `cancelled`. After a worker restart, interrupted jobs fail without automatically
retrying their prompts; pending jobs remain queued. A cancellation during publication reports
the actual completed result.

### The setup page (`/sayandshape/setup/`)

`setup/index.php` is served through a project's router and requires an engine admin. It lists
the projects from `config/apps.json` with variant counts, running jobs and whether the daemon
holds its lock, and it saves projects through `api/apps.php` (atomic write, validated: absolute
existing `base_dir` outside the engine, slug ids, relative `shared_dirs`, limits). "Check" calls
`api/inspect_dir.php`, which reports size, file count, entry file and suggests `shared_dirs`
from large or media-like folders. The web server user therefore needs write access to
`config/` and `config/apps.json` (see INSTALL.md, step 4). Its "Settings" section saves the
interface language and the AI agent through `api/agent.php`. Registering a project in the UI does not
wire the project itself: run `bin/sayandshape add <folder> --id <id>` once on the server, as the page shows.

### Migrating legacy per-user clones

Deployments from before variants existed keep clones at `clone_dir/user_<id>/`. Run

```bash
python3 SayAndShape/orchestrator/migrate_workspaces.py          # dry run
python3 SayAndShape/orchestrator/migrate_workspaces.py --apply  # rename to user-<id> and register
```

Each legacy clone becomes a root variant `user-<id>` with its full history, reachable at
`/w/user-<id>/` (the old `/u/<id>/` addresses are gone). The public variant is still created fresh from the app on its first job, so promote the
changes you want to keep from a legacy variant by re-requesting them (or adopt the legacy variant
as the public one by setting `public_workspace` to its slug).

---

## Adding app-specific safety rules

Edit `SayAndShape/config/apps.json` to add patterns specific to your app:

```json
{
  "apps": {
    "my-app": {
      ...
      "extra_blocked_patterns": [
        "admin",
        "superuser",
        "billing"
      ],
      "extra_blocked_files": [
        ".env",
        "config/database.php",
        "config/stripe.php"
      ]
    }
  }
}
```

`extra_blocked_patterns` are regex patterns checked against the submitted text before the AI agent runs. `extra_blocked_files` are relative paths or glob patterns checked against all changes from the pre-job commit, including staged, new, and agent-committed files. If review rejects a change, its working copy is discarded.

### The three safety stages

Every change passes through three checks before it is committed:

1. **Pattern filter** (`orchestrator/safety/prompt-filter.sh`) — regex match against the
   transcript, including your `extra_blocked_patterns`. Fast, dumb, runs first.
2. **LLM guardrail** (in `orchestrator/worker.py`) — a read-only AI call that
   semantically judges whether the request stays within the app's editable surface.
   It is **fail-closed**: an empty/error verdict blocks the change.
   Changing and deleting inside the site is allowed (content, sections, pages, images, files:
   every change can be undone); anything that reaches beyond the site is not (other sites,
   projects, files or programs on the server, its configuration, authentication, secrets).
   What users may change comes from the project's `allowed_changes` sentence; the fixed part of
   the prompt lives in `Worker.process_locked()` in `worker.py`. The AI engine, model and effort
   come from `agent` in `config/apps.json`.
   Files attached to the request are named to it; their content is not judged here. That is
   why only the file types of `upload_types` are accepted and server code never is.
3. **Diff review** (`orchestrator/safety/diff_review.py`, also available through
   `diff-review.sh`) — checks changes against the fixed baseline, blocked paths,
   dangerous patterns (code that runs programs on the server, such as `system`, `shell_exec`
   or `popen`), symlinks, and `max_files_per_change`. Deleted files pass like changed ones.
   Only a successful result is committed and published; rejected workspaces are discarded.

### The agent sandbox

The three stages judge the request and the result. The agent sandbox limits what the agent can do
in between, while it edits. It is on by default (`agent.sandbox`, anything but `false`):

| | Sandbox on (default) | `agent.sandbox: false` |
|---|---|---|
| Claude Code | `--permission-mode acceptEdits`, tools `Read,Grep,Glob,Edit,Write,Bash`, and settings with `sandbox.enabled`, `failIfUnavailable`, `allowUnsandboxedCommands: false` and `permissions.blockReadsOutsideWorkingDirectories` | `--dangerously-skip-permissions` |
| Codex | `-s workspace-write`, `approval_policy="never"`, no network, the result file as the only extra writable path | `--dangerously-bypass-approvals-and-sandbox` |

With the sandbox on, the agent can change and delete files in the working copy of the change and
write its result file. Writing anywhere else on the server and network access are refused by the
CLI's operating-system sandbox (Seatbelt on macOS, bubblewrap on Linux). Claude's file tools and
shell also cannot read outside the working copy, in read-only calls (guardrail, Discuss,
dependency audit) as well; Codex's sandbox does not restrict reading. If the sandbox cannot start,
the call fails and the job with it; nothing runs unprotected.

- Claude Code needs version 2.1.257 or newer and, on Linux, `bubblewrap` and `socat`.
  `bin/sayandshape doctor` reports what is missing.
- Switch it off with `bin/sayandshape agent --sandbox off` only where the sandbox cannot start and
  something else is the fence: inside a container or VM that holds nothing but the sites to edit.
  The agent then has every permission of the worker's user. `doctor` warns while it is off.
- The switch lives in `config/apps.json` and is changed on the command line. `api/agent.php` keeps
  a stored value and ignores one sent to it, so the shared login cannot switch the sandbox off.
- It does not cover what the site's own code does later: a page the agent wrote runs with the
  rights of the web server. The guardrail and the diff review address that; a container limits it.

---

## Web server wiring

`bin/sayandshape add` generates the wiring; nothing is copied by hand.

- **Apache:** a block between `# BEGIN SayAndShape` and `# END SayAndShape` at the top of the project's
  `.htaccess`. With `serve: root` every request of the project goes to `sayandshape-router.php`; with
  `serve: prefix` only `/w/…`, `/sayandshape/…` and the start page. Needs `mod_rewrite` and
  `AllowOverride FileInfo`.
- **Nginx:** `config/nginx-<id>.conf` holds a `location` block that passes the project's requests
  to PHP-FPM with `SCRIPT_FILENAME` set to the project's `sayandshape-router.php`. It has to be placed
  in the site's `server { }` block.
- **PHP built-in server:** `php -S localhost:8080 -t <project> <project>/sayandshape-router.php`.

The router (`router/router.php`) finds the mount point from the rewrite target (`SCRIPT_NAME` ends
in `/sayandshape-router.php`) or from the path of `app_url`. It serves variants with conditional
requests and byte ranges, runs PHP pages inside their variant (working directory, `SCRIPT_FILENAME`),
never serves dot-paths or the router stub from a variant, and redirects root-absolute requests
that come from a page under `/w/<slug>/` into that variant.

Because the web server never sees what the router serves, the router applies the site's own
`.htaccess` denials itself (`sayandshapeRtForbidden()`): a folder whose `.htaccess` says
`Require all denied` or `Deny from all` at the top level (also inside `<IfModule>`) answers 403,
together with everything below it, until a subfolder allows access again; files denied by
`<Files>` or `<FilesMatch>` answer 403 in that folder and below. `<If>`, `<Limit>` and other
conditional sections are not evaluated. Without this, `/w/<slug>/data/…` would hand out what the
site keeps closed under its normal address.

### Cache buster

Every variant has a cache version, a number in `clone_dir/<slug>/.git/sayandshape-cache-version`
(never served, never committed, not copied into a fork). The worker counts it up whenever it
publishes a new state of the variant's files: a change, an undo, a reset, a merge, and when it
withdraws an interrupted publication. A variant without a published change has none.

The router uses it, together with each file's change time, for visitors and logged-in people alike:

- In HTML pages (static files and the output of PHP pages) it versions `href`, `src` and `poster` of
  `<link>`, `<script>`, `<img>`, `<source>`, `<video>`, `<audio>` and `<track>` when the address
  names a stylesheet, script, image, font or media file of the site itself:
  - the file is found in the variant (or, for a shared directory, in the app folder):
    `?v=<number>-<change time>`, or `?v=<change time>` while the variant has no cache version yet
    (also when the app folder itself is served). A change made outside SayAndShape counts as well,
    and only the changed file gets a new address.
  - the file is not found: `?v=<number>`, nothing without a cache version.
  - A `v=` the page already carries (`app.js?v=2025`) is replaced for files that are found, so
    pages that version their files by hand still show every change; for files that are not found
    it stays.
  - Addresses of other hosts, `data:` addresses, anchors and module scripts (`type="module"`,
    `modulepreload`) stay as they are.
- Every file is sent with `Cache-Control: no-cache` and an `ETag`, so browsers ask again on each use
  and get a `304` while the file is unchanged. That also covers what a page loads without a tag
  (images in CSS, imports, `fetch`). A page's `ETag` is taken from the HTML that is sent, so it
  changes with the versions of the files it loads and with the panel.
- PHP output is filtered for page views only (`Accept: text/html` and an HTML response), for visitors
  in blocks of 1 MiB; API answers, downloads and event streams pass through untouched.

The site's files are not edited for this, so it adds nothing to a change and never locks an undo.
With `serve: prefix` the live site at its normal address is served by the web server and is not
covered; the variants under `/w/<slug>/` are.

### File ownership & git permissions (two-user setups)

On a real server, **two different OS users touch the clone git repos**:
- The **web server user** (e.g. `www-data`) runs the PHP endpoints — including the
  queue writes and read-only history queries.
- The **daemon user** runs `worker.py`, the AI agent, publication, rollback, and reset.

If these are different users, plain git will refuse to operate ("dubious ownership") and
new files may not be accessible to the other user. SayAndShape already handles the git-trust
side for history: `history.php` trusts the configured clone for its read. New clones
are created by the daemon with `core.sharedRepository=group`; the worker itself must
own or explicitly trust any existing clone repositories. Share the queue and clones
with the web server and allow the daemon to write its private runtime directory:

```bash
# Put both users in a shared group (e.g. add the daemon user to www-data's group)
sudo usermod -aG www-data <daemon-user>

# Share queue and clones; make new files inherit the group (setgid on directories)
sudo chgrp -R www-data /path/to/SayAndShape/clones /path/to/SayAndShape/jobs /path/to/SayAndShape/config
sudo chmod -R g+rwX /path/to/SayAndShape/clones /path/to/SayAndShape/jobs /path/to/SayAndShape/config
sudo find /path/to/SayAndShape/clones /path/to/SayAndShape/jobs -type d -exec chmod g+s {} +
```

Run the daemon with `UMask=0002` (e.g. in its systemd unit) so its commits stay
group-writable. If web server and daemon run as the **same** user, none of this is needed.

> **Production daemon:** prefer a systemd unit (`bin/sayandshape service` prints one) over
> `bin/sayandshape daemon start`, so it restarts on boot/crash. It needs Python, `claude` or `codex` in `PATH`, that agent's credentials
> available to the daemon user, and a writable home/runtime directory. The worker sets
> umask `0002`; use `UMask=0002` in the service too.

### Securing the mutating endpoints

The `submit`/`reset`/`rollback`/`baseline` endpoints enqueue work; `cancel` requests an interruption.
The worker lets the AI agent edit without approval prompts, inside the agent sandbox (see "The agent
sandbox"); with `agent.sandbox: false` it runs without any limit
(`claude --dangerously-skip-permissions`, `codex --dangerously-bypass-approvals-and-sandbox`).
These endpoints, status, and history require `sayandshapeRequireAdmin()` (see "Login and who may do what").
Set the login password (`bin/sayandshape passwd`) or connect the project's admin session before exposing a project.

---

## Registering another project

`bin/sayandshape add /path/to/other-project --url …` (or the setup page plus that command). The same
engine, login and worker serve all projects; the worker picks up configuration changes without a restart.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| SayAndShape launcher not visible | Not logged in, panel not inserted, or widget not reachable | Log in at `/sayandshape/login/`; run `bin/sayandshape check <id> --url …`; confirm `/sayandshape/api/session.php` returns `{"logged_in":true}`; the page needs a `</body>` tag |
| Launcher visible on some pages only, or gone after restarting the browser (noticed in Firefox) | Fixed in 1.1.0: pages loaded before the login were reused from the browser cache without the panel, and the session cookie lost its lifetime on the first API call | Update the engine and log in once more. Still missing on single pages: the page has no `</body>`, is served by the web server itself (`serve: prefix`, another host name such as `www.`), or was opened over `http` while the login was made over `https` |
| Status stuck on processing indicator | Daemon not running | Start daemon: `bash SayAndShape/orchestrator/daemon.sh` |
| `401 "Not logged in"` on submit/rollback/reset | Session expired or not set | Log in again at `/sayandshape/login/`; with `auth.mode: "host"` check `session_name`/`session_key` and that the session cookie path is `/` |
| "Unknown project" | The project is not in `config/apps.json` (any more) | `bin/sayandshape list`; run `bin/sayandshape add <folder>` again |
| Job fails right after "editing"/"checking" | AI agent CLI missing, not signed in for the worker user, or its API key is wrong or unreadable for that user | `bin/sayandshape doctor`; `bin/sayandshape agent --test` as the worker user; see `daemon.log` |
| Job fails right after "editing" with "Execution failed", `daemon.log` mentions the sandbox | The agent sandbox cannot start: `bubblewrap`/`socat` missing (Linux, Claude Code), or a container that does not allow a nested sandbox | `bin/sayandshape doctor`; install `bubblewrap` and `socat`; inside a container or VM only: `bin/sayandshape agent --sandbox off` |
| The agent reports it could not do something (download a file, run a command, touch another folder) | The agent sandbox refused it: no network, no writing outside the working copy | Intended. Put the file into the project yourself, or rephrase the request so that it stays inside the site |
| A request to delete something is blocked | The guardrail allows deleting inside the site, not beyond it; or the pattern filter matched a word (`unlink`, `truncate`, `delete from`, …) | Read the reason in the job status; rephrase ("remove the old gallery page") |
| Visitors still see an old stylesheet or image | The file is loaded from another host or cached by a proxy in front of the site; or the project uses `serve: prefix` | See "Cache buster"; check the page source for `?v=<number>` and the response for `Cache-Control: no-cache` |
| Change blocked, "Prompt check failed" or the guardrail's reason | LLM guardrail rejected it (fail-closed) | Check the job status; adapt the guardrail `prompt` in `worker.py` to the app |
| Job blocked before publication | Prompt or diff review rejected it | Inspect the job status (`blocked_reason`) and daemon log |
| HTTP 409 on a mutation | An active job in this variant, dependent rollback, stale history, empty baseline, duplicate variant name, or a protected variant | Resume the returned job ID when present; otherwise show the response reason and refresh history |
| HTTP 404 "Variant not found" | Slug is neither the public variant nor registered | Check `clone_dir/workspaces.json`; run `migrate_workspaces.py` for legacy `user_<id>` clones |
| `403 "No access to this project"` / "This requires the SayAndShape login" | Logged in through a project's own admin session | Use the SayAndShape login, or set `auth.engine_admin` for that project |
| Site shows the old state at its normal address | Project uses `serve: prefix` | Published changes are under `/w/main/`; switch with `bin/sayandshape add <folder> --serve root` |
| Login says "Too many failed attempts" | 8 wrong passwords from one address within 10 minutes | Wait, or delete `jobs/.login-attempts.json` |
| Variant shows the app's old media | Expected for `shared_dirs` | Shared directories are served from `base_dir`; only files the agent adds inside the variant override them |
| Jobs in different variants run one after another | `max_parallel_jobs` is 1 | Raise it in `config/apps.json` or on `/sayandshape/setup/`; the daemon picks it up without restart |
| "Cannot merge: … conflicts with the target variant" | Both variants changed the same lines since the fork or last merge | Undo the conflicting change in the variant, or create a fresh variant from the target and redo the request there |
| Setup page says "Configuration not writable" | `config/apps.json` not writable by the web server user | see INSTALL.md, step 4 (shared group on `config/`) |
| Launcher sits off-screen after a window resize | Saved anchor outside the viewport | It is clamped on the next resize/open; otherwise clear `sayandshape:…:anchor` in localStorage |
| Clone contains uncommitted changes | Existing edits are protected | Review and resolve those edits before resubmitting |
| `git` "dubious ownership" / permission denied on rollback | Web server & daemon are different users | Set up shared group + setgid + `safe.directory` (see "File ownership & git permissions") |
| No drop area for files below the text field | `max_upload_files` is 0, `upload_types` is empty, or the engine's `api/upload.php` is missing | Set them on `/sayandshape/setup/` ("Advanced"); update the engine |
| A file is refused ("This file type is not allowed here", "too large") | Not in the project's `upload_types`, a type that is never accepted (`php`, …), or larger than `max_upload_mb` | Adjust the project on `/sayandshape/setup/`; put server code into the project yourself |
| "Upload could not be saved" | The web server user cannot write `jobs/.uploads/` | Same shared group and permissions as `jobs/` (see "File ownership & git permissions") |
| "An uploaded file is no longer available" | The upload is older than a day or was removed | Add the file again |
| Mic button does nothing | Speech API unavailable or permission denied | Use the text field; check microphone permissions and HTTPS |

## Template regression checks

Run the test suites listed in `orchestrator/README.md` from the engine directory.
They use temporary repositories, local test servers, and simulated model execution.
They do not submit real AI jobs or change deployed clones.


## Baselines, rollback permissions, and archives

The API and worker both enforce rollback permissions; hiding a button alone is not
sufficient. `rollback_policy.py` compares permissions against the current HEAD and
only considers commits after the current baseline. `repo_state.py` stores baseline
and complete dated archives in `refs/sayandshape/state`, not in the app's working files.
The latest active change is always eligible; unknown dependencies and shared-file
overlaps keep older changes locked. The editing prompt and a separate read-only
semantic audit both address dependencies. See `orchestrator/README.md` for details.

`baseline.php` uses the same admin authentication, job ownership, serialization,
atomic publication and crash recovery as other mutations. It affects only the
current user's clone; it does not replace the configured source app. Reset uses the
latest adopted baseline, and archived changes have no individual rollback action.
Never copy deployed `jobs/`, clones, logs, or cached permissions back into this template.
