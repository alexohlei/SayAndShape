# SayAndShape job processing

`bin/sayandshape daemon start` or `daemon.sh` starts `worker.py` (Python 3.9+, standard library);
on servers it runs as the `sayandshape-daemon` service (`bin/sayandshape service` prints the unit).
It needs Git, Bash, jq, PHP and a signed-in AI agent (`claude` or `codex`).

## Flow

- `submit.php`, `rollback.php`, `reset.php`, `baseline.php`, `fork.php`,
  `delete_workspace.php` and `rename_workspace.php` write jobs atomically. Every job
  belongs to a variant (`workspace`). One active job per variant is allowed; further
  requests get HTTP 409 and the ID of the job that is already active.
- A worker lock prevents several daemons for the same queue. The daemon is a
  dispatcher: it starts one child process per job (`worker.py --job <file>`), at most
  `max_parallel_jobs` at once (default 1, `config/apps.json`, takes effect without a restart)
  and never two jobs of the same variant. An additional lock per variant protects the
  whole processing; a `fork` also holds the lock of the source variant.
- If a child process ends without a final status, only that job is marked as failed,
  and a publication it may have started is reset through its journal.
- Working copies and recovery journals live outside the web directory
  under `~/.local/state/sayandshape/<engine-path-hash>/`.
- Existing uncommitted changes in the published clone abort the job without touching
  those changes.
- The file check compares against the commit before the job started, checks staged,
  new and already agent-committed changes, and takes `extra_blocked_files` into account
  (relative paths or glob patterns).
- Only a successfully checked and committed working state is adopted.
  Reset and rollback are also carried out in a working copy first.
- Cancelling ends the process group. Working copies are discarded. A publication step
  that has already started is completed; the actual final state is shown.
- On restart, interrupted jobs are marked as failed, working copies are disposed of and
  an interrupted publication is reset. Confirmed successful jobs are not reset. Prompts
  are not run again automatically after a restart.

The working copy is not an operating-system sandbox. The existing Codex permission setting
was left unchanged by these measures.

## Variants (workspaces)

A variant is its own local Git repository under `clone_dir/<slug>/`, served under
`/w/<slug>/`. There is no remote; nothing is pushed.

- The public variant (`public_workspace`, default `main`) is created on the first job
  as a copy of `base_dir` without the `shared_dirs` and committed as "initial clone".
- `fork` creates a new variant: from another variant by a local `git clone`
  (objects are hard-linked, the `origin` remote is removed); the registry
  stores the parent slug and the fork commit, and `repo_state.initialize` sets the baseline of
  the new variant to the fork commit, so that the parent's history cannot be undone there.
  With `source: null` a fresh copy of the app is created instead.
- `delete` removes the directory and the registry entry; the public variant and parents
  of other variants are protected. `rename` changes only the display name.
- `promote` (target = parent variant, otherwise the public one) takes the commits of the source
  variant since the fork point or since the last merge (`promoted_head` in the
  registry) and cherry-picks them one by one onto the target's working copy. The
  target's history stays linear and every merged change can be undone individually; author and
  prompt are kept. Picks that already exist (empty) are skipped; a conflict
  blocks the job, naming the file and the prompt, and the target stays unchanged. Publication,
  journal and dependency check work as for a normal change.
- Before every job, files that the app itself wrote into the variant
  (uploads, settings made in its admin area) are committed as "Changes made in the app admin"
  with the author "App admin" (`auto_commit_host_changes`, default true; with false
  the job fails as before). `.DS_Store` and `.playwright-mcp/` are excluded through
  `.git/info/exclude`.
- The registry `clone_dir/workspaces.json` is written only by the worker, under
  a registry lock. `registry.py list <apps.json> <app>` returns it with Git facts
  (HEAD, changes since the fork point, recent commits with author); `workspaces.php`
  adds the active job per variant.
