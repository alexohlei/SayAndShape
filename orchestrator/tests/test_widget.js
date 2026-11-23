// Dependency-free widget tests. Run with Node, or call runWidgetTests(source) in a JS runtime.
async function runWidgetTests(source) {
  const results = [];
  function assert(value, message) { if (!value) throw new Error(message); }
  async function mount(saved, response) {
    const nodes = new Map();
    const timers = new Map();
    const storage = saved || new Map();
    const calls = [];
    const recognitions = [];
    const navigations = [];
    let nextTimer = 0;
    let reloads = 0;
    class Element {
      constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.handlers = {}; this.attrs = {}; this.value = ''; this.disabled = false; this.classList = { add() {}, remove() {}, toggle() {} }; }
      set id(id) { this._id = id; nodes.set(id, this); }
      get id() { return this._id; }
      append(...children) { this.children.push(...children); }
      appendChild(child) { this.children.push(child); }
      get firstChild() { return this.children[0]; }
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
      addEventListener(type, handler) { this.handlers[type] = handler; }
      setAttribute(name, value) { this.attrs[name] = String(value); }
      focus() {}
      click() { if (!this.disabled && this.handlers.click) return this.handlers.click(); }
    }
    const document = {
      currentScript: { dataset: { app: 'demo' }, src: '/sayandshape/widget/sayandshape-widget.js' },
      readyState: 'complete', head: new Element('head'), body: new Element('body'), documentElement: { lang: 'en-GB' },
      createElement: tag => new Element(tag), getElementById: id => nodes.get(id)
    };
    class Speech {
      constructor() { recognitions.push(this); }
      start() {}
      stop() { if (this.onend) this.onend(); }
      result(text) { const result = [{ transcript: text }]; result.isFinal = true; this.onresult({ resultIndex: 0, results: [result] }); }
    }
    let jobStatus = null;
    let chatMessages = [];
    const uploads = new Map();
    const window = { SpeechRecognition: Speech, location: { reload() { reloads++; } } };
    const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, val) => storage.set(key, val), removeItem: key => storage.delete(key) };
    const workspacesData = { success: true, public: 'main', workspaces: [
      { slug: 'main', name: 'main', public: true, parent: null, exists: true, changes_since_fork: 3, active_job: null, promote: null,
        last_change: { author: 'Alex', date: '2026-09-17T10:00:00Z', message: 'Old prompt' } },
      { slug: 'winter', name: 'Winter', public: false, parent: 'main', exists: true, changes_since_fork: 1,
        active_job: { status: 'running', phase: 'editing', prompt: 'Snow' }, promote: { target: 'main', commits: 1, files: [{ path: 'demo.css', added: 3, deleted: 1 }] },
        last_change: { author: 'Maria', date: '2026-09-17T11:00:00Z', message: 'Snow' } }
    ] };
    const fetch = async (url, options = {}) => {
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : null;
      calls.push({ url, body });
      let data;
      let status = 200;
      if (response) {
        const custom = response(url, body);
        if (custom) { data = custom.data; status = custom.status || 200; }
      }
      if (!data) {
        if (url.includes('/session.php')) data = { success: true, logged_in: true, user_id: 1 };
        else if (url.includes('/history.php')) data = { success: true, commits: [{ hash: 'abc1234', message: 'Old prompt', date: '2026-09-17T10:00:00Z', can_rollback: true, is_latest: true }] };
        else if (url.includes('/workspaces.php')) data = workspacesData;
        else if (url.includes('/status.php')) data = { success: true, status: jobStatus };
        else if (url.includes('/upload.php')) {
          // Like api/upload.php: limits on GET; a POST carries one piece (here: an object with a size).
          const query = new URLSearchParams(url.split('?')[1]);
          if (options.method !== 'POST') data = { success: true, max_files: 2, max_bytes: 2097152, types: ['jpg', 'png', 'pdf'], chunk_bytes: 4 };
          else if (query.get('remove')) { uploads.delete(query.get('id')); data = { success: true }; }
          else {
            const id = query.get('id') || 'u_test_' + (uploads.size + 1);
            if (!uploads.has(id)) uploads.set(id, { id, name: query.get('name').replace(/ /g, '-'), size: Number(query.get('size')), received: 0 });
            const entry = uploads.get(id);
            entry.received += options.body.size;
            data = Object.assign({ success: true, complete: entry.received === entry.size }, entry);
          }
        }
        else if (url.includes('/cancel.php')) data = { success: true, status: jobStatus };
        else if (url.includes('/discuss.php') && !body) data = { success: true, messages: chatMessages };
        else if (url.includes('/discuss.php') && body.clear) { chatMessages = []; data = { success: true, messages: [] }; }
        else if (url.includes('/discuss.php')) {
          jobStatus = { job_id: 'j_test_1', status: 'pending', action: 'discuss', prompt: body.message };
          data = { success: true, job_id: 'j_test_1' };
        }
        else {
          const action = ['baseline', 'rollback', 'fork', 'promote', 'delete_workspace', 'rename_workspace', 'reset'].find(name => url.includes('/' + name + '.php'));
          jobStatus = { job_id: 'j_test_1', status: 'pending', action: (action || 'change').replace('_workspace', '') };
          data = { success: true, job_id: 'j_test_1' };
        }
      }
      return { ok: status >= 200 && status < 300, status, json: async () => data };
    };
    const setTimer = (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; };
    const clearTimer = id => timers.delete(id);
    class FakeURL { constructor(url) { this.pathname = url; } }
    class FakeAbortController { constructor() { this.signal = {}; } abort() {} }
    const location = { pathname: (saved && saved.get('__path')) || '/w/main/' };
    Object.defineProperty(location, 'href', { get() { return 'https://test' + this.pathname; }, set(value) { navigations.push(value); } });
    new Function('window', 'document', 'location', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout', 'URL', 'AbortController', 'confirm', 'prompt', source)(
      window, document, location, localStorage, fetch, setTimer, clearTimer, FakeURL, FakeAbortController, () => true, () => 'Winter Look');
    const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    await flush();
    return { nodes, calls, storage, recognitions, timers, flush, navigations, uploads, body: document.body,
      setStatus: value => { jobStatus = value; },
      setChat: value => { chatMessages = value; },
      async tick(delay) {
        const entry = [...timers.entries()].find(([, task]) => task.delay === delay);
        assert(entry, 'Missing timer ' + delay);
        timers.delete(entry[0]); entry[1].fn(); await flush();
      },
      reloads: () => reloads
    };
  }
  async function test(name, fn) { await fn(); results.push(name); }
  const key = 'sayandshape:/sayandshape:demo:main:1:';
  const textOf = button => (button.children[button.children.length - 1] || {}).textContent || button.textContent || '';

  await test('speech stays editable until explicit send; clear empties draft', async () => {
    const app = await mount();
    const get = id => app.nodes.get('sayandshape-' + id);
    get('mic-btn').click();
    assert(app.recognitions[0].lang === 'en-GB', 'Speech language not taken from the page');
    app.recognitions[0].result('Make the wall blue');
    get('mic-btn').click();
    await app.flush();
    assert(get('text-input').value === 'Make the wall blue', 'Speech draft missing');
    assert(!app.calls.some(c => c.url.includes('/submit.php')), 'Speech submitted automatically');
    get('text-input').value += ' and green'; get('text-input').handlers.input();
    get('send-btn').click(); await app.flush();
    assert(app.calls.find(c => c.url.includes('/submit.php')).body.transcript.endsWith('and green'), 'Edited prompt not submitted');
    get('send-btn').click(); await app.flush();
    assert(app.calls.filter(c => c.url.includes('/submit.php')).length === 1, 'Double submit');
    get('text-input').value = 'next'; get('clear-btn').click();
    assert(get('text-input').value === '' && app.storage.get(key + 'draft') === '', 'Clear did not persist');
  });
  await test('rollback restores full prompt, reloads and reopens the panel afterwards', async () => {
    const app = await mount();
    const button = app.nodes.get('sayandshape-history-list').children[0].children[2].children[0];
    button.click(); await app.flush();
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'rollback', commit_hash: 'hash', original_prompt: 'My old prompt\nwith a paragraph' });
    await app.tick(2000);
    assert(app.nodes.get('sayandshape-text-input').value === 'My old prompt\nwith a paragraph', 'Rollback draft not restored');
    await app.tick(1500);
    assert(app.reloads() === 1, 'Page not refreshed');
    const reloaded = await mount(app.storage);
    assert(reloaded.nodes.get('sayandshape-text-input').value === 'My old prompt\nwith a paragraph', 'Reload lost draft');
    assert(reloaded.nodes.get('sayandshape-panel').hidden === false, 'Panel did not reopen after the refresh');
    assert(!reloaded.storage.get('sayandshape:/sayandshape:reopen'), 'Reopen flag not cleared');
  });
  await test('job resumes after reload, shows the stepper and runs beyond old five minute timeout', async () => {
    const saved = new Map([[key + 'job', 'j_test_1']]);
    const app = await mount(saved, url => url.includes('/status.php') ? { data: { success: true, status: { job_id: 'j_test_1', status: 'running', phase: 'editing', action: 'change' } } } : null);
    assert(app.nodes.get('sayandshape-send-btn').disabled, 'Running job not resumed');
    const stepper = app.nodes.get('sayandshape-stepper');
    assert(stepper.hidden === false, 'Stepper hidden while editing');
    assert(stepper.children[2].className.includes('rs-step-active') && stepper.children[0].className.includes('rs-step-done'), 'Stepper does not mark the editing step');
    for (let i = 0; i < 151; i++) await app.tick(2000);
    assert(app.nodes.get('sayandshape-status').textContent === 'Making the change…', 'Incorrect timeout');
  });
  await test('cancel race reports success instead of false cancellation', async () => {
    const app = await mount();
    app.nodes.get('sayandshape-text-input').value = 'test'; app.nodes.get('sayandshape-send-btn').click(); await app.flush();
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'change', commit_hash: 'abc' });
    app.nodes.get('sayandshape-cancel-btn').click(); await app.flush();
    assert(app.nodes.get('sayandshape-status').textContent === '✓ Change applied!', 'False cancellation');
  });
  await test('server discovers active job when browser storage is absent', async () => {
    const app = await mount(null, url => url.includes('/status.php') ? { data: { success: true, status: { job_id: 'j_recovered', status: 'running', phase: 'checking' } } } : null);
    assert(app.storage.get(key + 'job') === 'j_recovered', 'Server job not recovered');
    assert(app.nodes.get('sayandshape-send-btn').disabled, 'Send enabled while running');
    assert(app.nodes.get('sayandshape-launcher-dot').className.includes('rs-orb-running'), 'Launcher does not show the running job');
  });
  await test('failed rollback keeps the current draft', async () => {
    const app = await mount();
    const input = app.nodes.get('sayandshape-text-input');
    input.value = 'Draft not sent yet'; input.handlers.input();
    app.nodes.get('sayandshape-history-list').children[0].children[2].children[0].click(); await app.flush();
    app.setStatus({ job_id: 'j_test_1', status: 'failed', action: 'rollback', blocked_reason: 'Conflict' });
    await app.tick(2000);
    assert(input.value === 'Draft not sent yet', 'Failed rollback replaced draft');
    assert(!app.nodes.get('sayandshape-send-btn').disabled, 'Controls remained disabled');
  });
  await test('final speech result is awaited before enabling submit', async () => {
    const app = await mount();
    const mic = app.nodes.get('sayandshape-mic-btn');
    mic.click();
    const speech = app.recognitions[0];
    speech.stop = function () {};
    mic.click();
    assert(app.nodes.get('sayandshape-send-btn').disabled, 'Submit enabled before final speech result');
    speech.result('Recognized only after stop'); speech.onend();
    assert(app.nodes.get('sayandshape-text-input').value === 'Recognized only after stop', 'Final speech result missing');
    assert(!app.nodes.get('sayandshape-send-btn').disabled, 'Submit stayed disabled');
    assert(!app.calls.some(c => c.url.includes('/submit.php')), 'Final result auto-submitted');
  });
  await test('polling network errors retain job and recover', async () => {
    let offline = true;
    const saved = new Map([[key + 'job', 'j_test_1']]);
    const app = await mount(saved, url => {
      if (url.includes('/status.php')) {
        if (offline) throw new Error('offline');
        return { data: { success: true, status: { job_id: 'j_test_1', status: 'running', phase: 'reviewing' } } };
      }
      return null;
    });
    assert(app.nodes.get('sayandshape-send-btn').disabled, 'Offline job allowed another submit');
    assert(app.storage.get(key + 'job') === 'j_test_1', 'Offline job forgotten');
    offline = false;
    await app.tick(2000);
    assert(app.nodes.get('sayandshape-status').textContent === 'Reviewing the files…', 'Polling did not recover');
  });
  await test('dependent rollback stays hidden across busy state changes and reappears after undo', async () => {
    let undone = false;
    const original = { hash: 'first123', message: 'Previous change', date: '2026-09-17T10:00:00Z', can_rollback: false, is_latest: false, blocked_reason: 'A newer change needs this function.', dependent_commits: ['second123'] };
    const newest = { hash: 'second123', message: 'Newest change', date: '2026-09-17T11:00:00Z', can_rollback: true, is_latest: true };
    const app = await mount(null, url => {
      if (url.includes('/history.php')) return { data: { success: true, commits: undone ? [{ ...original, can_rollback: true, is_latest: true, blocked_reason: '', dependent_commits: [] }] : [newest, original] } };
      return null;
    });
    const list = app.nodes.get('sayandshape-history-list');
    const olderButton = list.children[1].children[2].children[0];
    assert(olderButton.hidden && olderButton.disabled, 'Dependent rollback exposed');
    assert(list.children[1].children[3].textContent.includes('Newest change'), 'Dependency explanation missing');
    app.nodes.get('sayandshape-mic-btn').click();
    app.recognitions[0].result('Draft');
    app.nodes.get('sayandshape-mic-btn').click();
    assert(olderButton.hidden && olderButton.disabled, 'Controls update unlocked dependency');
    olderButton.click(); await app.flush();
    assert(!app.calls.some(c => c.url.includes('/rollback.php')), 'Locked rollback was submitted');
    const latestButton = list.children[0].children[2].children[0];
    assert(!latestButton.hidden && !latestButton.disabled, 'Latest rollback unavailable');
    latestButton.click(); await app.flush();
    undone = true;
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'rollback', original_prompt: 'Newest change', commit_hash: 'first123' });
    await app.tick(2000);
    const released = list.children[0].children[2].children[0];
    assert(!released.hidden && !released.disabled, 'Previous rollback did not reappear');
  });
  await test('new base button queues action and renders dated collapsed read-only archive', async () => {
    let archived = false;
    const commit = { hash: 'abc1234', message: 'Fix applied', date: '2026-09-17T10:00:00Z', can_rollback: true, is_latest: true };
    const app = await mount(null, url => {
      if (url.includes('/history.php')) return { data: { success: true, active_count: archived ? 0 : 1, commits: archived ? [] : [commit], archives: archived ? [{ id: 'base_1', created_at: '2026-09-18T12:00:00Z', commits: [commit] }] : [] } };
      return null;
    });
    const button = app.nodes.get('sayandshape-base-btn');
    assert(!button.hidden && !button.disabled, 'Base button missing');
    assert(button.title === 'Set the current state as the new baseline', 'Base button has no description');
    button.click(); await app.flush();
    assert(app.calls.some(c => c.url.includes('/baseline.php')), 'Base action not queued');
    assert(button.disabled, 'Base action can be submitted twice');
    archived = true;
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'baseline', commit_hash: 'abc1234' });
    await app.tick(2000);
    const list = app.nodes.get('sayandshape-history-list');
    const block = list.children.find(c => c.tagName === 'details');
    assert(block && !block.open, 'Archive does not start collapsed');
    assert(block.children[0].tagName === 'summary' && block.children[0].textContent.includes(new Date('2026-09-18T12:00:00Z').toLocaleDateString()), 'Archive date missing');
    const descendants = [];
    const visit = node => { descendants.push(node); node.children.forEach(visit); };
    visit(block);
    assert(!descendants.some(n => n.tagName === 'button'), 'Archive contains rollback actions');
    assert(descendants.some(n => n.textContent === 'Fix applied'), 'Archived prompt lost');
    assert(button.hidden && app.nodes.get('sayandshape-reset-btn').style.display === 'none', 'Empty active history still has actions');
    assert(app.nodes.get('sayandshape-last').hidden === true, 'Last-change card shown without changes');
  });
  await test('variant comes from the URL, is sent with every mutation and drawn as the current lane', async () => {
    const app = await mount(new Map([['__path', '/w/winter/']]));
    const get = id => app.nodes.get('sayandshape-' + id);
    assert(app.calls.some(c => c.url.includes('/status.php?app_id=demo&workspace=winter')), 'Resume did not name the variant');
    assert(app.calls.some(c => c.url.includes('/history.php?app_id=demo&workspace=winter')), 'History did not name the variant');
    get('author-input').value = 'Maria'; get('author-input').handlers.input();
    assert(get('author-chip').textContent === 'Maria', 'Author chip not updated');
    get('text-input').value = 'Snow'; get('send-btn').click(); await app.flush();
    const submit = app.calls.find(c => c.url.includes('/submit.php'));
    assert(submit.body.workspace === 'winter' && submit.body.app_id === 'demo', 'Submit without variant');
    assert(submit.body.author === 'Maria', 'Author name not sent');
    const current = get('ws-winter');
    assert(current && current.className.includes('rs-ws-current'), 'Current variant not highlighted');
    assert(current.children[0].children.some(n => n.textContent === 'you are here'), 'Current badge missing');
    assert(current.children[2].textContent.includes('from “main”'), 'Parent not shown: ' + current.children[2].textContent);
    const mainRow = get('ws-main');
    const open = mainRow.children[3].children.find(n => n.tagName === 'a');
    assert(open && open.href === '/w/main/', 'Open link for the other variant missing');
    assert(!current.children[3].children.some(n => n.tagName === 'a'), 'Current variant offers Open');
    assert(get('ws-chip').textContent === 'Winter', 'Header chip does not show the variant name');
    assert(get('scope').textContent.includes('“Winter”'), 'Scope hint does not name the variant');
  });
  await test('new variant is created from the public one via the inline form and the browser moves there', async () => {
    const app = await mount();
    app.nodes.get('sayandshape-fork-btn').click(); await app.flush();
    const form = app.nodes.get('sayandshape-fork-form');
    assert(form.hidden === false && app.nodes.get('sayandshape-fork-hint').textContent.includes('main'), 'Fork form not shown for main');
    app.nodes.get('sayandshape-fork-name').value = 'Winter Look';
    app.nodes.get('sayandshape-fork-go').click(); await app.flush();
    const fork = app.calls.find(c => c.url.includes('/fork.php'));
    assert(fork && fork.body.name === 'Winter Look' && fork.body.source === 'main' && fork.body.workspace === 'main', 'Fork request wrong');
    assert(app.nodes.get('sayandshape-send-btn').disabled, 'Controls stayed enabled while the variant is created');
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'fork', workspace: 'winter-look', name: 'Winter Look' });
    await app.tick(2000);
    assert(app.nodes.get('sayandshape-status').textContent.includes('Winter Look'), 'Fork success not shown');
    await app.tick(1200);
    assert(app.navigations[0] === '/w/winter-look/', 'Browser did not move to the new variant: ' + app.navigations[0]);
    assert(app.reloads() === 0, 'Page reloaded instead of navigating');
    assert(app.storage.get('sayandshape:/sayandshape:reopen') === '1' && app.storage.get('sayandshape:/sayandshape:tab') === 'variants', 'Panel will not reopen on the variants view after the jump');
    const landed = await mount(new Map([...app.storage, ['__path', '/w/winter-look/']]));
    assert(landed.nodes.get('sayandshape-panel').hidden === false && landed.nodes.get('sayandshape-view-variants').hidden === false, 'Panel did not reopen on the variants view in the new variant');
    assert(!landed.storage.get('sayandshape:/sayandshape:tab'), 'One-shot tab flag not cleared');
  });
  await test('duplicating another variant forks from that one', async () => {
    const app = await mount();
    const winterRow = app.nodes.get('sayandshape-ws-winter');
    const duplicate = winterRow.children[3].children.find(n => n.tagName === 'button');
    duplicate.click(); await app.flush();
    assert(app.nodes.get('sayandshape-fork-hint').textContent.includes('Winter'), 'Fork hint does not name the source');
    app.nodes.get('sayandshape-fork-name').value = 'Winter dark';
    app.nodes.get('sayandshape-fork-go').click(); await app.flush();
    assert(app.calls.find(c => c.url.includes('/fork.php')).body.source === 'winter', 'Duplicate did not fork from the chosen variant');
  });
  await test('promote button on a forked variant queues promotion into its parent', async () => {
    const app = await mount(new Map([['__path', '/w/winter/']]));
    const promote = app.nodes.get('sayandshape-promote-btn');
    assert(promote && !promote.disabled && textOf(promote).includes('main'), 'Promote button missing or disabled');
    promote.click(); await app.flush();
    const call = app.calls.find(c => c.url.includes('/promote.php'));
    assert(call && call.body.workspace === 'winter', 'Promotion not queued for the current variant');
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'promote', workspace: 'main', promoted_commits: 1 });
    await app.tick(2000);
    assert(app.nodes.get('sayandshape-status').textContent.includes('Merged 1 change into “main”'), 'Promotion result not shown');
    assert(app.reloads() === 0 && app.navigations.length === 0, 'Promotion reloaded or navigated unexpectedly');
    assert(!app.nodes.get('sayandshape-ws-main').children[3].children.some(n => n.id === 'sayandshape-promote-btn'), 'Public variant offers promotion');
  });
  await test('deleting the current variant moves the browser to the public one', async () => {
    const app = await mount(new Map([['__path', '/w/winter/']]));
    assert(!app.nodes.get('sayandshape-ws-main').children[3].children.some(n => n.id === 'sayandshape-delete-btn'), 'Public variant can be deleted');
    app.nodes.get('sayandshape-delete-btn').click(); await app.flush();
    assert(app.calls.find(c => c.url.includes('/delete_workspace.php')).body.workspace === 'winter', 'Delete not queued');
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'delete', workspace: 'winter' });
    await app.tick(2000);
    await app.tick(1200);
    assert(app.navigations[0] === '/w/main/', 'Did not move to the public variant');
  });
  await test('launcher opens the panel, minimize and Escape close it, panel starts minimized', async () => {
    const app = await mount();
    const panel = app.nodes.get('sayandshape-panel');
    const launcher = app.nodes.get('sayandshape-launcher');
    assert(panel.hidden === true && launcher.hidden !== true, 'Panel not minimized at start');
    launcher.click();
    assert(panel.hidden === false && launcher.hidden === true, 'Launcher did not open the panel');
    app.nodes.get('sayandshape-minimize').click();
    assert(panel.hidden === true && launcher.hidden === false, 'Minimize did not close the panel');
    launcher.click();
    panel.handlers.keydown({ key: 'Escape' });
    assert(panel.hidden === true, 'Escape did not close the panel');
    app.nodes.get('sayandshape-tab-variants').click();
    assert(app.nodes.get('sayandshape-view-variants').hidden === false && app.nodes.get('sayandshape-view-change').hidden === true, 'Tab switch failed');
    assert(app.storage.get(key + 'tab') === 'variants', 'Tab not remembered');
  });
  await test('dragging the launcher moves the anchor, persists it and does not count as a click', async () => {
    const app = await mount();
    const launcher = app.nodes.get('sayandshape-launcher');
    const root = app.nodes.get('sayandshape-root');
    launcher.handlers.pointerdown({ button: 0, clientX: 500, clientY: 500, pointerId: 1, target: launcher });
    launcher.handlers.pointermove({ clientX: 400, clientY: 450, pointerId: 1 });
    launcher.handlers.pointerup({ pointerId: 1 });
    assert(root.style.right === '124px' && root.style.bottom === '74px', 'Anchor not moved: ' + root.style.right + ' ' + root.style.bottom);
    assert(JSON.parse(app.storage.get('sayandshape:/sayandshape:place')).right === 124, 'Anchor not persisted');
    launcher.click();
    assert(app.nodes.get('sayandshape-panel').hidden === true, 'Drag end opened the panel');
    launcher.click();
    assert(app.nodes.get('sayandshape-panel').hidden === false, 'Next click did not open the panel');
    const again = await mount(app.storage);
    assert(again.nodes.get('sayandshape-root').style.right === '124px', 'Anchor not restored after reload');
  });
  const all = (node, match, out = []) => { (node.children || []).forEach(child => { if (match(child)) out.push(child); all(child, match, out); }); return out; };
  const byClass = (node, name) => all(node, child => String(child.className || '').split(' ').includes(name));
  const result = { summary: 'The wall is blue now.', points: ['Blue background'], questions: [
    { id: 'q1', text: 'The tiles too?', type: 'single', options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] },
    { id: 'q2', text: 'Which areas?', type: 'multi', options: [{ label: 'Header', description: '' }, { label: 'Footer', description: '' }] }] };

  await test('published change shows the result card, survives the reload and answers become a follow-up request', async () => {
    const app = await mount();
    app.nodes.get('sayandshape-text-input').value = 'Make the wall blue'; app.nodes.get('sayandshape-send-btn').click(); await app.flush();
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'change', commit_hash: 'abc1234', files_changed: ['demo.css'], prompt: 'Make the wall blue', result });
    await app.tick(2000);
    const card = app.nodes.get('sayandshape-result');
    assert(card.hidden === false && card.className.includes('rs-result-done'), 'Result card missing');
    assert(byClass(card, 'rs-question').length === 2 && byClass(card, 'rs-option').length === 4, 'Questions not drawn as options');
    assert(app.storage.get(key + 'last') === 'j_test_1', 'Result not remembered for the reload');
    await app.tick(1500);
    assert(app.reloads() === 1, 'Published change did not reload the page');
    const reloaded = await mount(app.storage, url => url.includes('/status.php?job_id=j_test_1')
      ? { data: { success: true, status: { job_id: 'j_test_1', status: 'done', action: 'change', commit_hash: 'abc1234', prompt: 'Make the wall blue', result } } } : null);
    const again = reloaded.nodes.get('sayandshape-result');
    assert(again.hidden === false, 'Result card lost after reload');
    assert(reloaded.nodes.get('sayandshape-last').hidden === true && reloaded.nodes.get('sayandshape-result-undo').hidden === false, 'Undo did not move into the result card');
    const send = byClass(again, 'rs-questions')[0].children[2].children[0];
    assert(send.disabled === true, 'Answers can be sent without an answer');
    const options = byClass(again, 'rs-option');
    options[0].click(); options[2].click(); options[3].click();
    assert(options[0].className.includes('rs-option-on') && send.disabled === false, 'Option not selected');
    send.click(); await reloaded.flush();
    const sent = reloaded.calls.find(c => c.url.includes('/submit.php')).body.transcript;
    assert(sent.includes('Make the wall blue') && sent.includes('- The tiles too? → Yes') && sent.includes('- Which areas? → Header, Footer'), 'Answers not sent: ' + sent);
  });
  await test('questions without a change keep the page and repeat the request with the answers', async () => {
    const app = await mount();
    app.nodes.get('sayandshape-text-input').value = 'Make it nicer'; app.nodes.get('sayandshape-send-btn').click(); await app.flush();
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'change', commit_hash: null, prompt: 'Make it nicer',
      result: { summary: 'I need a decision for that.', points: [], questions: [{ id: 'q1', text: 'Which style?', type: 'text', options: [] }] } });
    await app.tick(2000);
    const card = app.nodes.get('sayandshape-result');
    assert(card.className.includes('rs-result-ask') && !app.timers.size || ![...app.timers.values()].some(t => t.delay === 1500), 'Page reload scheduled without a change');
    const free = byClass(card, 'rs-question-free')[0];
    free.value = 'Light and calm'; free.handlers.input();
    byClass(card, 'rs-questions')[0].children[1].children[0].click(); await app.flush();
    const sent = app.calls.filter(c => c.url.includes('/submit.php'))[1].body.transcript;
    assert(sent.startsWith('Make it nicer') && sent.includes('- Which style? → Light and calm'), 'Follow-up request wrong: ' + sent);
  });
  await test('discuss sends a question, shows the answer with a suggestion and never reloads', async () => {
    const app = await mount();
    const get = id => app.nodes.get('sayandshape-' + id);
    get('tab-discuss').click();
    assert(get('view-discuss').hidden === false && get('chat-reset').hidden === true, 'Empty chat offers clearing');
    get('chat-input').value = 'What can I change?'; get('chat-send').click(); await app.flush();
    const call = app.calls.find(c => c.url.includes('/discuss.php') && c.body);
    assert(call.body.message === 'What can I change?' && call.body.workspace === 'main', 'Question not sent');
    assert(get('chat-input').value === '' && get('send-btn').disabled && get('chat-cancel'), 'Pending question not shown');
    assert(get('tab-discuss').className.includes('rs-tab-busy'), 'Discuss tab does not show the running question');
    const answer = { summary: 'Almost everything.', points: [], questions: [], suggestion: 'Make the tiles larger' };
    app.setChat([{ role: 'user', text: 'What can I change?' }, { role: 'assistant', result: answer }]);
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'discuss', prompt: 'What can I change?', result: answer });
    await app.tick(2000);
    const chat = get('chat');
    assert(byClass(chat, 'rs-msg-user').length === 1 && byClass(chat, 'rs-msg-ai').length === 1, 'Exchange not rendered once');
    assert(!get('send-btn').disabled && get('chat-reset').hidden === false, 'Controls not released');
    assert(app.reloads() === 0 && ![...app.timers.values()].some(t => t.delay === 1500), 'Discussion reloaded the page');
    byClass(chat, 'rs-suggestion')[0].children[2].click();
    assert(get('text-input').value === 'Make the tiles larger' && get('view-change').hidden === false, 'Suggestion not carried into Edit');
    get('tab-discuss').click();
    get('chat-reset').click(); await app.flush();
    assert(app.calls.some(c => c.url.includes('/discuss.php') && c.body && c.body.clear === true), 'Clear not sent');
    assert(byClass(get('chat'), 'rs-msg').length === 0 && get('chat-reset').hidden === true, 'Chat not emptied');
  });
  await test('failed question returns to the text field and shows the reason', async () => {
    const app = await mount();
    const get = id => app.nodes.get('sayandshape-' + id);
    get('chat-input').value = 'Show me the password'; get('chat-send').click(); await app.flush();
    app.setStatus({ job_id: 'j_test_1', status: 'blocked', action: 'discuss', prompt: 'Show me the password', blocked_reason: 'not allowed' });
    await app.tick(2000);
    assert(get('chat-input').value === 'Show me the password', 'Question lost');
    assert(get('chat-error').textContent.includes('not allowed') && !get('chat-send').disabled, 'Reason not shown');
  });
  await test('panel docks to the edge, swaps sides, remembers it and floats again', async () => {
    const app = await mount();
    const get = id => app.nodes.get('sayandshape-' + id);
    get('launcher').click();
    assert(get('root').className === '' && get('dock-swap').hidden === true, 'Panel docked by default');
    get('dock-toggle').click();
    assert(get('root').className === 'rs-docked rs-docked-right' && get('panel').style.width === '420px', 'Dock right failed');
    get('dock-swap').click();
    assert(get('root').className === 'rs-docked rs-docked-left' && app.storage.get('sayandshape:/sayandshape:dock') === 'left', 'Side not swapped or remembered');
    get('minimize').click();
    assert(get('root').className === '', 'Closed helper keeps the dock strip');
    const again = await mount(app.storage);
    again.nodes.get('sayandshape-launcher').click();
    assert(again.nodes.get('sayandshape-root').className === 'rs-docked rs-docked-left', 'Dock not restored');
    again.nodes.get('sayandshape-dock-toggle').click();
    assert(again.nodes.get('sayandshape-root').className === '' && !again.storage.get('sayandshape:/sayandshape:dock'), 'Undock failed');
  });

  const session = language => url => url.includes('/session.php')
    ? { data: Object.assign({ success: true, logged_in: true, user_id: 1 }, language === undefined ? {} : { language }) } : null;
  const tabLabels = app => ['change', 'discuss', 'history', 'variants'].map(name => app.nodes.get('sayandshape-tab-' + name).textContent);

  await test('language "de" from the session builds the panel in German from the start', async () => {
    const app = await mount(null, session('de'));
    const get = id => app.nodes.get('sayandshape-' + id);
    assert(tabLabels(app).join() === 'Bearbeiten,Diskutieren,Verlauf,Varianten', 'Tabs not German: ' + tabLabels(app));
    assert(textOf(get('send-btn')) === 'Änderung starten', 'Submit button not German: ' + textOf(get('send-btn')));
    assert(get('root').attrs.lang === 'de', 'Panel not marked as German');
    assert(get('launcher').attrs['aria-label'] === 'Bearbeiten und Diskutieren öffnen' && get('launcher').title.startsWith('Bearbeiten und Diskutieren'), 'Launcher not German');
    assert(get('text-input').placeholder.startsWith('Zum Beispiel:') && get('minimize').title === 'Minimieren', 'Placeholder or tooltip not German');
    assert(get('history-count').textContent === '1 Änderung seit der Basis', 'History count not German: ' + get('history-count').textContent);
    const meta = get('history-list').children[0].children[0].textContent;
    assert(meta.startsWith(new Date('2026-09-17T10:00:00Z').toLocaleDateString('de-DE')) && meta.endsWith(' · neueste'), 'History date not German: ' + meta);
    assert(get('ws-main').children[0].children.some(n => n.textContent === 'öffentlich'), 'Variant badge not German');
    // Nothing was ever drawn in English: the panel is built once, after the session answer.
    const english = ['Edit', 'Discuss', 'History', 'Variants', 'Apply change', 'Cancel', 'Undo'];
    assert(!all(app.body, node => english.includes(node.textContent)).length, 'English text in a German panel');
    get('mic-btn').click();
    assert(app.recognitions[0].lang === 'en-GB', 'Speech language tied to the interface setting');
  });
  await test('German answers to follow-up questions go to the AI in German', async () => {
    const app = await mount(null, session('de'));
    app.nodes.get('sayandshape-text-input').value = 'Mach es schöner'; app.nodes.get('sayandshape-send-btn').click(); await app.flush();
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'change', commit_hash: null, prompt: 'Mach es schöner',
      result: { summary: 'Dafür brauche ich eine Entscheidung.', points: [], questions: [{ id: 'q1', text: 'Welcher Stil?', type: 'text', options: [] }] } });
    await app.tick(2000);
    const card = app.nodes.get('sayandshape-result');
    assert(card.children[0].children[1].children[0].textContent === 'Rückfrage vor der Änderung', 'Result card not German');
    const free = byClass(card, 'rs-question-free')[0];
    assert(free.placeholder === 'Antwort eingeben …', 'Answer field not German');
    free.value = 'Ruhig'; free.handlers.input();
    const send = byClass(card, 'rs-questions')[0].children[1].children[0];
    assert(textOf(send) === 'Antworten senden und ändern', 'Answer button not German');
    send.click(); await app.flush();
    const sent = app.calls.filter(c => c.url.includes('/submit.php'))[1].body.transcript;
    assert(sent === 'Mach es schöner\n\nMeine Antworten auf deine Rückfragen:\n- Welcher Stil? → Ruhig', 'Follow-up not German: ' + sent);
  });
  const file = (name, size) => ({ name, size, slice: (from, to) => ({ size: Math.min(to, size) - from }) });
  const dropped = files => ({ preventDefault() {}, dataTransfer: { types: ['Files'], files } });
  const uploadCalls = app => app.calls.filter(c => c.url.includes('&name=') || c.url.includes('/upload.php?id='));
  const fileRows = app => app.nodes.get('sayandshape-file-list').children;

  await test('dropped and chosen files upload in pieces, are listed and travel with the request', async () => {
    const app = await mount();
    const get = id => app.nodes.get('sayandshape-' + id);
    assert(get('files').hidden === false && get('drop').disabled === false, 'Drop area not offered');
    assert(get('drop').children[1].children[1].textContent === 'Up to 2 files, 2 MB each', 'Limits not shown');
    assert(get('file-input').accept === '.jpg,.png,.pdf' && get('file-input').multiple === true, 'File dialog not limited to the allowed types');
    const view = get('view-change');
    view.handlers.dragenter(dropped([]));
    assert(get('drop').className.includes('rs-drop-active'), 'Drop area not highlighted while dragging');
    view.handlers.drop(dropped([file('My photo.jpg', 10), file('tool.exe', 5), file('empty.png', 0)]));
    assert(!get('drop').className.includes('rs-drop-active'), 'Highlight stays after the drop');
    assert(get('send-btn').disabled, 'Sending possible while a file is uploading');
    await app.flush(); await app.flush();
    const pieces = uploadCalls(app).map(c => c.url.split('?')[1]);
    assert(pieces.join(' ') === 'app_id=demo&name=My%20photo.jpg&size=10 id=u_test_1&offset=4 id=u_test_1&offset=8', 'Pieces wrong: ' + pieces.join(' '));
    assert(fileRows(app).length === 1 && fileRows(app)[0].children[1].textContent === 'My-photo.jpg', 'Stored name not listed');
    assert(fileRows(app)[0].children[2].textContent === '1 KB', 'Size not shown after the upload');
    const note = get('file-note').textContent;
    assert(note.includes('tool.exe') && note.includes('empty.png'), 'Rejected files not named: ' + note);
    assert(!get('send-btn').disabled, 'Sending stays locked after the upload');
    get('file-input').files = [file('plan.pdf', 3), file('third.png', 3)];
    get('file-input').handlers.change(); await app.flush();
    assert(fileRows(app).length === 2 && get('drop').disabled, 'Limit of two files not enforced');
    assert(get('file-note').textContent === 'At most 2 files per request.', 'Limit not explained: ' + get('file-note').textContent);
    assert(JSON.parse(app.storage.get(key + 'files')).map(f => f.id).join() === 'u_test_1,u_test_2', 'Uploads not remembered');
    get('text-input').value = 'Use the photo as header'; get('send-btn').click(); await app.flush();
    const sent = app.calls.find(c => c.url.includes('/submit.php')).body;
    assert(sent.attachments.join() === 'u_test_1,u_test_2' && sent.transcript === 'Use the photo as header', 'Files not sent with the request');
    assert(fileRows(app).length === 0 && !app.storage.get(key + 'files') && app.uploads.size === 2, 'List not cleared after sending, or uploads discarded');
  });
  await test('attached files survive a reload, can be removed, and block sending after a failed upload', async () => {
    const saved = new Map([[key + 'files', JSON.stringify([{ id: 'u_old_1', name: 'logo.png', size: 2048 }])]]);
    let fail = true;
    const app = await mount(saved, (url, body) => url.includes('&name=') && fail ? { status: 413, data: { success: false, message: 'The file is too large (max. 1 MB)' } }
      : url.includes('/submit.php') && body.attachments.includes('u_gone') ? { status: 410, data: { success: false, message: 'Gone', missing: ['u_gone'] } } : null);
    const get = id => app.nodes.get('sayandshape-' + id);
    assert(fileRows(app).length === 1 && fileRows(app)[0].children[1].textContent === 'logo.png', 'Files lost on reload');
    get('view-change').handlers.drop(dropped([file('big.jpg', 9)])); await app.flush();
    assert(fileRows(app)[1].className.includes('rs-file-error') && fileRows(app)[1].children[2].textContent.includes('too large'), 'Failed upload not marked');
    get('text-input').value = 'Add the logo'; get('send-btn').click(); await app.flush();
    assert(!app.calls.some(c => c.url.includes('/submit.php')), 'Request sent although a file failed');
    fileRows(app)[1].children[3].click();
    fileRows(app)[0].children[3].click(); await app.flush();
    assert(app.calls.some(c => c.url.includes('id=u_old_1&remove=1')), 'Removed upload not discarded on the server');
    assert(fileRows(app).length === 0 && !app.storage.get(key + 'files') && get('file-list').hidden, 'Removed file still listed');
    // An upload the server no longer has is taken off the list; the text stays.
    app.storage.set(key + 'files', JSON.stringify([{ id: 'u_gone', name: 'old.png', size: 1 }]));
    const again = await mount(app.storage, (url, body) => url.includes('/submit.php') && body.attachments ? { status: 410, data: { success: false, message: 'Gone', missing: ['u_gone'] } } : null);
    again.nodes.get('sayandshape-text-input').value = 'Add the logo'; again.nodes.get('sayandshape-send-btn').click(); await again.flush();
    assert(fileRows(again).length === 0 && again.nodes.get('sayandshape-text-input').value === 'Add the logo', 'Missing upload not dropped');
    assert(again.nodes.get('sayandshape-status').textContent.includes('Gone'), 'Reason not shown');
  });
  await test('files of a request come back with a rejection and go along with answers to questions', async () => {
    const app = await mount();
    const get = id => app.nodes.get('sayandshape-' + id);
    const attachments = [{ id: 'u_a', name: 'team.jpg', size: 4096 }];
    get('text-input').value = 'Add the team photo'; get('send-btn').click(); await app.flush();
    app.setStatus({ job_id: 'j_test_1', status: 'done', action: 'change', commit_hash: null, prompt: 'Add the team photo', attachments,
      result: { summary: 'Where should it go?', points: [], questions: [{ id: 'q1', text: 'Which page?', type: 'text', options: [] }] } });
    await app.tick(2000);
    const card = get('result');
    assert(byClass(card, 'rs-result-meta').some(node => node.textContent === 'Files: team.jpg'), 'Files not named on the result card');
    const free = byClass(card, 'rs-question-free')[0];
    free.value = 'About us'; free.handlers.input();
    byClass(card, 'rs-questions')[0].children[1].children[0].click(); await app.flush();
    assert(app.calls.filter(c => c.url.includes('/submit.php'))[1].body.attachments.join() === 'u_a', 'Files not sent again with the answers');
    app.setStatus({ job_id: 'j_test_1', status: 'blocked', action: 'change', blocked_reason: 'No', prompt: 'Add the team photo', attachments });
    await app.tick(2000);
    assert(get('text-input').value === 'Add the team photo' && fileRows(app).length === 1, 'Rejected request did not return its files');
  });
  await test('no drop area when the project does not take uploads', async () => {
    const app = await mount(null, url => url.includes('/upload.php') ? { data: { success: true, max_files: 0, max_bytes: 1, types: ['jpg'], chunk_bytes: 4 } } : null);
    assert(app.nodes.get('sayandshape-files').hidden === true, 'Drop area shown although uploads are off');
    app.nodes.get('sayandshape-view-change').handlers.drop(dropped([file('a.jpg', 3)])); await app.flush();
    assert(!app.calls.some(c => c.url.includes('&name=')), 'Upload started although uploads are off');
  });
  await test('missing or unknown language keeps the panel in English', async () => {
    for (const language of [undefined, 'fr', '', null, 'toString']) {
      const app = await mount(null, session(language));
      assert(tabLabels(app).join() === 'Edit,Discuss,History,Variants', 'Tabs not English for ' + language + ': ' + tabLabels(app));
      assert(textOf(app.nodes.get('sayandshape-send-btn')) === 'Apply change', 'Submit button not English for ' + language);
      assert(app.nodes.get('sayandshape-root').attrs.lang === 'en', 'Panel not marked as English for ' + language);
      assert(app.nodes.get('sayandshape-history-count').textContent === '1 change since the baseline', 'History count not English for ' + language);
    }
  });
  return results;
}

if (typeof module !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  runWidgetTests(fs.readFileSync(path.join(__dirname, '../../widget/sayandshape-widget.js'), 'utf8'))
    .then(results => console.log(results.length + ' widget tests passed\n' + results.join('\n')))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