- Incomplete `.fork-*` directories from interrupted forks are removed on start.
- `migrate_workspaces.py [--apply]` registers old `user_<id>` clones as variants `user-<id>`.

The author name from the widget ("Your name") is stored in the job, used as the Git author of
the change commits and shown in the history.

## Widget / API

Status, history and variants require an admin session, like the writing endpoints.
Status and cancel check that the job belongs to the user. `status.php?app_id=…&workspace=…`
returns the active job of the variant or `null`. HTTP 202 means accepted,
not completed. The worker is the only writer of the status files.

The panel recognizes the variant from the URL (`…/w/<slug>/`), sends it with every
request and stores drafts, the last open tab and active job IDs locally, separated by
app, variant and logged-in user; name and panel position apply to the whole engine.
It starts as a minimised launcher, can be moved with the pointer (anchored bottom right,
kept inside the viewport, a bottom sheet on narrow screens) and stays above the app with the
highest z-index. The variant tree shows, per variant, lane dots for changes since
it branched off, running jobs with a prompt excerpt, and open, duplicate, merge,
rename and delete; `workspaces.php` is reloaded every 6 s while the panel is open.
"New variant" and "Duplicate" queue a `fork` job and switch to the new variant when it
completes; deleting the current variant switches to the public one. Speech is put into the
editable text field and only submitted with Send (or Ctrl/Cmd+Enter). After a successful
undo the job returns the complete original prompt for the text field.
"Clear" also removes the draft from local storage.

### Helper button, docking, Edit and Discuss

The launcher is a round helper button that starts at the bottom right and can be moved freely
(position engine-wide under `…:place`). It shows running jobs (ring), new answers or
follow-up questions (dot) and errors. The panel floats or docks to the left/right window edge:
with a button in the header, by dragging the header to the edge; the side is switched with a
button, the width is set at the inner edge (340–720 px). When docked, the page gets a matching
margin instead of being covered; below a window width of 760 px the panel always floats.

The panel has four views: **Edit**, **Discuss**, **History**, **Variants**.

**Result file.** The AI does not print its result as console text but writes a defined JSON
file (`<runtime directory>/<job>.result.json`, outside the working copy):

```json
{ "summary": "…", "points": ["…"],
  "questions": [{ "text": "…", "type": "single|multi|text", "options": ["…"] }],
  "suggestion": "…" }
```

The worker sanitises it (`sanitize_result`: lengths, counts, types; unknown fields are dropped)
and puts it into the job status as `result`. If the AI answers on the console after all, JSON is
read from that, otherwise the text is taken as `summary`. The panel builds DOM elements from it
(never `innerHTML`): summary, bullet points and follow-up questions as clickable choices
(`single`, `multi`) with a free answer field. `suggestion` exists only for Discuss. The worker
tells the AI to write all of this in the language of the request.

**Edit.** After a job the result card appears (it survives reloading the page, `…:last`). For
ambiguous requests the AI changes nothing and only asks follow-up questions (`done` without
`commit_hash`, no reload); the answers are sent together with the original request as a new
job. Follow-up questions after a change has been made start a follow-up job.

**Discuss.** `discuss.php`: `GET` returns the variant's chat, `POST {message}` queues a
`discuss` job, `POST {clear: true}` clears the chat (409 while a question is running). The job
runs read-only directly in the variant (Claude: tools Read/Grep/Glob/git log·show·diff, only the
result file is writable; Codex: `-s read-only`), without a working copy, commit or reload. The
worker appends question and answer to `jobs/.chat-<app>-<variant>.json` (at most 100 messages);
the last 12 go into the next prompt as conversation history. The AI answers in the language of
the question. After "Clear" the AI starts without prior context. A suggestion from the answer
can be taken over into Edit as a draft with one click. At most one job per variant still runs at
a time, whichever view it comes from.

**Hardened service.** With `RestrictSUIDSGID=yes` the worker may not set a setgid bit. Working
copies and new variants are therefore created with `copy_tree`/`fresh_dir` (the group is
inherited from the parent folder), and a job's working copy runs with
`core.sharedRepository=false`.

## Rollback permissions for individual changes

`rollback_policy.py` returns `can_rollback`, `is_latest`, `blocked_reason` and
`dependent_commits` for every visible history entry. The newest change stays
eligible regardless of the result of the check. The initial baseline is not
a change that can be undone.

Older changes are treated conservatively:

- Changes to files that later changes also edit are locked. This can also affect
  independent changes in the same file.
- For other older entries an additional read-only AI call checks functional
  dependencies, also across file boundaries. Only an explicit, valid
  `independent` result allows the undo. The check is not a formal guarantee
  that the app keeps working.
- Missing, unclear, oversized or invalid check results keep older entries locked.
  A failed checker does not prevent undoing the newest entry.
- The results are stored in `jobs/.rollback-policy-<app>-<variant>.json` and apply only
  to the exact current HEAD. After changes, resets and undos they are recalculated
  before publication. Hashes after a rebase are checked again.
- `rollback.php` checks before queueing; the worker checks again under the
  clone lock. A history that has changed in the meantime leads to rejection.
- In the widget a lock with the reason replaces the locked undo button.
  After an undo it reloads the permissions, so the entry that is now the newest
  can be undone again right away.

## New baseline and archived history

The pin icon ("Set new baseline") on the right of the history sends, after confirmation, a
`baseline` job to `baseline.php`. It adopts the current state of the variant as the new
baseline; the registered source app (`base_dir`) is not overwritten by this. The API and
worker checks prevent adopting a state that has changed in the meantime. Without new changes
there is nothing to adopt.

`repo_state.py` stores baseline and archives versioned in the separate Git ref
`refs/sayandshape/state`, outside the served app files. All changes remaining since the
last baseline are archived, including more than the 20 entries shown in the active history.
The archives contain date, prompts and commit IDs. References also keep the corresponding
Git states reachable.

After adopting a baseline the active history is empty. A native `details` element, initially
closed, shows one dated archive block per new baseline, without undo buttons. New changes
appear in the active history again and are subject to the dependency check. Undoing
individual archived changes is rejected on the server. Reset goes back only to the most
recently set baseline; archives are kept. Without a set baseline the initial clone remains
the starting baseline.

Working state and metadata are published under the same clone lock. The recovery journal
also contains the previous metadata ref; an aborted publication therefore restores both the
baseline and the archive state. Normal AI change jobs may not modify this ref.

## Tests (temporary repositories and local test servers only)

```sh
python3 orchestrator/tests/test_worker.py
python3 orchestrator/tests/test_api.py
python3 orchestrator/tests/test_install.py
python3 orchestrator/tests/test_rollback_policy.py
bash orchestrator/tests/test_prompt_filter.sh
bash orchestrator/tests/test_diff_review.sh
bash orchestrator/tests/test_git_ops.sh
node orchestrator/tests/test_widget.js   # without Node: call runWidgetTests(source) in a browser
```

`test_install.py` tests the installation path with a temporary copy of the engine:
`bin/sayandshape` (connecting and removing a project, detecting and selecting the AI agent
including an API key with stub `claude` and `codex` programs, password, worker), the bundled
router (public variant at the normal address or only under `/w/`, shared folders, dot-paths,
PHP pages inside their variant, inserting the panel) and both login methods (SayAndShape's own
login, the app's session and its restriction to its own project).

`apps.php` and `inspect_dir.php` (setup page) are tested in `test_api.py` with
temporary directories; `test_worker.py` covers fork, delete, rename,
merge (including conflict and repetition), auto-commit and the parallel dispatcher.

The worker tests simulate model execution and need no external API calls. The widget tests
simulate the DOM, network and speech recognition; real microphones and browser permission
dialogs are not covered.
