(function () {
  'use strict';

  /* SayAndShape helper: a round, draggable helper button (bottom right at first) that opens the editing
     panel. The panel floats or docks to the left/right edge of the window and has four views:
     Edit (change requests, result card with follow-up questions), Discuss (read-only chat),
     History and Variants. Visible only with an admin session; starts minimized. */

  const script  = document.currentScript;
  const APP_ID  = script.dataset.app || '';
  // …/sayandshape/widget/sayandshape-widget.js → …/sayandshape  (works from the domain root or a sub-path)
  const SAYANDSHAPE_BASE = new URL(script.src, location.href).pathname.replace(/\/widget\/[^\/]*$/, '');
  const API      = SAYANDSHAPE_BASE + '/api';
  const APP_BASE = SAYANDSHAPE_BASE.replace(/\/sayandshape$/, '');
  const SLUG     = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const ACCENT   = /^#[0-9a-fA-F]{6}$/.test(script.dataset.accent || '') ? script.dataset.accent : '';
  const DOCK_MIN = 340, DOCK_MAX = 720, DOCK_DEFAULT = 420;

  // Which variant this page belongs to: the URL decides, then data-workspace, then the public one.
  function detectWorkspace() {
    const path = typeof location.pathname === 'string' ? location.pathname : '';
    const match = path.startsWith(APP_BASE + '/w/') ? path.slice(APP_BASE.length + 3).split('/')[0] : '';
    if (SLUG.test(match)) return match;
    const configured = script.dataset.workspace || '';
    return SLUG.test(configured) ? configured : 'main';
  }
  const WORKSPACE = detectWorkspace();

  let isOpen = false;
  let isRecording = false;
  let recognition = null;
  let rec = null;                 // composer the microphone is currently filling
  let pollTimer = null;
  let wsTimer = null;
  let toastTimer = null;
  let finalTranscript = '';
  let interimTranscript = '';
  let speechPrefix = '';
  let currentJobId = null;
  let currentAction = null;       // action of the running job ('change', 'discuss', …)
  let busy = true;
  let cancelling = false;
  let storagePrefix = '';
  let workspaces = [];
  let publicSlug = 'main';
  let historyData = null;
  let lastResult = null;          // status of the last finished change request shown as result card
  let anchor = { right: 24, bottom: 24 };
  let dock = 'float';             // 'float' | 'right' | 'left'
  let dockWidth = DOCK_DEFAULT;
  let attention = false;          // something new arrived while the panel was closed
  const chat = { messages: [], pending: null, error: '' };
  const ui = {};
  let historyButtons = [];
  let variantButtons = [];
  let answerButtons = [];
  let uploadLimits = null;        // what the project accepts (upload.php): { max_files, max_bytes, types, chunk_bytes }
  let attachments = [];           // files for the next request: { id, name, size, sent, state: queued|uploading|done|error, error, file }
  let uploading = false;
  let lang = 'en';                // interface language from session.php ('en' | 'de'); the panel is built after it is known

  /* ── Interface language ──────────────────────────────── */

  // Every text the panel shows, by short id. `{name}` is filled from the vars passed to t();
  // ids ending in _one/_other are picked by count through tn().
  const I18N = {
    en: {
      themeLight: 'Light theme', themeDark: 'Dark theme',
      justNow: 'just now', minAgo: '{n} min ago', hoursAgo: '{n} h ago', yesterday: 'yesterday', daysAgo: '{n} days ago',
      quote: '“{text}”',
      changeCount_one: '1 change', changeCount_other: '{n} changes', theChanges: 'the changes',
      fileCount_one: '1 file', fileCount_other: '{n} files',
      launcherOpen: 'Open Edit and Discuss', launcherIdle: 'Edit and Discuss – click to open, drag to move',
      panelLabel: 'Edit and Discuss', showVariants: 'Show variants',
      setupTitle: 'Setup (for administrators)', setup: 'Setup',
      dockSwap: 'Move to the other side', dock: 'Dock to the edge', undock: 'Undock (move freely)', resize: 'Drag to resize',
      minimize: 'Minimize',
      tabChange: 'Edit', tabDiscuss: 'Discuss', tabHistory: 'History', tabVariants: 'Variants',
      answering: 'Answering…', working: 'Working…', newAnswer: 'New answer', questionForYou: 'Question for you', failed: 'Failed',
      speak: 'Speak', stopRecording: 'Stop recording', clearText: 'Clear text', recording: 'Recording…',
      micUnavailable: 'Microphone not available, please type', micError: 'Microphone error: {error}',
      changeLabel: 'What should change?', changeAria: 'Describe the change',
      changePlaceholder: 'For example: Make the background dark blue and the headings a bit larger',
      changeReview: 'Check the text, then send it with “Apply change”', applyChange: 'Apply change',
      dropFiles: 'Add files: drop them here or click to choose', dropNow: 'Drop the files here',
      dropHint: 'Up to {count} files, {size} MB each', removeFile: 'Remove {name}',
      fileWaiting: 'waiting…', uploadFailed: 'Upload failed',
      fileTypeNotAllowed: '“{name}”: this file type is not allowed here.', fileTooLarge: '“{name}” is larger than {size} MB.',
      fileEmpty: '“{name}” is empty.', filesTooMany: 'At most {count} files per request.',
      uploadsRunning: 'Files are still uploading. Please wait a moment.',
      uploadsFailed: 'First remove the files that could not be uploaded.',
      attachedFiles: 'Files: {files}',
      scopeHelp: 'Where does the change go?',
      scopePublic: 'This is the public variant. Visitors see changes as soon as they are applied.',
      scopeVariant: 'The change only goes into the variant “{name}”. The public variant stays unchanged until you merge it.',
      stepCheck: 'Check', stepEdit: 'Edit', stepReview: 'Review', stepApply: 'Apply',
      cancel: 'Cancel',
      workingAs: 'You are working as', changeName: 'Change name', addName: 'Add your name',
      namePlaceholder: 'Your name, e.g. Maria', nameAria: 'Your name',
      discussLabel: 'Talk through questions and ideas', discussHelp: 'How does Discuss work?',
      discussHint: 'Ask questions and talk through ideas here without changing anything. “Clear” deletes the conversation; the AI then starts without any memory of it.',
      clear: 'Clear', clearTitle: 'Clear the conversation and start over',
      askAria: 'Ask a question', askPlaceholder: 'Ask a question… (Enter sends)',
      askReview: 'Check the text, then send it with “Ask”', ask: 'Ask',
      noConversation: 'No conversation yet. Try asking:',
      example1: 'What can I change here?', example2: 'What was changed last?', example3: 'How could the page look more modern?',
      suggestedChange: 'Suggested change', useInEdit: 'Use in “Edit”',
      chatCancelling: 'Cancelling…', lookingAtApp: 'Looking at the app…', sendingQuestion: 'Sending the question…',
      chatQueued: 'Queued…', writingAnswer: 'Looking at the app and writing an answer…',
      jobRunning: 'A job is already running in this variant. Please wait.',
      questionKept: '{message} – your question stays in the text field.',
      newAnswerToast: 'New answer in “Discuss”',
      clearConfirm: 'Clear the conversation? Everything said so far is deleted and the AI starts without any memory of it.',
      chatCleared: 'Conversation cleared',
      variantsHint: 'Each variant is a separate copy of the app. Try things out safely and merge what you like later.',
      forkName: 'Name of the new variant', create: 'Create', newVariant: 'New variant',
      forkHint: 'Copy of “{name}”. All changes so far are included.',
      noVariants: 'No variants yet', badgePublic: 'public', badgeHere: 'you are here',
      laneNoOwn: 'no changes of its own yet', laneOriginal: 'original state', laneLater: 'created with the first request',
      fromParent: 'from “{name}”', open: 'Open', duplicate: 'Duplicate', duplicateTitle: 'Create a copy of this variant',
      mergeInto: 'Merge into “{target}”', nothingToMerge: 'Nothing new to merge', rename: 'Rename', delete: 'Delete',
      promoteConfirm: 'Merge all changes from “{from}” into “{target}”? They will appear there as separate changes that can each be undone.',
      renamePrompt: 'New name for this variant:',
      deleteConfirm: 'Permanently delete the variant “{name}”? All changes in it will be lost.',
      setBaseline: 'Set new baseline', setBaselineTitle: 'Set the current state as the new baseline', setBaselineAria: 'Set new baseline',
      historyHint: 'Each change is one step. You can undo the latest one at any time, older ones only if nothing builds on them.',
      historyHelp: 'How does History work?', discardAll: 'Discard everything since the baseline',
      historyCount: '{changes} since the baseline',
      noChangesSinceBase: 'No changes since the last baseline', noChanges: 'No changes yet',
      latest: 'latest', undo: 'Undo',
      undoLatestTitle: 'Latest change – can be undone at any time', undoCheckedTitle: 'Checked: no later change depends on it',
      undoLocked: 'Undo locked', notChecked: 'Dependencies not yet reliably checked.', affected: 'Affected: {list}',
      archiveSummary: 'Baseline of {date} · {changes}', archiveNote: 'Made permanent · can no longer be undone one by one',
      lastChange: 'Last change',
      undoConfirm: 'Undo this change?',
      baselineConfirm: 'Set the current state as the new baseline? The changes so far become permanent and are archived. After that, only new changes can be undone one by one.',
      resetConfirm: 'Discard all changes since the last baseline and restore that baseline?',
      requestFailed: 'Request failed', sendingRequest: 'Sending request…', inputKept: '{message} – your input has been kept.',
      statusUnreachable: 'Job status unreachable. Checking the connection again…',
      phase_queued: 'Queued…', phase_preparing: 'Preparing a working copy…', phase_checking: 'Checking the request…',
      phase_editing: 'Making the change…', phase_reviewing: 'Reviewing the files…', phase_dependencies: 'Checking dependencies…',
      phase_publishing: 'Applying the change…', phase_rollback: 'Undoing the change…', phase_reset: 'Restoring the baseline…',
      phase_baseline: 'Setting the current state as the baseline…', phase_fork: 'Creating the variant…', phase_delete: 'Deleting the variant…',
      phase_rename: 'Saving the name…', phase_promote: 'Merging the changes…', phase_discussing: 'Answering the question…',
      laneCancelling: 'Cancelling…', running: 'Running…', processing: 'Processing…',
      cancelled: 'Cancelled', blocked: 'Blocked: {reason}', failedReason: 'Failed: {reason}', unknownError: 'Unknown error',
      forkDone: '✓ Variant “{name}” created. Switching to it…',
      deletedHere: '✓ Variant deleted. Going back to the public variant…', deletedStatus: '✓ Variant deleted.', deletedToast: 'Variant deleted',
      nameSavedStatus: '✓ Name saved.', nameSavedToast: 'Name saved',
      merged: '✓ Merged {changes} into “{target}”.',
      changeApplied: '✓ Change applied!', followUpPending: 'Follow-up question – please answer below.',
      doneNoChange: '✓ Done – no change needed.',
      undone: '✓ Undone. The prompt is back in the text field.', baselineSet: '✓ New baseline set. History archived.',
      baselineRestored: '✓ Baseline restored!', notApplied: 'Not applied',
      cancelRequested: 'Cancel requested – waiting for confirmation…',
      sessionExpired: 'Session expired – please log in again.',
      connectionLost: 'Connection lost – the job may still be running. Checking the status again…',
      requestingCancel: 'Requesting cancellation…', cancelNotConfirmed: 'Cancellation not confirmed: {message}',
      sendAnswers: 'Send answers', sendAnswersContinue: 'Send answers and continue', sendAnswersApply: 'Send answers and apply',
      chooseMany: 'Choose one or more', ownAnswer: 'Or type your own answer…', typeAnswer: 'Type your answer…',
      ownAnswerAria: 'Your own answer: {question}',
      resultDone: 'Change applied', resultAsk: 'Follow-up questions before the change', resultNone: 'Nothing changed',
      hideResult: 'Hide result', filesChanged: '{files} changed',
      followUpChanged: 'Follow-up to the last change (“{prompt}”).', myAnswers: 'My answers to your follow-up questions:'
    },
    de: {
      themeLight: 'Helles Design', themeDark: 'Dunkles Design',
      justNow: 'gerade eben', minAgo: 'vor {n} min', hoursAgo: 'vor {n} Std.', yesterday: 'gestern', daysAgo: 'vor {n} Tagen',
      quote: '„{text}“',
      changeCount_one: '1 Änderung', changeCount_other: '{n} Änderungen', theChanges: 'Änderungen',
      fileCount_one: '1 Datei', fileCount_other: '{n} Dateien',
      launcherOpen: 'Bearbeiten und Diskutieren öffnen', launcherIdle: 'Bearbeiten und Diskutieren – klicken zum Öffnen, ziehen zum Verschieben',
      panelLabel: 'Bearbeiten und Diskutieren', showVariants: 'Varianten anzeigen',
      setupTitle: 'Einrichtung (für Administratoren)', setup: 'Einrichtung',
      dockSwap: 'Auf die andere Seite', dock: 'Am Rand andocken', undock: 'Ablösen (frei verschiebbar)', resize: 'Breite ändern',
      minimize: 'Minimieren',
      tabChange: 'Bearbeiten', tabDiscuss: 'Diskutieren', tabHistory: 'Verlauf', tabVariants: 'Varianten',
      answering: 'Antwort kommt …', working: 'Arbeitet …', newAnswer: 'Neue Antwort', questionForYou: 'Rückfrage', failed: 'Nicht geklappt',
      speak: 'Sprechen', stopRecording: 'Aufnahme stoppen', clearText: 'Text leeren', recording: 'Aufnahme läuft…',
      micUnavailable: 'Mikrofon nicht verfügbar, bitte tippen', micError: 'Mikrofon-Fehler: {error}',
      changeLabel: 'Was soll sich ändern?', changeAria: 'Änderung beschreiben',
      changePlaceholder: 'Zum Beispiel: Mach den Hintergrund dunkelblau und die Überschriften etwas größer',
      changeReview: 'Text prüfen und mit „Änderung starten“ losschicken', applyChange: 'Änderung starten',
      dropFiles: 'Dateien anhängen: hierher ziehen oder klicken', dropNow: 'Dateien hier ablegen',
      dropHint: 'Bis zu {count} Dateien, je {size} MB', removeFile: '{name} entfernen',
      fileWaiting: 'wartet…', uploadFailed: 'Hochladen fehlgeschlagen',
      fileTypeNotAllowed: '„{name}“: Dieser Dateityp ist hier nicht erlaubt.', fileTooLarge: '„{name}“ ist größer als {size} MB.',
      fileEmpty: '„{name}“ ist leer.', filesTooMany: 'Höchstens {count} Dateien pro Anfrage.',
      uploadsRunning: 'Dateien werden noch hochgeladen. Bitte kurz warten.',
      uploadsFailed: 'Entferne zuerst die Dateien, die nicht hochgeladen werden konnten.',
      attachedFiles: 'Dateien: {files}',
      scopeHelp: 'Wo landet die Änderung?',
      scopePublic: 'Das ist die öffentliche Variante. Besucher sehen Änderungen sofort, nachdem sie übernommen wurden.',
      scopeVariant: 'Die Änderung landet nur in der Variante „{name}“. Die öffentliche Variante bleibt unverändert, bis du sie übernimmst.',
      stepCheck: 'Prüfen', stepEdit: 'Ändern', stepReview: 'Prüfen', stepApply: 'Übernehmen',
      cancel: 'Abbrechen',
      workingAs: 'Du arbeitest als', changeName: 'Namen ändern', addName: 'Name eintragen',
      namePlaceholder: 'Dein Name, z. B. Maria', nameAria: 'Dein Name',
      discussLabel: 'Fragen und Ideen besprechen', discussHelp: 'Wie funktioniert Diskutieren?',
      discussHint: 'Hier kannst du Fragen stellen und Ideen besprechen, ohne dass etwas geändert wird. „Leeren“ löscht das Gespräch; die KI beginnt danach ohne Vorwissen.',
      clear: 'Leeren', clearTitle: 'Gespräch leeren und neu beginnen',
      askAria: 'Frage stellen', askPlaceholder: 'Frage stellen … (Enter sendet)',
      askReview: 'Text prüfen und mit „Fragen“ abschicken', ask: 'Fragen',
      noConversation: 'Noch kein Gespräch. Frag zum Beispiel:',
      example1: 'Was kann ich hier alles ändern?', example2: 'Was wurde zuletzt geändert?', example3: 'Wie könnte die Seite moderner wirken?',
      suggestedChange: 'Vorschlag für eine Änderung', useInEdit: 'In „Bearbeiten“ übernehmen',
      chatCancelling: 'Wird abgebrochen …', lookingAtApp: 'Schaut sich die App an …', sendingQuestion: 'Frage wird gesendet …',
      chatQueued: 'In Warteschlange …', writingAnswer: 'Schaut sich die App an und formuliert eine Antwort …',
      jobRunning: 'Es läuft bereits ein Auftrag in dieser Variante. Bitte abwarten.',
      questionKept: '{message} – deine Frage bleibt im Textfeld.',
      newAnswerToast: 'Neue Antwort im Bereich „Diskutieren“',
      clearConfirm: 'Gespräch leeren? Der bisherige Verlauf wird gelöscht und die KI beginnt ohne Vorwissen.',
      chatCleared: 'Gespräch geleert',
      variantsHint: 'Jede Variante ist eine eigene Kopie der App. Du kannst gefahrlos ausprobieren und später übernehmen, was gefällt.',
      forkName: 'Name der neuen Variante', create: 'Anlegen', newVariant: 'Neue Variante',
      forkHint: 'Kopie von „{name}“. Alle Änderungen bis jetzt kommen mit.',
      noVariants: 'Noch keine Varianten', badgePublic: 'öffentlich', badgeHere: 'du bist hier',
      laneNoOwn: 'noch keine eigene Änderung', laneOriginal: 'Ausgangsstand', laneLater: 'wird beim ersten Auftrag angelegt',
      fromParent: 'aus „{name}“', open: 'Öffnen', duplicate: 'Duplizieren', duplicateTitle: 'Kopie dieser Variante anlegen',
      mergeInto: 'In „{target}“ übernehmen', nothingToMerge: 'Nichts Neues zum Übernehmen', rename: 'Umbenennen', delete: 'Löschen',
      promoteConfirm: 'Alle Änderungen aus „{from}“ in „{target}“ übernehmen? Dort erscheinen sie als einzelne, rücknehmbare Änderungen.',
      renamePrompt: 'Neuer Name für diese Variante:',
      deleteConfirm: 'Variante „{name}“ endgültig löschen? Alle Änderungen darin gehen verloren.',
      setBaseline: 'Als Basis festlegen', setBaselineTitle: 'Als neue Basis festlegen', setBaselineAria: 'Als neue Basis festlegen',
      historyHint: 'Jede Änderung ist ein Schritt. Die neueste kannst du jederzeit zurücknehmen, ältere nur, wenn nichts darauf aufbaut.',
      historyHelp: 'Wie funktioniert der Verlauf?', discardAll: 'Alles seit der Basis verwerfen',
      historyCount: '{changes} seit der Basis',
      noChangesSinceBase: 'Keine Änderungen seit der letzten Basis', noChanges: 'Noch keine Änderungen',
      latest: 'neueste', undo: 'Rückgängig',
      undoLatestTitle: 'Neueste Änderung – jederzeit rückgängig machbar', undoCheckedTitle: 'Unabhängigkeit geprüft',
      undoLocked: 'Rücknahme gesperrt', notChecked: 'Abhängigkeiten noch nicht sicher geprüft.', affected: 'Betroffen: {list}',
      archiveSummary: 'Basis vom {date} · {changes}', archiveNote: 'Fest übernommen · nicht mehr einzeln rücknehmbar',
      lastChange: 'Zuletzt geändert',
      undoConfirm: 'Diese Änderung rückgängig machen?',
      baselineConfirm: 'Aktuellen Stand als neue Basis festlegen? Die bisherigen Änderungen werden fest übernommen und archiviert. Einzelne Rücknahmen gelten danach nur für neue Änderungen.',
      resetConfirm: 'Alle Änderungen seit der letzten Basis verwerfen und diesen Basisstand wiederherstellen?',
      requestFailed: 'Anfrage fehlgeschlagen', sendingRequest: 'Auftrag wird gesendet…', inputKept: '{message} – Eingabe bleibt erhalten.',
      statusUnreachable: 'Auftragsstatus nicht erreichbar. Verbindung wird erneut geprüft…',
      phase_queued: 'In Warteschlange…', phase_preparing: 'Arbeitskopie wird vorbereitet…', phase_checking: 'Anweisung wird geprüft…',
      phase_editing: 'Änderung wird erstellt…', phase_reviewing: 'Dateien werden geprüft…', phase_dependencies: 'Abhängigkeiten werden geprüft…',
      phase_publishing: 'Änderung wird übernommen…', phase_rollback: 'Änderung wird zurückgenommen…', phase_reset: 'Basis wird wiederhergestellt…',
      phase_baseline: 'Aktueller Stand wird als Basis übernommen…', phase_fork: 'Variante wird angelegt…', phase_delete: 'Variante wird entfernt…',
      phase_rename: 'Name wird gespeichert…', phase_promote: 'Änderungen werden übernommen…', phase_discussing: 'Frage wird beantwortet…',
      laneCancelling: 'wird abgebrochen…', running: 'läuft…', processing: 'Wird verarbeitet…',
      cancelled: 'Abgebrochen', blocked: 'Blockiert: {reason}', failedReason: 'Fehlgeschlagen: {reason}', unknownError: 'Unbekannter Fehler',
      forkDone: '✓ Variante „{name}“ angelegt. Wechsle dorthin…',
      deletedHere: '✓ Variante entfernt. Zurück zur öffentlichen Variante…', deletedStatus: '✓ Variante entfernt.', deletedToast: 'Variante entfernt',
      nameSavedStatus: '✓ Name gespeichert.', nameSavedToast: 'Name gespeichert',
      merged: '✓ {changes} in „{target}“ übernommen.',
      changeApplied: '✓ Änderung angewendet!', followUpPending: 'Rückfrage – bitte unten antworten.',
      doneNoChange: '✓ Auftrag abgeschlossen – keine Änderung erforderlich.',
      undone: '✓ Rückgängig gemacht. Prompt steht wieder im Textfeld.', baselineSet: '✓ Neue Basis festgelegt. Verlauf archiviert.',
      baselineRestored: '✓ Basis wiederhergestellt!', notApplied: 'Nicht übernommen',
      cancelRequested: 'Abbruch angefordert – Bestätigung wird abgewartet…',
      sessionExpired: 'Sitzung abgelaufen – bitte erneut anmelden.',
      connectionLost: 'Verbindung unterbrochen – der Auftrag kann weiterlaufen. Status wird erneut geprüft…',
      requestingCancel: 'Abbruch wird angefordert…', cancelNotConfirmed: 'Abbruch nicht bestätigt: {message}',
      sendAnswers: 'Antworten senden', sendAnswersContinue: 'Antworten senden und weiter ändern', sendAnswersApply: 'Antworten senden und ändern',
      chooseMany: 'Mehrere möglich', ownAnswer: 'Oder eigene Antwort …', typeAnswer: 'Antwort eingeben …',
      ownAnswerAria: 'Eigene Antwort: {question}',
      resultDone: 'Änderung übernommen', resultAsk: 'Rückfrage vor der Änderung', resultNone: 'Nichts geändert',
      hideResult: 'Ergebnis ausblenden', filesChanged: '{files} geändert',
      followUpChanged: 'Anschluss an die letzte Änderung („{prompt}“).', myAnswers: 'Meine Antworten auf deine Rückfragen:'
    }
  };

  // Text in the interface language (English if a text is missing); placeholders are filled in one pass,
  // so user text inside a value is never read as a placeholder.
  function t(id, vars) {
    const table = I18N[lang] || I18N.en;
    const text = typeof table[id] === 'string' ? table[id] : typeof I18N.en[id] === 'string' ? I18N.en[id] : id;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, function (all, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : all;
    });
  }
  // Counted text: id_one for exactly one, id_other otherwise; {n} is the count.
  function tn(id, n, vars) {
    return t(id + (n === 1 ? '_one' : '_other'), Object.assign({ n: n }, vars));
  }
  function quoted(text) { return t('quote', { text: text }); }
  // Only languages with a table count; anything else (or nothing) means English.
  function pickLanguage(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(I18N, value) ? value : 'en';
  }

  /* ── Storage helpers ─────────────────────────────────── */

  function stored(name, value) {
    try {
      if (arguments.length === 1) return localStorage.getItem(storagePrefix + name);
      if (value === null) localStorage.removeItem(storagePrefix + name);
      else localStorage.setItem(storagePrefix + name, value);
    } catch (err) { /* Storage may be disabled; server-side recovery still works. */ }
    return null;
  }

  // Engine-wide values (not tied to a variant): display name, one-shot flags, theme, position, docking.
  function engineStored(name, value) {
    const key = 'sayandshape:' + SAYANDSHAPE_BASE + ':' + name;
    try {
      if (arguments.length === 1) return localStorage.getItem(key);
      if (value) localStorage.setItem(key, value); else localStorage.removeItem(key);
    } catch (err) { /* ignore */ }
    return null;
  }

  // One shared login, several people: the display name lives in the browser and travels with every request.
  function authorName(value) {
    if (arguments.length === 0) return engineStored('author') || '';
    engineStored('author', value);
    return value || '';
  }

  // One-shot flags: reopen the panel after a reload or a jump to another variant, and which view to show.
  function onceFlag(name, value) {
    return arguments.length === 1 ? engineStored(name) : engineStored(name, value);
  }

  // Light/dark panel theme: the viewer's choice is remembered per engine, otherwise the OS setting decides.
  function loadTheme() {
    const saved = engineStored('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (err) { return 'light'; }
  }
  function applyTheme(theme, save) {
    ui.root.setAttribute('data-theme', theme);
    if (ui.zone) ui.zone.setAttribute('data-theme', theme);
    ui.theme = theme;
    if (ui.themeButton) {
      const label = t(theme === 'dark' ? 'themeLight' : 'themeDark');
      ui.themeButton.title = label;
      ui.themeButton.setAttribute('aria-label', label);
      setIcon(ui.themeButton, theme === 'dark' ? 'sun' : 'moon');
    }
    if (save) engineStored('theme', theme);
  }

  // Position of the helper (and of the floating panel): bottom right until someone drags it elsewhere.
  function loadLayout() {
    try {
      const saved = JSON.parse(engineStored('place') || 'null');
      if (saved && isFinite(saved.right) && isFinite(saved.bottom)) anchor = { right: Number(saved.right), bottom: Number(saved.bottom) };
    } catch (err) { /* ignore */ }
    const mode = engineStored('dock');
    if (mode === 'right' || mode === 'left') dock = mode;
    const width = Number(engineStored('dockwidth'));
    if (isFinite(width) && width >= DOCK_MIN && width <= DOCK_MAX) dockWidth = width;
  }
  function saveAnchor() { engineStored('place', JSON.stringify(anchor)); }

  /* ── DOM helpers ─────────────────────────────────────── */

  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)  e.className   = cls;
    if (text) e.textContent = text;
    return e;
  }
  function empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  const STROKE = ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  const ICONS = {
    helper: '<svg width="26" height="26" viewBox="0 0 24 24"' + STROKE + '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/><path d="M5 16.5l.6 1.4 1.4.6-1.4.6L5 20.5l-.6-1.4L3 18.5l1.4-.6z"/></svg>',
    grip: '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>',
    minus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    gear: '<svg width="15" height="15" viewBox="0 0 24 24"' + STROKE + '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    mic: '<svg width="15" height="15" viewBox="0 0 24 24"' + STROKE + '<path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v4"/></svg>',
    stop: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    undo: '<svg width="13" height="13" viewBox="0 0 24 24"' + STROKE + '<path d="M3 10h10a5 5 0 0 1 0 10H9"/><path d="M7 6l-4 4 4 4"/></svg>',
    lock: '<svg width="13" height="13" viewBox="0 0 24 24"' + STROKE + '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l4 4L19 6"/></svg>',
    sun: '<svg width="15" height="15" viewBox="0 0 24 24"' + STROKE + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    moon: '<svg width="15" height="15" viewBox="0 0 24 24"' + STROKE + '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    x: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    help: '<svg width="15" height="15" viewBox="0 0 24 24"' + STROKE + '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
    pin: '<svg width="13" height="13" viewBox="0 0 24 24"' + STROKE + '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3H7l3-3z"/></svg>',
    dock: '<svg width="16" height="16" viewBox="0 0 24 24"' + STROKE + '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/></svg>',
    undock: '<svg width="16" height="16" viewBox="0 0 24 24"' + STROKE + '<rect x="3" y="4" width="18" height="16" rx="2.5"/><rect x="11" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none"/></svg>',
    swap: '<svg width="16" height="16" viewBox="0 0 24 24"' + STROKE + '<path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/></svg>',
    send: '<svg width="15" height="15" viewBox="0 0 24 24"' + STROKE + '<path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    trash: '<svg width="13" height="13" viewBox="0 0 24 24"' + STROKE + '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    question: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.9"/><circle cx="12" cy="18" r=".7" fill="currentColor"/></svg>',
    spark: '<svg width="13" height="13" viewBox="0 0 24 24"' + STROKE + '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>',
    upload: '<svg width="18" height="18" viewBox="0 0 24 24"' + STROKE + '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>',
    clip: '<svg width="13" height="13" viewBox="0 0 24 24"' + STROKE + '<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>'
  };
  function iconSpan(name, cls) {
    const span = mk('span', 'rs-icon' + (cls ? ' ' + cls : ''));
    span.innerHTML = ICONS[name] || '';
    return span;
  }
  function setIcon(button, name) {
    empty(button);
    button.appendChild(iconSpan(name));
  }
  function iconButton(name, label, cls) {
    const button = mk('button', 'rs-iconbtn' + (cls ? ' ' + cls : ''));
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.appendChild(iconSpan(name));
    return button;
  }
  // A "?" button that shows/hides an explanatory hint (and shows it as tooltip on hover).
  function helpToggle(hint, label) {
    hint.hidden = true;
    const help = iconButton('help', label, 'rs-help');
    help.setAttribute('aria-controls', hint.id);
    help.setAttribute('aria-expanded', 'false');
    if (hint.textContent) help.title = hint.textContent;
    help.addEventListener('click', function () {
      hint.hidden = !hint.hidden;
      help.setAttribute('aria-expanded', hint.hidden ? 'false' : 'true');
    });
    return help;
  }
  function textButton(text, cls, icon) {
    const button = mk('button', 'rs-btn' + (cls ? ' ' + cls : ''));
    button.type = 'button';
    if (icon) button.appendChild(iconSpan(icon));
    button.appendChild(mk('span', '', text));
    return button;
  }

  // Agent text → DOM without innerHTML: paragraphs (blank line), "- " lists, **bold** and `code`.
  function inlineText(parent, text) {
    String(text).split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).forEach(function (part) {
      if (!part) return;
      if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') parent.appendChild(mk('strong', '', part.slice(2, -2)));
      else if (part.length > 2 && part[0] === '`' && part[part.length - 1] === '`') parent.appendChild(mk('code', '', part.slice(1, -1)));
      else parent.appendChild(mk('span', '', part));
    });
  }
  function richText(text, cls) {
    const box = mk('div', 'rs-rich' + (cls ? ' ' + cls : ''));
    String(text || '').split(/\n{2,}/).forEach(function (blockText) {
      const lines = blockText.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
      if (!lines.length) return;
      let list = null, para = null;
      lines.forEach(function (line) {
        const item = /^[-•*]\s+(.*)$/.exec(line);
        if (item) {
          if (!list) { list = mk('ul'); box.appendChild(list); para = null; }
          const li = mk('li');
          inlineText(li, item[1]);
          list.appendChild(li);
        } else {
          if (!para) { para = mk('p'); box.appendChild(para); list = null; }
          else para.appendChild(mk('br'));
          inlineText(para, line);
        }
      });
    });
    return box;
  }
  function pointList(points) {
    const list = mk('ul', 'rs-points');
    (points || []).forEach(function (point) {
      const li = mk('li');
      inlineText(li, point);
      list.appendChild(li);
    });
    return list;
  }

  function nameOf(slug) {
    const found = workspaces.find(function (ws) { return ws.slug === slug; });
    return found && found.name ? found.name : slug;
  }

  function ago(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(diff)) return '';
    if (diff < 90) return t('justNow');
    if (diff < 3600) return t('minAgo', { n: Math.round(diff / 60) });
    if (diff < 86400) return t('hoursAgo', { n: Math.round(diff / 3600) });
    if (diff < 172800) return t('yesterday');
    if (diff < 14 * 86400) return t('daysAgo', { n: Math.round(diff / 86400) });
    return fmtDate(iso);
  }

  // Dates in German for a German interface, otherwise in the viewer's browser locale.
  function fmtDate(s) {
    const d = new Date(s);
    const locale = lang === 'de' ? 'de-DE' : undefined;
    return d.toLocaleDateString(locale) + ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  /* ── Build ───────────────────────────────────────────── */

  function init() {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = SAYANDSHAPE_BASE + '/widget/sayandshape-widget.css';
    // Sizes are only final once the stylesheet is in: place the panel and the chat position again.
    link.addEventListener('load', function () { applyLayout(); scrollChat(); });
    document.head.appendChild(link);
    loadLayout();

    const root = mk('div');
    root.id = 'sayandshape-root';
    root.setAttribute('lang', lang);
    if (ACCENT) root.style.setProperty && root.style.setProperty('--rs-accent', ACCENT);
    ui.root = root;

    // Helper button: the only thing visible until someone opens the panel. Round, draggable, bottom right.
    const launcher = mk('button', 'rs-launcher');
    launcher.id = 'sayandshape-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', t('launcherOpen'));
    const label = mk('span', 'rs-launcher-label');
    const labelTitle = mk('span', 'rs-launcher-title', t('tabChange'));
    const launcherText = mk('span', 'rs-launcher-text', WORKSPACE);
    label.append(labelTitle, launcherText);
    const orb = mk('span', 'rs-orb rs-orb-idle');
    orb.id = 'sayandshape-launcher-dot';
    orb.append(iconSpan('helper'), mk('span', 'rs-orb-badge'));
    launcher.append(label, orb);
    ui.launcherText = launcherText; ui.launcherTitle = labelTitle;
    // The helper reopens where the user left off (Edit or Discuss); news in the chat win.
    launcher.addEventListener('click', function () {
      if (launcher.sayandshapeDragged) { launcher.sayandshapeDragged = false; return; }
      const remembered = stored('tab');
      setTab(attention === 'discuss' || remembered === 'discuss' ? 'discuss' : 'change');
      open();
    });
    ui.launcher = launcher; ui.launcherDot = orb;

    const panel = mk('div', 'rs-panel');
    panel.id = 'sayandshape-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('panelLabel'));
    panel.addEventListener('keydown', function (e) { if (e && e.key === 'Escape') close(); });
    ui.panel = panel;

    // Header doubles as drag handle: drag to move, drag to the window edge to dock.
    const head = mk('div', 'rs-head');
    head.id = 'sayandshape-head';
    const chip = mk('button', 'rs-chip');
    chip.id = 'sayandshape-ws-chip';
    chip.type = 'button';
    chip.title = t('showVariants');
    chip.textContent = WORKSPACE;
    chip.addEventListener('click', function () { setTab('variants'); });
    const setup = mk('a', 'rs-iconbtn');
    setup.id = 'sayandshape-setup-link';
    setup.href = SAYANDSHAPE_BASE + '/setup/';
    setup.title = t('setupTitle');
    setup.setAttribute('aria-label', t('setup'));
    setup.appendChild(iconSpan('gear'));
    setup.hidden = true;   // Hidden for now; the setup page stays reachable at /sayandshape/setup/.
    const swap = iconButton('swap', t('dockSwap'));
    swap.id = 'sayandshape-dock-swap';
    swap.hidden = true;
    swap.addEventListener('click', function () { setDock(dock === 'left' ? 'right' : 'left'); });
    const dockButton = iconButton('dock', t('dock'));
    dockButton.id = 'sayandshape-dock-toggle';
    dockButton.addEventListener('click', function () { setDock(dock === 'float' ? 'right' : 'float'); });
    const themeButton = iconButton('moon', t('themeDark'));
    themeButton.id = 'sayandshape-theme-toggle';
    themeButton.addEventListener('click', function () { applyTheme(ui.theme === 'dark' ? 'light' : 'dark', true); });
    ui.themeButton = themeButton; ui.dockButton = dockButton; ui.swapButton = swap;
    const minimize = iconButton('minus', t('minimize'));
    minimize.id = 'sayandshape-minimize';
    minimize.addEventListener('click', close);
    head.append(iconSpan('grip', 'rs-grip'), chip, mk('span', 'rs-spacer'), swap, dockButton, themeButton, setup, minimize);
    ui.chip = chip; ui.head = head;

    const tabs = mk('div', 'rs-tabs');
    tabs.setAttribute('role', 'tablist');
    ui.tabs = {};
    [['change', t('tabChange')], ['discuss', t('tabDiscuss')], ['history', t('tabHistory')], ['variants', t('tabVariants')]].forEach(function (pair) {
      const tab = mk('button', 'rs-tab', pair[1]);
      tab.id = 'sayandshape-tab-' + pair[0];
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', function () { setTab(pair[0]); });
      tabs.appendChild(tab);
      ui.tabs[pair[0]] = tab;
    });
    // "History" appears once the variant has changes (or archived ones); see renderHistory().
    ui.tabs.history.hidden = true;

    const body = mk('div', 'rs-body');
    body.id = 'sayandshape-body';
    ui.body = body;
    ui.views = { change: buildChangeView(), discuss: buildDiscussView(), variants: buildVariantsView(), history: buildHistoryView() };
    body.append(ui.views.change, ui.views.discuss, ui.views.variants, ui.views.history);

    const toast = mk('div', 'rs-toast');
    toast.id = 'sayandshape-toast';
    toast.hidden = true;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    ui.toast = toast;

    // Inner edge of a docked panel: drag to change its width.
    const resize = mk('div', 'rs-resize');
    resize.id = 'sayandshape-resize';
    resize.title = t('resize');
    ui.resize = resize;

    // Preview of the docking area while the panel is dragged towards a window edge.
    const zone = mk('div', 'rs-dockzone');
    zone.id = 'sayandshape-dockzone';
    zone.hidden = true;
    ui.zone = zone;

    applyTheme(loadTheme(), false);
    panel.append(head, tabs, body, toast, resize);
    root.append(launcher, panel);
    document.body.append(root, zone);

    makeDraggable(launcher, false);
    makeDraggable(head, true);
    makeResizable(resize);
    if (typeof window.addEventListener === 'function') window.addEventListener('resize', applyLayout);
    // The panel grows after opening (history, variants, job cards, tab switches); keep it inside the viewport.
    if (typeof window.ResizeObserver === 'function') {
      const observer = new window.ResizeObserver(function () { applyLayout(); });
      observer.observe(panel);
      observer.observe(launcher);
    }
    applyLayout();

    ui.changeBox.setDraft(stored('draft') || '');
    restoreAttachments(storedAttachments());
    loadUploadLimits();
    ui.chatBox.setDraft(stored('chatdraft') || '');
    const once = onceFlag('tab');
    if (once) onceFlag('tab', null);
    setTab(once || stored('tab') || 'change');
    updateAuthorChip();
    updateControls();
    loadHistory();
    loadWorkspaces();
    loadChat();
    restoreResult();
    resumeJob();
    if (onceFlag('reopen')) { onceFlag('reopen', null); open(); }
  }

  // A text field with speech input and a clear button inside: mic bottom right, a faint × top right.
  function buildComposer(options) {
    const box = { key: options.key };
    const input = document.createElement('textarea');
    input.id = options.id + '-input';
    input.rows = options.rows;
    input.placeholder = options.placeholder;
    input.setAttribute('aria-label', options.label);
    input.addEventListener('input', function () { stored(box.key, input.value); updateClear(box); });
    input.addEventListener('keydown', function (e) {
      if (!e || e.key !== 'Enter' || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || (options.enterSends && !e.shiftKey)) { e.preventDefault(); options.send(); }
    });
    const wrap = mk('div', 'rs-input-wrap');
    const mic = iconButton('mic', t('speak'), 'rs-input-mic');
    mic.id = options.micId;
    mic.addEventListener('click', function () { toggleMic(box); });
    const clear = iconButton('x', t('clearText'), 'rs-input-clear');
    clear.id = options.clearId;
    clear.hidden = true;
    clear.addEventListener('click', function () { box.setDraft(''); input.focus(); });
    wrap.append(input, mic, clear);
    const micLabel = mk('div', 'rs-mic-label');
    micLabel.id = options.micLabelId;
    box.input = input; box.mic = mic; box.clear = clear; box.wrap = wrap; box.micLabel = micLabel;
    box.reviewHint = options.reviewHint;
    box.setDraft = function (text) {
      input.value = text || '';
      stored(box.key, input.value);
      updateClear(box);
    };
    return box;
  }

  function buildChangeView() {
    const view = mk('section', 'rs-view');
    view.id = 'sayandshape-view-change';
    const label = mk('label', 'rs-label', t('changeLabel'));
    label.htmlFor = 'sayandshape-text-input';
    const box = buildComposer({
      id: 'sayandshape-text', key: 'draft', rows: 4, label: t('changeAria'), send: sendText,
      placeholder: t('changePlaceholder'),
      micId: 'sayandshape-mic-btn', clearId: 'sayandshape-clear-btn', micLabelId: 'sayandshape-mic-label',
      reviewHint: t('changeReview')
    });
    ui.changeBox = box; ui.input = box.input;

    // Files for the request: a drop area that also opens the file dialog, and the list of what was added.
    // Hidden until upload.php has said what the project accepts.
    const files = mk('div', 'rs-files');
    files.id = 'sayandshape-files';
    files.hidden = true;
    const drop = mk('button', 'rs-drop');
    drop.id = 'sayandshape-drop';
    drop.type = 'button';
    const dropText = mk('span', 'rs-drop-text');
    const dropLabel = mk('span', '', t('dropFiles'));
    const dropHint = mk('span', 'rs-drop-hint');
    dropText.append(dropLabel, dropHint);
    drop.append(iconSpan('upload'), dropText);
    const picker = document.createElement('input');
    picker.id = 'sayandshape-file-input';
    picker.type = 'file';
    picker.multiple = true;
    picker.hidden = true;
    picker.tabIndex = -1;
    drop.addEventListener('click', function () { picker.click(); });
    picker.addEventListener('change', function () { addFiles(picker.files); picker.value = ''; });
    const fileList = mk('ul', 'rs-file-list');
    fileList.id = 'sayandshape-file-list';
    fileList.hidden = true;
    const fileNote = mk('div', 'rs-file-note');
    fileNote.id = 'sayandshape-file-note';
    fileNote.setAttribute('role', 'status');
    files.append(drop, picker, fileList, fileNote);
    ui.files = files; ui.drop = drop; ui.dropLabel = dropLabel; ui.dropHint = dropHint; ui.picker = picker;
    ui.fileList = fileList; ui.fileNote = fileNote;
    // Dropping works anywhere in this view, also onto the text field.
    let dragDepth = 0;
    const dragsFiles = function (e) {
      const types = e && e.dataTransfer && e.dataTransfer.types;
      return !!types && !ui.files.hidden && Array.prototype.indexOf.call(types, 'Files') >= 0;
    };
    const dropActive = function (on) {
      drop.className = 'rs-drop' + (on ? ' rs-drop-active' : '');
      dropLabel.textContent = t(on ? 'dropNow' : 'dropFiles');
    };
    view.addEventListener('dragenter', function (e) { if (dragsFiles(e)) { e.preventDefault(); dragDepth++; dropActive(true); } });
    view.addEventListener('dragover', function (e) { if (dragsFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    view.addEventListener('dragleave', function () { if (dragDepth && --dragDepth === 0) dropActive(false); });
    view.addEventListener('drop', function (e) {
      if (!dragsFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      dropActive(false);
      addFiles(e.dataTransfer.files);
    });

    const row = mk('div', 'rs-row');
    const send = textButton(t('applyChange'), 'rs-btn-primary rs-grow');
    send.id = 'sayandshape-send-btn';
    send.addEventListener('click', sendText);
    row.append(send);
    ui.send = send;

    // Where the change lands: tucked behind a "?" next to the label.
    const scope = mk('p', 'rs-hint');
    scope.id = 'sayandshape-scope';
    ui.scope = scope;
    const help = helpToggle(scope, t('scopeHelp'));
    help.id = 'sayandshape-scope-help';
    ui.scopeHelp = help;
    const labelRow = mk('div', 'rs-label-row');
    labelRow.append(label, help);

    // Running job: status line, stepper, cancel.
    const statusWrap = mk('div', 'rs-job');
    statusWrap.id = 'sayandshape-status-wrap';
    statusWrap.style.display = 'none';
    const statusLine = mk('div', 'rs-job-line');
    const runDot = mk('span', 'rs-dot rs-dot-run');
    const statusEl = mk('div', 'sayandshape-status');
    statusEl.id = 'sayandshape-status';
    statusLine.append(runDot, statusEl);
    const stepper = mk('div', 'rs-steps');
    stepper.id = 'sayandshape-stepper';
    ui.steps = [t('stepCheck'), t('stepEdit'), t('stepReview'), t('stepApply')].map(function (name, index) {
      if (index) stepper.appendChild(mk('span', 'rs-step-line'));
      const step = mk('div', 'rs-step');
      const circle = mk('span', 'rs-step-dot');
      step.append(circle, mk('span', 'rs-step-name', name));
      stepper.appendChild(step);
      return { step: step, circle: circle };
    });
    const cancel = textButton(t('cancel'), 'rs-btn-danger');
    cancel.id = 'sayandshape-cancel-btn';
    cancel.style.display = 'none';
    cancel.addEventListener('click', cancelJob);
    statusWrap.append(statusLine, stepper, cancel);
    ui.statusWrap = statusWrap; ui.status = statusEl; ui.stepper = stepper; ui.cancel = cancel; ui.runDot = runDot;

    // Result of the last request: summary, what changed, and follow-up questions as a form.
    const result = mk('div', 'rs-result');
    result.id = 'sayandshape-result';
    result.hidden = true;
    ui.result = result;

    const last = mk('div', 'rs-last');
    last.id = 'sayandshape-last';
    last.hidden = true;
    ui.last = last;

    const author = mk('div', 'rs-author');
    const authorText = mk('span', 'rs-hint', t('workingAs'));
    const chip = mk('button', 'rs-chip rs-chip-soft');
    chip.id = 'sayandshape-author-chip';
    chip.type = 'button';
    chip.title = t('changeName');
    const authorInput = document.createElement('input');
    authorInput.id = 'sayandshape-author-input';
    authorInput.type = 'text';
    authorInput.maxLength = 60;
    authorInput.placeholder = t('namePlaceholder');
    authorInput.setAttribute('aria-label', t('nameAria'));
    authorInput.hidden = true;
    authorInput.value = authorName();
    authorInput.addEventListener('input', function () { authorName(authorInput.value.trim()); updateAuthorChip(); });
    authorInput.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') { e.preventDefault(); authorInput.hidden = true; } });
    chip.addEventListener('click', function () { authorInput.hidden = !authorInput.hidden; if (!authorInput.hidden) authorInput.focus(); });
    author.append(authorText, chip, authorInput);
    ui.authorChip = chip; ui.authorInput = authorInput;

    view.append(labelRow, scope, box.wrap, box.micLabel, files, row, statusWrap, result, last, author);
    return view;
  }

  // Discuss: a read-only conversation about the app. Nothing is changed here; a suggestion from the
  // answer can be carried over into "Edit" with one click.
  function buildDiscussView() {
    const view = mk('section', 'rs-view rs-view-discuss');
    view.id = 'sayandshape-view-discuss';
    view.hidden = true;

    const head = mk('div', 'rs-history-head');
    const hint = mk('p', 'rs-hint', t('discussHint'));
    hint.id = 'sayandshape-chat-hint';
    const labelRow = mk('div', 'rs-label-row');
    labelRow.append(mk('span', 'rs-label', t('discussLabel')), helpToggle(hint, t('discussHelp')));
    const reset = textButton(t('clear'), '', 'trash');
    reset.id = 'sayandshape-chat-reset';
    reset.title = t('clearTitle');
    reset.hidden = true;
    reset.addEventListener('click', clearChat);
    head.append(labelRow, reset);
    ui.chatReset = reset;

    const thread = mk('div', 'rs-chat');
    thread.id = 'sayandshape-chat';
    thread.setAttribute('aria-live', 'polite');
    ui.chat = thread;

    const box = buildComposer({
      id: 'sayandshape-chat', key: 'chatdraft', rows: 2, label: t('askAria'), send: sendChat, enterSends: true,
      placeholder: t('askPlaceholder'),
      micId: 'sayandshape-chat-mic', clearId: 'sayandshape-chat-clear-btn', micLabelId: 'sayandshape-chat-mic-label',
      reviewHint: t('askReview')
    });
    ui.chatBox = box;
    const send = textButton(t('ask'), 'rs-btn-primary', 'send');
    send.id = 'sayandshape-chat-send';
    send.addEventListener('click', sendChat);
    ui.chatSend = send;
    const compose = mk('div', 'rs-chat-compose');
    const row = mk('div', 'rs-chat-row');
    row.append(box.wrap, send);
    compose.append(box.micLabel, row);

    view.append(head, hint, thread, compose);
    return view;
  }

  function buildVariantsView() {
    const view = mk('section', 'rs-view');
    view.id = 'sayandshape-view-variants';
    view.hidden = true;
    view.appendChild(mk('p', 'rs-hint', t('variantsHint')));
    const tree = mk('div', 'rs-tree');
    tree.id = 'sayandshape-variants-tree';
    ui.tree = tree;

    const form = mk('div', 'rs-fork');
    form.id = 'sayandshape-fork-form';
    form.hidden = true;
    const hint = mk('div', 'rs-hint');
    hint.id = 'sayandshape-fork-hint';
    const nameInput = document.createElement('input');
    nameInput.id = 'sayandshape-fork-name';
    nameInput.type = 'text';
    nameInput.maxLength = 60;
    nameInput.placeholder = t('forkName');
    nameInput.setAttribute('aria-label', t('forkName'));
    nameInput.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') { e.preventDefault(); submitFork(); } });
    const go = textButton(t('create'), 'rs-btn-primary');
    go.id = 'sayandshape-fork-go';
    go.addEventListener('click', submitFork);
    const cancel = textButton(t('cancel'), 'rs-btn-ghost');
    cancel.addEventListener('click', function () { form.hidden = true; });
    const formRow = mk('div', 'rs-row');
    formRow.append(nameInput, go, cancel);
    form.append(hint, formRow);
    ui.forkForm = form; ui.forkName = nameInput; ui.forkGo = go; ui.forkHint = hint;

    const fork = textButton(t('newVariant'), 'rs-btn-dashed', 'plus');
    fork.id = 'sayandshape-fork-btn';
    fork.addEventListener('click', function () { openForkForm(publicSlug); });
    ui.fork = fork;

    view.append(tree, form, fork);
    return view;
  }

  function buildHistoryView() {
    const view = mk('section', 'rs-view');
    view.id = 'sayandshape-view-history';
    view.hidden = true;
    const head = mk('div', 'rs-history-head');
    const count = mk('span', 'rs-label');
    count.id = 'sayandshape-history-count';
    const base = textButton(t('setBaseline'), '', 'pin');
    base.id = 'sayandshape-base-btn';
    base.title = t('setBaselineTitle');
    base.setAttribute('aria-label', t('setBaselineAria'));
    base.hidden = true;
    base.addEventListener('click', doEstablishBase);
    const historyHint = mk('p', 'rs-hint', t('historyHint'));
    historyHint.id = 'sayandshape-history-hint';
    const countRow = mk('div', 'rs-label-row');
    countRow.append(count, helpToggle(historyHint, t('historyHelp')));
    head.append(countRow, base);
    ui.historyCount = count; ui.base = base;
    view.appendChild(head);
    view.appendChild(historyHint);
    const list = mk('div', 'rs-history');
    list.id = 'sayandshape-history-list';
    ui.historyList = list;
    const reset = textButton(t('discardAll'), 'rs-btn-warn');
    reset.id = 'sayandshape-reset-btn';
    reset.style.display = 'none';
    reset.addEventListener('click', doReset);
    ui.reset = reset;
    view.append(list, reset);
    return view;
  }

  /* ── Open, close, tabs ───────────────────────────────── */

  function open() {
    isOpen = true;
    ui.panel.hidden = false;
    ui.launcher.hidden = true;
    attention = false;
    applyLayout();
    loadHistory();
    loadWorkspaces();
    loadChat();
    clearTimeout(wsTimer);
    wsTimer = setTimeout(pollWorkspaces, 6000);
    updateControls();
    focusInput();
  }

  function close() {
    isOpen = false;
    ui.panel.hidden = true;
    ui.launcher.hidden = false;
    clearTimeout(wsTimer);
    applyLayout();
  }

  function focusInput() {
    if (busy) return;
    const box = ui.currentTab === 'discuss' ? ui.chatBox : ui.currentTab === 'change' ? ui.changeBox : null;
    if (box && typeof box.input.focus === 'function') box.input.focus();
  }

  function setTab(name) {
    if (!ui.views[name]) name = 'change';
    ui.currentTab = name;
    Object.keys(ui.views).forEach(function (key) {
      const active = key === name;
      ui.views[key].hidden = !active;
      ui.tabs[key].setAttribute('aria-selected', active ? 'true' : 'false');
    });
    stored('tab', name);
    updateTabs();
    if (name === 'variants') loadWorkspaces();
    if (name === 'history') loadHistory();
    if (name === 'discuss') { loadChat(); scrollChat(); }
  }

  // The tab of the area a job is running in carries a small pulsing dot.
  function updateTabs() {
    Object.keys(ui.tabs).forEach(function (key) {
      const running = currentJobId && ((key === 'discuss') === (currentAction === 'discuss')) && (key === 'discuss' || key === 'change');
      ui.tabs[key].className = 'rs-tab' + (key === ui.currentTab ? ' rs-tab-active' : '') + (running ? ' rs-tab-busy' : '');
    });
  }

  /* ── Position, docking, drag ─────────────────────────── */

  function narrowScreen() {
    try { return !!(window.matchMedia && window.matchMedia('(max-width: 600px)').matches); } catch (err) { return false; }
  }

  // Docking needs room next to the page: below 760px the panel floats (or becomes a bottom sheet).
  function dockNow() {
    if (!isOpen || dock === 'float' || narrowScreen()) return 'float';
    const vw = window.innerWidth || 0;
    return vw && vw < 760 ? 'float' : dock;
  }

  // The saved anchor stays as the user left it; only the shown position is clamped, so a panel that
  // grew and was pushed down returns to the chosen spot once it is small again.
  function applyLayout() {
    const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    const side = dockNow();
    const width = Math.max(DOCK_MIN, Math.min(dockWidth, DOCK_MAX, vw ? vw - 240 : DOCK_MAX));
    ui.root.className = side === 'float' ? '' : 'rs-docked rs-docked-' + side;
    ui.panel.style.width = side === 'float' ? '' : width + 'px';
    ui.resize.hidden = side === 'float';
    ui.swapButton.hidden = side === 'float';
    ui.dockButton.hidden = narrowScreen() || (vw > 0 && vw < 760);
    const docked = dock !== 'float';
    ui.dockButton.title = t(docked ? 'undock' : 'dock');
    ui.dockButton.setAttribute('aria-label', ui.dockButton.title);
    if (ui.dockButton.sayandshapeIcon !== docked) { ui.dockButton.sayandshapeIcon = docked; setIcon(ui.dockButton, docked ? 'undock' : 'dock'); }
    pushPage(side, width);
    let right = anchor.right, bottom = anchor.bottom;
    if (vw && vh) {
      const shown = isOpen ? ui.panel : ui.launcher;
      const w = shown.offsetWidth || (isOpen ? 420 : 56);
      const h = shown.offsetHeight || (isOpen ? 520 : 56);
      right = Math.min(Math.max(8, right), Math.max(8, vw - w - 8));
      bottom = Math.min(Math.max(8, bottom), Math.max(8, vh - h - 8));
    }
    ui.position = { right: right, bottom: bottom };
    ui.root.style.right = right + 'px';
    ui.root.style.bottom = bottom + 'px';
    // The helper's label opens towards the middle of the window.
    ui.launcher.className = 'rs-launcher' + (vw && right > vw / 2 ? ' rs-launcher-flip' : '');
  }

  // A docked panel takes its strip of the window: the page gets a matching margin instead of being covered.
  function pushPage(side, width) {
    const page = document.documentElement;
    if (!page || !page.style) return;
    if (ui.pushed && ui.pushed !== side) { page.style[ui.pushed === 'left' ? 'marginLeft' : 'marginRight'] = ui.pushedBefore || ''; ui.pushed = null; }
    if (side === 'float') return;
    const prop = side === 'left' ? 'marginLeft' : 'marginRight';
    if (!ui.pushed) { ui.pushedBefore = page.style[prop] || ''; ui.pushed = side; }
    page.style[prop] = width + 'px';
  }

  function setDock(mode) {
    dock = mode === 'left' || mode === 'right' ? mode : 'float';
    engineStored('dock', dock === 'float' ? null : dock);
    applyLayout();
  }

  function showZone(side) {
    ui.zoneSide = side || null;
    ui.zone.hidden = !side;
    if (side) {
      ui.zone.className = 'rs-dockzone rs-dockzone-' + side;
      ui.zone.style.width = dockWidth + 'px';
    }
  }

  // Pointer-based dragging of the helper or the panel header; the anchor is the bottom-right corner.
  // The panel header additionally docks: release near the left/right window edge to dock there,
  // pull a docked panel away from its edge to float again.
  function makeDraggable(handle, isPanel) {
    let start = null;
    handle.addEventListener('pointerdown', function (e) {
      if (!e || (e.button !== undefined && e.button !== 0) || narrowScreen()) return;
      const target = e.target;
      if (target && target !== handle && typeof target.closest === 'function' && target.closest('button, a, input, select, textarea')) return;
      const from = ui.position || anchor;
      start = { x: e.clientX, y: e.clientY, right: from.right, bottom: from.bottom, moved: false, id: e.pointerId };
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
    });
    handle.addEventListener('pointermove', function (e) {
      if (!start || !e) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      if (isPanel && dockNow() !== 'float') {
        if (Math.abs(dx) < 28 && Math.abs(dy) < 28) return;
        // Pulled off the edge: float under the pointer and keep dragging from here.
        setDock('float');
        const w = ui.panel.offsetWidth || 420, h = ui.panel.offsetHeight || 520;
        anchor = { right: vw - e.clientX - w / 2, bottom: vh - e.clientY - h + 24 };
        applyLayout();
        start = { x: e.clientX, y: e.clientY, right: ui.position.right, bottom: ui.position.bottom, moved: true, id: e.pointerId };
        return;
      }
      if (!start.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) start.moved = true;
      if (!start.moved) return;
      anchor = { right: start.right - dx, bottom: start.bottom - dy };
      applyLayout();
      if (isPanel && vw >= 760) showZone(e.clientX <= 36 ? 'left' : e.clientX >= vw - 36 ? 'right' : null);
    });
    const finish = function (e) {
      if (!start) return;
      const moved = start.moved;
      start = null;
      try { if (e) handle.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const side = ui.zoneSide;
      showZone(null);
      if (!moved) return;
      if (isPanel && side) { setDock(side); return; }
      anchor = { right: ui.position.right, bottom: ui.position.bottom };
      saveAnchor();
      if (!isPanel) handle.sayandshapeDragged = true;
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function makeResizable(handle) {
    let start = null;
    handle.addEventListener('pointerdown', function (e) {
      if (!e || dockNow() === 'float') return;
      start = { x: e.clientX, width: ui.panel.offsetWidth || dockWidth };
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
      if (e.preventDefault) e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!start || !e) return;
      const delta = dock === 'right' ? start.x - e.clientX : e.clientX - start.x;
      dockWidth = Math.max(DOCK_MIN, Math.min(DOCK_MAX, Math.round(start.width + delta)));
      applyLayout();
    });
    const finish = function (e) {
      if (!start) return;
      start = null;
      try { if (e) handle.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      engineStored('dockwidth', String(dockWidth));
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  /* ── Draft, controls, status ─────────────────────────── */

  function setDraft(text) { ui.changeBox.setDraft(text); }

  function updateClear(box) {
    box.clear.hidden = !box.input.value || isRecording;
  }

  function updateAuthorChip() {
    const name = authorName();
    ui.authorChip.textContent = name || t('addName');
    ui.authorChip.className = 'rs-chip rs-chip-soft' + (name ? '' : ' rs-chip-missing');
  }

  function updateControls() {
    const lock = busy || isRecording;
    ui.send.disabled = lock || uploading;
    ui.chatSend.disabled = lock;
    [ui.changeBox, ui.chatBox].forEach(function (box) {
      box.mic.disabled = busy || (isRecording && rec !== box);
      box.clear.disabled = isRecording;
      box.input.readOnly = isRecording && rec === box;
      updateClear(box);
    });
    historyButtons.forEach(function (button) { button.disabled = lock || button.sayandshapeRollbackAllowed === false; });
    ui.reset.disabled = lock || ui.reset.sayandshapeAllowed === false;
    ui.base.disabled = lock || ui.base.sayandshapeRollbackAllowed === false;
    ui.fork.disabled = lock;
    ui.forkGo.disabled = lock;
    ui.chatReset.disabled = lock;
    variantButtons.forEach(function (button) { button.disabled = lock || button.sayandshapeAllowed === false; });
    answerButtons.forEach(function (button) { button.disabled = lock || button.sayandshapeReady === false; });
    if (ui.lastUndo) ui.lastUndo.disabled = lock || ui.lastUndo.sayandshapeRollbackAllowed === false;
    setLauncherState(currentJobId ? 'running' : ui.launcherError ? 'error' : attention ? 'attention' : 'idle');
    updateTabs();
  }

  // The helper shows at a glance what is going on: working (spinning ring), news (badge), problem (red).
  function setLauncherState(state) {
    ui.launcherDot.className = 'rs-orb rs-orb-' + state;
    ui.launcherTitle.textContent = t(state === 'running' ? (currentAction === 'discuss' ? 'answering' : 'working') :
      state === 'attention' ? (attention === 'discuss' ? 'newAnswer' : 'questionForYou') : state === 'error' ? 'failed' : 'tabChange');
    ui.launcher.title = state === 'idle' ? t('launcherIdle') : ui.launcherTitle.textContent;
  }

  function setStatus(msg, type, showCancel) {
    ui.statusWrap.style.display = 'block';
    ui.statusWrap.className = 'rs-job rs-job-' + type;
    ui.status.textContent = msg;
    ui.status.className = 'sayandshape-status sayandshape-status-' + type;
    ui.cancel.style.display = showCancel ? 'block' : 'none';
    ui.runDot.className = 'rs-dot ' + (type === 'loading' ? 'rs-dot-run' : type === 'success' ? 'rs-dot-idle' : 'rs-dot-error');
    if (type !== 'loading') ui.stepper.hidden = true;
    ui.launcherError = type === 'error';
    if (type === 'error') setLauncherState('error');
  }

  function hideStatus() {
    ui.statusWrap.style.display = 'none';
    ui.launcherError = false;
  }

  function setStepper(phase, action) {
    const index = { queued: 0, preparing: 0, checking: 0, editing: 1, reviewing: 2, dependencies: 2, publishing: 3 }[phase];
    if (action !== 'change' || index === undefined) { ui.stepper.hidden = true; return; }
    ui.stepper.hidden = false;
    ui.steps.forEach(function (entry, i) {
      entry.step.className = 'rs-step' + (i < index ? ' rs-step-done' : i === index ? ' rs-step-active' : '');
      entry.circle.innerHTML = i < index ? ICONS.check : '';
    });
  }

  function toast(text, kind) {
    ui.toast.textContent = text;
    ui.toast.className = 'rs-toast rs-toast-' + (kind || 'info');
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.hidden = true; }, 4000);
  }

  /* ── Microphone ──────────────────────────────────────── */

  function sendText() {
    const v = ui.input.value.trim();
    if (!v || busy || isRecording) return;
    if (attachments.some(function (entry) { return entry.state === 'queued' || entry.state === 'uploading'; })) { toast(t('uploadsRunning'), 'info'); return; }
    if (attachments.some(function (entry) { return entry.state === 'error'; })) { toast(t('uploadsFailed'), 'error'); return; }
    submitChange(v, attachments);
  }

  function toggleMic(box) {
    if (busy || (isRecording && rec !== box)) return;
    isRecording ? stopRecording() : startRecording(box);
  }

  function startRecording(box) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { box.micLabel.textContent = t('micUnavailable'); box.input.focus(); return; }
    rec = box;
    speechPrefix = box.input.value.trim();
    finalTranscript = '';
    interimTranscript = '';
    isRecording = true;
    setMicUI(true);
    updateControls();
    startSession();
  }

  function speechDraft() {
    return [speechPrefix, (finalTranscript + interimTranscript).trim()].filter(Boolean).join(' ');
  }

  function finishRecording() {
    recognition = null;
    if (rec) {
      rec.setDraft(speechDraft());
      rec.micLabel.textContent = rec.reviewHint;
      rec.input.focus();
    }
    updateControls();
  }

  // Speech is recognized in the page's language, falling back to the browser's.
  function speechLang() {
    const page = document.documentElement && document.documentElement.lang;
    return page || (typeof navigator !== 'undefined' && navigator.language) || '';
  }

  function startSession() {
    if (!isRecording) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const session = new SR();
    recognition = session;
    session.lang = speechLang();
    session.continuous = true;
    session.interimResults = true;
    session.onresult = function (e) {
      interimTranscript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' ';
        else interimTranscript += e.results[i][0].transcript;
      }
      rec.micLabel.textContent = (finalTranscript + interimTranscript).trim() || t('recording');
    };
    session.onerror = function (e) {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      isRecording = false;
      setMicUI(false);
      rec.micLabel.textContent = t('micError', { error: e.error });
    };
    session.onend = function () {
      if (isRecording) {
        finalTranscript += interimTranscript;
        interimTranscript = '';
        recognition = null;
        setTimeout(startSession, 150);
      } else finishRecording();
    };
    try { session.start(); }
    catch (err) { isRecording = false; setMicUI(false); finishRecording(); }
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    setMicUI(false);
    // Keep sending disabled until the final recognition event has arrived.
    busy = true;
    updateControls();
    if (recognition) {
      recognition.onend = function () { busy = false; finishRecording(); };
      try { recognition.stop(); }
      catch (err) { busy = false; finishRecording(); }
    } else { busy = false; finishRecording(); }
  }

  function setMicUI(recording) {
    if (!rec) return;
    rec.mic.className = 'rs-iconbtn rs-input-mic' + (recording ? ' rs-recording' : '');
    setIcon(rec.mic, recording ? 'stop' : 'mic');
    rec.mic.title = t(recording ? 'stopRecording' : 'speak');
    rec.mic.setAttribute('aria-label', rec.mic.title);
    if (recording) rec.micLabel.textContent = t('recording');
  }

  /* ── Files for a request ─────────────────────────────── */

  // Finished uploads survive a reload like the draft does; the files themselves wait on the server.
  function storedAttachments() {
    try {
      const list = JSON.parse(stored('files') || '[]');
      return Array.isArray(list) ? list : [];
    } catch (err) { return []; }
  }

  function saveAttachments() {
    const done = attachments.filter(function (entry) { return entry.state === 'done'; })
      .map(function (entry) { return { id: entry.id, name: entry.name, size: entry.size }; });
    stored('files', done.length ? JSON.stringify(done) : null);
  }

  function restoreAttachments(list) {
    attachments = (Array.isArray(list) ? list : []).filter(function (entry) {
      return entry && typeof entry.id === 'string' && typeof entry.name === 'string';
    }).map(function (entry) { return { id: entry.id, name: entry.name, size: Number(entry.size) || 0, sent: 0, state: 'done' }; });
    saveAttachments();
    renderFiles();
  }

  // Sent with a request, or gone on the server: off the list. The uploads stay on the server for the job.
  function forgetAttachments(ids) {
    if (!ids || !ids.length) return;
    attachments = attachments.filter(function (entry) { return ids.indexOf(entry.id) < 0; });
    saveAttachments();
    renderFiles();
  }

  async function loadUploadLimits() {
    try {
      const data = await request('/upload.php?app_id=' + encodeURIComponent(APP_ID));
      uploadLimits = data.max_files > 0 && Array.isArray(data.types) && data.types.length ? data : null;
    } catch (err) { uploadLimits = null; }
    if (uploadLimits) {
      ui.picker.accept = uploadLimits.types.map(function (type) { return '.' + type; }).join(',');
      ui.dropHint.textContent = t('dropHint', { count: uploadLimits.max_files, size: megabytes(uploadLimits.max_bytes) });
    }
    renderFiles();
  }

  function megabytes(bytes) { return Math.floor(bytes / 1048576); }

  function sizeText(bytes) {
    if (bytes < 1048576) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / 1048576).toLocaleString(lang, { maximumFractionDigits: 1 }) + ' MB';
  }

  function fileInfo(entry) {
    if (entry.state === 'error') return entry.error;
    if (entry.state === 'queued') return t('fileWaiting');
    if (entry.state === 'uploading') return Math.floor(entry.sent / entry.size * 100) + ' %';
    return entry.size ? sizeText(entry.size) : '';
  }

  function renderFiles() {
    ui.files.hidden = !uploadLimits;
    empty(ui.fileList);
    attachments.forEach(function (entry) {
      const row = mk('li', 'rs-file' + (entry.state === 'error' ? ' rs-file-error' : ''));
      const name = mk('span', 'rs-file-name', entry.name);
      name.title = entry.name;
      entry.info = mk('span', 'rs-file-info', fileInfo(entry));
      const remove = iconButton('x', t('removeFile', { name: entry.name }), 'rs-file-remove');
      remove.addEventListener('click', function () { removeAttachment(entry); });
      row.append(iconSpan('clip'), name, entry.info, remove);
      ui.fileList.appendChild(row);
    });
    ui.fileList.hidden = !attachments.length;
    ui.drop.disabled = !uploadLimits || attachments.length >= uploadLimits.max_files;
  }

  // Checked here for a quick answer; upload.php checks the same again.
  function addFiles(list) {
    if (!uploadLimits) return;
    const problems = [];
    Array.prototype.slice.call(list || []).forEach(function (file) {
      const dot = file.name.lastIndexOf('.');
      const type = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase();
      let problem = '';
      if (attachments.length >= uploadLimits.max_files) problem = t('filesTooMany', { count: uploadLimits.max_files });
      else if (uploadLimits.types.indexOf(type) < 0) problem = t('fileTypeNotAllowed', { name: file.name });
      else if (!file.size) problem = t('fileEmpty', { name: file.name });
      else if (file.size > uploadLimits.max_bytes) problem = t('fileTooLarge', { name: file.name, size: megabytes(uploadLimits.max_bytes) });
      if (problem) { if (problems.indexOf(problem) < 0) problems.push(problem); return; }
      attachments.push({ id: null, name: file.name, size: file.size, sent: 0, state: 'queued', file: file });
    });
    ui.fileNote.textContent = problems.join(' ');
    renderFiles();
    pumpUploads();
  }

  function removeAttachment(entry) {
    entry.removed = true;
    attachments = attachments.filter(function (other) { return other !== entry; });
    // A running upload notices the mark and discards itself.
    if (entry.state !== 'uploading' && entry.id) discardUpload(entry.id);
    ui.fileNote.textContent = '';
    saveAttachments();
    renderFiles();
  }

  function discardUpload(id) {
    sendPiece('id=' + encodeURIComponent(id) + '&remove=1').catch(function () { /* removed after a day anyway */ });
  }

  // One file after the other; "Apply change" waits until all of them are on the server.
  async function pumpUploads() {
    if (uploading) return;
    uploading = true;
    updateControls();
    for (;;) {
      const entry = attachments.find(function (item) { return item.state === 'queued'; });
      if (!entry) break;
      entry.state = 'uploading';
      renderFiles();
      try {
        await uploadFile(entry);
        entry.state = 'done';
        entry.file = null;
      } catch (err) {
        entry.state = 'error';
        entry.error = err.message || t('uploadFailed');
      }
      if (entry.removed && entry.id) discardUpload(entry.id);
      saveAttachments();
      renderFiles();
    }
    uploading = false;
    updateControls();
  }

  // A file travels in pieces, so no request exceeds the server's size limits. The first piece creates the upload.
  async function uploadFile(entry) {
    const step = uploadLimits.chunk_bytes || 524288;
    let offset = 0;
    let retries = 0;
    for (;;) {
      if (entry.removed) throw new Error(t('uploadFailed'));
      const query = entry.id ? 'id=' + encodeURIComponent(entry.id) + '&offset=' + offset
        : 'app_id=' + encodeURIComponent(APP_ID) + '&name=' + encodeURIComponent(entry.name) + '&size=' + entry.size;
      let data;
      try {
        data = await sendPiece(query, entry.file.slice(offset, offset + step));
      } catch (err) {
        // The server already has this piece (its answer got lost): continue where the server stands.
        if (err.status === 409 && typeof err.received === 'number' && err.received > offset) { offset = err.received; continue; }
        // No answer at all: the same piece once more.
        if (!err.status && entry.id && retries++ < 2) continue;
        throw err;
      }
      retries = 0;
      entry.id = data.id;
      entry.name = data.name;
      if (data.complete) return;
      if (!(data.received > offset)) throw new Error(t('uploadFailed'));
      offset = data.received;
      entry.sent = offset;
      if (entry.info) entry.info.textContent = fileInfo(entry);
    }
  }

  async function sendPiece(query, piece) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 120000);
    try {
      const options = { method: 'POST', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/octet-stream' } };
      if (piece) options.body = piece;
      const res = await fetch(API + '/upload.php?' + query, options);
      const data = await res.json();
      if (!res.ok || !data.success) {
        const err = new Error(data.message || t('uploadFailed'));
        err.status = res.status;
        err.received = data.received;
        throw err;
      }
      return data;
    } finally { clearTimeout(timer); }
  }

  /* ── Requests and jobs ───────────────────────────────── */

  async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      const options = { cache: 'no-store', signal: controller.signal };
      if (body) {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
      }
      const res = await fetch(API + path, options);
      const data = await res.json();
      if (!res.ok || !data.success) {
        const err = new Error(data.message || t('requestFailed'));
        err.status = res.status;
        err.jobId = data.job_id;
        err.missing = data.missing;
        throw err;
      }
      return data;
    } finally { clearTimeout(timer); }
  }

  // Every mutation names the variant it belongs to and who asked for it.
  function withContext(body) {
    const out = Object.assign({ app_id: APP_ID, workspace: WORKSPACE }, body);
    const author = authorName();
    if (author) out.author = author;
    return out;
  }
  function scopeQuery() {
    return 'app_id=' + encodeURIComponent(APP_ID) + '&workspace=' + encodeURIComponent(WORKSPACE);
  }

  // `files` are finished uploads ({ id }): the composer's list, or those of a request the agent answered with questions.
  async function submitChange(transcript, files) {
    const body = { transcript: transcript };
    if (files && files.length) body.attachments = files.map(function (entry) { return entry.id; });
    await queueAction('submit', withContext(body));
  }

  async function queueAction(endpoint, body) {
    if (busy || isRecording) return;
    busy = true;
    updateControls();
    setStatus(t('sendingRequest'), 'loading', false);
    try {
      const data = await request('/' + endpoint + '.php', body);
      if (endpoint === 'submit') {
        if (ui.input.value.trim() === body.transcript) setDraft('');
        forgetAttachments(body.attachments);
        showResult(null);
      }
      trackJob(data.job_id, endpoint === 'submit' ? 'change' : endpoint);
    } catch (err) {
      if (err.jobId) { trackJob(err.jobId); return; }
      forgetAttachments(err.missing);
      setStatus(t('inputKept', { message: err.message }), 'error', false);
      // A lost response may still have enqueued the job. Resolve that before allowing another send.
      if (!err.status || err.status >= 500) { resumeJob(); return; }
      busy = false;
      updateControls();
      if (endpoint === 'rollback') loadHistory();
    }
  }

  function trackJob(id, action) {
    clearTimeout(pollTimer);
    currentJobId = id;
    currentAction = action || null;
    busy = true;
    cancelling = false;
    stored('job', id);
    updateControls();
    pollStatus(id);
  }

  async function resumeJob() {
    busy = true;
    updateControls();
    const remembered = stored('job');
    if (remembered) { trackJob(remembered); return; }
    try {
      const data = await request('/status.php?' + scopeQuery());
      if (data.status) { trackJob(data.status.job_id, data.status.action); return; }
      busy = false;
      updateControls();
    } catch (err) {
      setStatus(t('statusUnreachable'), 'error', false);
      pollTimer = setTimeout(resumeJob, 5000);
    }
  }

  // Text for a job phase (texts phase_<name> in I18N); `fallback` is used for an unknown phase.
  function phaseLabel(status, fallback) {
    const id = 'phase_' + status.phase;
    if (typeof status.phase === 'string' && typeof I18N.en[id] === 'string') return t(id);
    return t(status.status === 'pending' ? 'phase_queued' : fallback);
  }

  function phaseText(status) {
    if (!status) return '';
    if (status.cancel_requested) return t('laneCancelling');
    return phaseLabel(status, 'running').replace(/…$/, '');
  }

  function reloadSoon() {
    onceFlag('reopen', '1');
    onceFlag('tab', ui.currentTab || 'change');
    setTimeout(function () { window.location.reload(); }, 1500);
  }

  function jumpTo(slug, tab) {
    onceFlag('reopen', '1');
    if (tab) onceFlag('tab', tab);
    setTimeout(function () { location.href = APP_BASE + '/w/' + slug + '/'; }, 1200);
  }

  function failureText(status) {
    return status.status === 'cancelled' ? t('cancelled') :
      t(status.status === 'blocked' ? 'blocked' : 'failedReason', { reason: status.blocked_reason || t('unknownError') });
  }

  function displayJob(status) {
    const terminal = ['done', 'cancelled', 'blocked', 'failed'].includes(status.status);
    currentAction = status.action || currentAction || 'change';
    if (terminal) {
      clearTimeout(pollTimer);
      currentJobId = null;
      stored('job', null);
      busy = false;
      cancelling = false;
    }
    if (currentAction === 'discuss') return displayDiscuss(status, terminal);
    if (terminal) {
      if (status.status === 'done') {
        if (status.action === 'fork') {
          setStatus(t('forkDone', { name: status.name || status.workspace }), 'success', false);
          updateControls();
          jumpTo(status.workspace, 'variants');
          return true;
        }
        if (status.action === 'delete') {
          if (status.workspace === WORKSPACE) {
            setStatus(t('deletedHere'), 'success', false);
            jumpTo(publicSlug, 'variants');
            return true;
          }
          setStatus(t('deletedStatus'), 'success', false);
          toast(t('deletedToast'), 'success');
        } else if (status.action === 'rename') {
          setStatus(t('nameSavedStatus'), 'success', false);
          toast(t('nameSavedToast'), 'success');
        } else if (status.action === 'promote') {
          const count = status.promoted_commits;
          const text = t('merged', { changes: count ? tn('changeCount', count) : t('theChanges'), target: nameOf(status.workspace) });
          setStatus(text, 'success', false);
          toast(text, 'success');
        } else if ((status.action || 'change') === 'change') {
          // The result card takes over from the status line: summary and follow-up questions.
          const asks = !!(status.result && (status.result.questions || []).length);
          const text = t(status.commit_hash ? 'changeApplied' : asks ? 'followUpPending' : 'doneNoChange');
          if (status.result) { hideStatus(); stored('last', status.job_id); showResult(status); }
          else setStatus(text, 'success', false);
          toast(text.replace(/^✓ /, ''), asks && !status.commit_hash ? 'info' : 'success');
          if (!isOpen && asks) attention = 'change';
          // Only a published change alters the page; draft and result are persisted before the reload.
          if (status.commit_hash) reloadSoon();
        } else {
          if (status.action === 'rollback' && typeof status.original_prompt === 'string') setDraft(status.original_prompt);
          const text = t(status.action === 'rollback' ? 'undone' : status.action === 'baseline' ? 'baselineSet' : 'baselineRestored');
          showResult(null);
          setStatus(text, 'success', false);
          toast(text, 'success');
          reloadSoon();
        }
      } else {
        // A rejected change request goes back into the text field, so nothing typed is lost.
        if ((status.action || 'change') === 'change' && typeof status.prompt === 'string' && !ui.input.value.trim()) {
          setDraft(status.prompt);
          if (!attachments.length) restoreAttachments(status.attachments);
        }
        setStatus(failureText(status), 'error', false);
        toast(t(status.status === 'cancelled' ? 'cancelled' : 'notApplied'), 'error');
      }
      updateControls();
      loadHistory();
      loadWorkspaces();
      return true;
    }
    cancelling = cancelling || status.cancel_requested;
    setStatus(cancelling ? t('cancelRequested') : phaseLabel(status, 'processing'),
      'loading', !cancelling && status.phase !== 'publishing');
    setStepper(status.phase || 'queued', status.action || 'change');
    updateControls();
    return false;
  }

  async function pollStatus(jobId) {
    if (currentJobId !== jobId) return;
    try {
      const data = await request('/status.php?job_id=' + encodeURIComponent(jobId));
      if (currentJobId !== jobId) return;
      if (data.status && displayJob(data.status)) return;
    } catch (err) {
      if (currentJobId !== jobId) return;
      if (err.status === 404) {
        currentJobId = null;
        stored('job', null);
        resumeJob();
        return;
      }
      const text = t(err.status === 401 ? 'sessionExpired' : 'connectionLost');
      if (currentAction === 'discuss') { chat.error = text; renderChat(); } else setStatus(text, 'error', false);
    }
    if (currentJobId === jobId) pollTimer = setTimeout(function () { pollStatus(jobId); }, 2000);
  }

  async function cancelJob() {
    if (!currentJobId || cancelling) return;
    const id = currentJobId;
    cancelling = true;
    if (currentAction === 'discuss') renderChat(); else setStatus(t('requestingCancel'), 'loading', false);
    try {
      const data = await request('/cancel.php', { job_id: id });
      if (currentJobId === id && data.status) displayJob(data.status);
    } catch (err) {
      if (currentJobId === id) {
        cancelling = false;
        if (currentAction === 'discuss') { chat.error = t('cancelNotConfirmed', { message: err.message }); renderChat(); }
        else setStatus(t('cancelNotConfirmed', { message: err.message }), 'error', true);
      }
    }
  }

  /* ── Questions as a form ─────────────────────────────── */

  // Follow-up questions from the agent, drawn as clickable options instead of text. Every question also
  // takes a free answer. `submit` receives [{ text, answer }] for the answered questions.
  function buildQuestions(questions, submit, label) {
    const form = mk('div', 'rs-questions');
    const state = questions.map(function () { return { picked: [], free: '' }; });
    const send = textButton(label || t('sendAnswers'), 'rs-btn-primary', 'send');
    send.sayandshapeReady = false;
    function answerOf(i) {
      return state[i].picked.concat(state[i].free.trim() ? [state[i].free.trim()] : []).join(', ');
    }
    function refresh() {
      send.sayandshapeReady = questions.some(function (q, i) { return !!answerOf(i); });
      send.disabled = busy || isRecording || !send.sayandshapeReady;
    }
    questions.forEach(function (question, i) {
      const block = mk('div', 'rs-question');
      block.appendChild(mk('div', 'rs-question-text', question.text));
      const options = question.type === 'text' ? [] : (question.options || []);
      if (options.length) {
        if (question.type === 'multi') block.appendChild(mk('div', 'rs-question-note', t('chooseMany')));
        const group = mk('div', 'rs-options');
        group.setAttribute('role', question.type === 'multi' ? 'group' : 'radiogroup');
        const buttons = options.map(function (option) {
          const button = mk('button', 'rs-option');
          button.type = 'button';
          button.setAttribute('role', question.type === 'multi' ? 'checkbox' : 'radio');
          button.setAttribute('aria-checked', 'false');
          button.appendChild(mk('span', 'rs-option-mark'));
          const text = mk('span', 'rs-option-text');
          text.appendChild(mk('span', 'rs-option-label', option.label));
          if (option.description) text.appendChild(mk('span', 'rs-option-desc', option.description));
          button.appendChild(text);
          button.addEventListener('click', function () {
            const at = state[i].picked.indexOf(option.label);
            if (question.type === 'multi') { if (at >= 0) state[i].picked.splice(at, 1); else state[i].picked.push(option.label); }
            else state[i].picked = at >= 0 ? [] : [option.label];
            buttons.forEach(function (other, n) {
              const on = state[i].picked.indexOf(options[n].label) >= 0;
              other.className = 'rs-option' + (on ? ' rs-option-on' : '');
              other.setAttribute('aria-checked', on ? 'true' : 'false');
            });
            refresh();
          });
          group.appendChild(button);
          return button;
        });
        block.appendChild(group);
      }
      const free = document.createElement('input');
      free.type = 'text';
      free.maxLength = 500;
      free.className = 'rs-question-free';
      free.placeholder = t(options.length ? 'ownAnswer' : 'typeAnswer');
      free.setAttribute('aria-label', t('ownAnswerAria', { question: question.text }));
      free.addEventListener('input', function () { state[i].free = free.value; refresh(); });
      free.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') { e.preventDefault(); send.click(); } });
      block.appendChild(free);
      form.appendChild(block);
    });
    send.addEventListener('click', function () {
      if (busy || isRecording || !send.sayandshapeReady) return;
      submit(questions.map(function (q, i) { return { text: q.text, answer: answerOf(i) }; }).filter(function (entry) { return entry.answer; }));
    });
    refresh();
    answerButtons.push(send);
    const row = mk('div', 'rs-row');
    row.appendChild(send);
    form.appendChild(row);
    return form;
  }

  function answersText(answers) {
    return answers.map(function (entry) { return '- ' + entry.text + ' → ' + entry.answer; }).join('\n');
  }

  /* ── Result of a change request ──────────────────────── */

  // After the reload that follows a published change, the result card of that request is shown again.
  async function restoreResult() {
    const id = stored('last');
    if (!id) return;
    try {
      const data = await request('/status.php?job_id=' + encodeURIComponent(id));
      if (data.status && data.status.status === 'done' && data.status.result && !lastResult && !currentJobId) showResult(data.status);
    } catch (err) {
      if (err.status === 404) stored('last', null);
    }
  }

  function showResult(status) {
    lastResult = status && status.result ? status : null;
    if (!lastResult) stored('last', null);
    renderResult();
    syncLast();
  }

  function renderResult() {
    const card = ui.result;
    empty(card);
    answerButtons = answerButtons.filter(function (button) { return button.sayandshapeOwner !== 'result'; });
    ui.resultUndo = null;
    if (!lastResult) { card.hidden = true; return; }
    const status = lastResult, result = status.result;
    const questions = result.questions || [];
    const changed = !!status.commit_hash;
    const kind = changed ? 'done' : questions.length ? 'ask' : 'none';
    card.hidden = false;
    card.className = 'rs-result rs-result-' + kind;

    const head = mk('div', 'rs-result-head');
    const badge = mk('span', 'rs-result-badge');
    badge.innerHTML = kind === 'ask' ? ICONS.question : ICONS.check;
    const title = mk('div', 'rs-result-title');
    title.append(mk('span', 'rs-result-name', t(kind === 'done' ? 'resultDone' : kind === 'ask' ? 'resultAsk' : 'resultNone')),
      mk('span', 'rs-hint', [ago(status.finished_at || status.updated_at), status.author].filter(Boolean).join(' · ')));
    const dismiss = iconButton('x', t('hideResult'), 'rs-result-close');
    dismiss.id = 'sayandshape-result-close';
    dismiss.addEventListener('click', function () { showResult(null); });
    head.append(badge, title, dismiss);
    card.appendChild(head);

    if (status.prompt) card.appendChild(mk('div', 'rs-result-prompt', quoted(status.prompt)));
    const attached = (status.attachments || []).map(function (entry) { return entry.name; });
    if (attached.length) card.appendChild(mk('div', 'rs-result-meta', t('attachedFiles', { files: attached.join(', ') })));
    if (result.summary) card.appendChild(richText(result.summary, 'rs-result-summary'));
    if ((result.points || []).length) card.appendChild(pointList(result.points));
    const files = (status.files_changed || []).length;
    if (changed && files) card.appendChild(mk('div', 'rs-result-meta', t('filesChanged', { files: tn('fileCount', files) })));

    if (questions.length) {
      // The answers go to the AI in the interface language.
      const form = buildQuestions(questions, function (answers) {
        const prompt = status.prompt || '';
        const text = (changed ? t('followUpChanged', { prompt: prompt.slice(0, 400) }) : prompt) +
          '\n\n' + t('myAnswers') + '\n' + answersText(answers);
        // Nothing was changed yet: the files of the request go along again. After a change they are in the project.
        submitChange(text.slice(0, 9000), changed ? [] : status.attachments);
      }, t(changed ? 'sendAnswersContinue' : 'sendAnswersApply'));
      answerButtons[answerButtons.length - 1].sayandshapeOwner = 'result';
      card.appendChild(form);
    }
    const undo = textButton(t('undo'), '', 'undo');
    undo.id = 'sayandshape-result-undo';
    undo.hidden = true;
    undo.addEventListener('click', function () { if (undo.sayandshapeHash) doRollback(undo.sayandshapeHash); });
    ui.resultUndo = undo;
    card.appendChild(undo);
  }

  /* ── Discuss ───────────────────────────────────────── */

  async function loadChat() {
    try {
      const data = await request('/discuss.php?' + scopeQuery());
      chat.messages = data.messages || [];
      renderChat();
    } catch (err) { /* the chat is optional; keep what is shown */ }
  }

  function scrollChat() {
    if (ui.currentTab !== 'discuss') return;
    try { ui.body.scrollTop = ui.body.scrollHeight; } catch (err) { /* ignore */ }
  }

  function renderChat() {
    const list = ui.chat;
    empty(list);
    answerButtons = answerButtons.filter(function (button) { return button.sayandshapeOwner !== 'chat'; });
    const messages = chat.messages;
    ui.chatReset.hidden = !messages.length;
    if (!messages.length && !chat.pending) {
      const intro = mk('div', 'rs-chat-empty');
      intro.appendChild(mk('p', 'rs-hint', t('noConversation')));
      [t('example1'), t('example2'), t('example3')].forEach(function (example) {
        const chip = mk('button', 'rs-example', example);
        chip.type = 'button';
        chip.addEventListener('click', function () { ui.chatBox.setDraft(example); ui.chatBox.input.focus(); });
        intro.appendChild(chip);
      });
      list.appendChild(intro);
    }
    messages.forEach(function (message, index) {
      if (message.role === 'user') { list.appendChild(userBubble(message.text, message.author, message.at)); return; }
      const result = message.result || {};
      const card = mk('div', 'rs-msg rs-msg-ai');
      if (result.summary) card.appendChild(richText(result.summary));
      if ((result.points || []).length) card.appendChild(pointList(result.points));
      const questions = result.questions || [];
      const latest = index === messages.length - 1 && !chat.pending;
      if (questions.length && latest) {
        card.appendChild(buildQuestions(questions, function (answers) {
          sendChatMessage(t('myAnswers') + '\n' + answersText(answers));
        }));
        answerButtons[answerButtons.length - 1].sayandshapeOwner = 'chat';
      } else if (questions.length) {
        card.appendChild(pointList(questions.map(function (q) { return q.text; })));
      }
      if (result.suggestion) {
        const box = mk('div', 'rs-suggestion');
        const head = mk('div', 'rs-suggestion-head');
        head.append(iconSpan('spark'), mk('span', '', t('suggestedChange')));
        const adopt = textButton(t('useInEdit'), 'rs-btn-soft', 'send');
        adopt.addEventListener('click', function () {
          setDraft(result.suggestion);
          setTab('change');
          ui.input.focus();
        });
        box.append(head, mk('div', 'rs-suggestion-text', result.suggestion), adopt);
        card.appendChild(box);
      }
      list.appendChild(card);
    });
    if (chat.pending) {
      list.appendChild(userBubble(chat.pending.text, authorName(), null));
      const wait = mk('div', 'rs-msg rs-msg-ai rs-msg-wait');
      const dots = mk('span', 'rs-typing');
      dots.append(mk('span'), mk('span'), mk('span'));
      const stop = textButton(t('cancel'), 'rs-btn-ghost');
      stop.id = 'sayandshape-chat-cancel';
      stop.hidden = cancelling || !currentJobId;
      stop.addEventListener('click', cancelJob);
      wait.append(dots, mk('span', 'rs-hint', cancelling ? t('chatCancelling') : chat.pending.label || t('lookingAtApp')), stop);
      list.appendChild(wait);
    }
    if (chat.error) {
      const error = mk('div', 'rs-chat-error', chat.error);
      error.id = 'sayandshape-chat-error';
      list.appendChild(error);
    }
    scrollChat();
  }

  function userBubble(text, author, at) {
    const wrap = mk('div', 'rs-msg rs-msg-user');
    wrap.appendChild(mk('div', 'rs-msg-text', text));
    const meta = [author, at ? ago(at) : ''].filter(Boolean).join(' · ');
    if (meta) wrap.appendChild(mk('div', 'rs-msg-meta', meta));
    return wrap;
  }

  function sendChat() {
    const text = ui.chatBox.input.value.trim();
    if (text && !busy && !isRecording) sendChatMessage(text);
  }

  async function sendChatMessage(text) {
    if (busy || isRecording) return;
    busy = true;
    chat.error = '';
    chat.pending = { text: text, label: t('sendingQuestion') };
    updateControls();
    renderChat();
    try {
      const data = await request('/discuss.php', withContext({ message: text }));
      if (ui.chatBox.input.value.trim() === text) ui.chatBox.setDraft('');
      trackJob(data.job_id, 'discuss');
    } catch (err) {
      chat.pending = null;
      if (err.jobId) { chat.error = t('jobRunning'); renderChat(); trackJob(err.jobId); return; }
      chat.error = t('questionKept', { message: err.message });
      renderChat();
      if (!err.status || err.status >= 500) { resumeJob(); return; }
      busy = false;
      updateControls();
    }
  }

  function displayDiscuss(status, terminal) {
    if (!terminal) {
      cancelling = cancelling || status.cancel_requested;
      chat.pending = { text: status.prompt || (chat.pending && chat.pending.text) || '',
        label: t(status.status === 'pending' ? 'chatQueued' : 'writingAnswer') };
      renderChat();
      updateControls();
      return false;
    }
    chat.pending = null;
    if (status.status === 'done' && status.result) {
      chat.error = '';
      chat.messages = chat.messages.concat([
        { role: 'user', text: status.prompt || '', author: status.author, at: status.submitted_at },
        { role: 'assistant', result: status.result, at: status.finished_at }]);
      if (!isOpen || ui.currentTab !== 'discuss') { attention = 'discuss'; toast(t('newAnswerToast'), 'success'); }
      loadChat();
    } else {
      chat.error = failureText(status);
      // The unanswered question goes back into the text field.
      if (typeof status.prompt === 'string' && !ui.chatBox.input.value.trim()) ui.chatBox.setDraft(status.prompt);
    }
    renderChat();
    updateControls();
    return true;
  }

  async function clearChat() {
    if (busy || isRecording || !chat.messages.length) return;
    if (!confirm(t('clearConfirm'))) return;
    try {
      await request('/discuss.php', withContext({ clear: true }));
      chat.messages = [];
      chat.error = '';
      renderChat();
      toast(t('chatCleared'), 'success');
      ui.chatBox.input.focus();
    } catch (err) {
      chat.error = err.message;
      renderChat();
    }
  }

  /* ── Variants ────────────────────────────────────────── */

  function pollWorkspaces() {
    if (!isOpen) return;
    loadWorkspaces();
    wsTimer = setTimeout(pollWorkspaces, 6000);
  }

  async function loadWorkspaces() {
    try {
      const data = await request('/workspaces.php?app_id=' + encodeURIComponent(APP_ID));
      workspaces = data.workspaces || [];
      publicSlug = data.public || 'main';
    } catch (err) { return; }
    const current = workspaces.find(function (ws) { return ws.slug === WORKSPACE; });
    const label = current && current.name ? current.name : WORKSPACE;
    ui.chip.textContent = label;
    ui.launcherText.textContent = label;
    ui.scope.textContent = current && current.public ? t('scopePublic') : t('scopeVariant', { name: label });
    ui.scopeHelp.title = ui.scope.textContent;
    renderVariants();
  }

  function renderVariants() {
    const tree = ui.tree;
    while (tree.firstChild) tree.removeChild(tree.firstChild);
    variantButtons = [];
    const bySlug = {};
    workspaces.forEach(function (ws) { bySlug[ws.slug] = ws; });
    const children = {};
    const roots = [];
    workspaces.forEach(function (ws) {
      const parent = ws.parent && ws.parent !== ws.slug && bySlug[ws.parent] ? ws.parent : null;
      if (parent) (children[parent] = children[parent] || []).push(ws); else roots.push(ws);
    });
    roots.sort(function (a, b) { return (b.public ? 1 : 0) - (a.public ? 1 : 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')); });
    if (!workspaces.length) tree.appendChild(mk('p', 'rs-empty', t('noVariants')));
    roots.forEach(function (ws) { renderNode(ws, tree, children); });
    updateControls();
  }

  function renderNode(ws, container, children) {
    const current = ws.slug === WORKSPACE;
    const row = mk('div', 'rs-ws' + (current ? ' rs-ws-current' : ''));
    row.id = 'sayandshape-ws-' + ws.slug;

    const title = mk('div', 'rs-ws-title');
    title.appendChild(mk('span', 'rs-ws-name', ws.name || ws.slug));
    if (ws.public) title.appendChild(mk('span', 'rs-badge rs-badge-public', t('badgePublic')));
    if (current) title.appendChild(mk('span', 'rs-badge rs-badge-here', t('badgeHere')));

    const lane = mk('div', 'rs-lane');
    const total = ws.changes_since_fork || 0;
    const shown = Math.min(total, 8);
    for (let i = 0; i < shown; i++) {
      if (i) lane.appendChild(mk('span', 'rs-lane-line'));
      lane.appendChild(mk('span', 'rs-dot rs-dot-commit'));
    }
    if (total > shown) lane.appendChild(mk('span', 'rs-lane-more', '+' + (total - shown)));
    if (ws.active_job) {
      if (shown) lane.appendChild(mk('span', 'rs-lane-line'));
      lane.appendChild(mk('span', 'rs-dot rs-dot-run'));
      const running = mk('span', 'rs-lane-run', phaseText(ws.active_job) + (ws.active_job.prompt ? ': ' + quoted(ws.active_job.prompt) : ''));
      lane.appendChild(running);
    } else if (!total) {
      lane.appendChild(mk('span', 'rs-lane-note', t(ws.exists ? (ws.parent ? 'laneNoOwn' : 'laneOriginal') : 'laneLater')));
    }

    const metaParts = [];
    if (ws.last_change && ws.last_change.author && ws.last_change.author !== 'SayAndShape') metaParts.push(ws.last_change.author);
    if (ws.last_change && ws.last_change.date) metaParts.push(ago(ws.last_change.date));
    if (ws.parent && bySlugName(ws.parent)) metaParts.push(t('fromParent', { name: bySlugName(ws.parent) }));
    const meta = mk('div', 'rs-ws-meta', metaParts.join(' · '));

    const actions = mk('div', 'rs-ws-actions');
    if (!current) {
      const openLink = mk('a', 'rs-btn', t('open'));
      openLink.href = APP_BASE + '/w/' + ws.slug + '/';
      // Switching variants keeps the panel open and starts on "Edit"; a new browser tab opens it as usual.
      openLink.addEventListener('click', function (e) {
        if (e && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button === 1)) return;
        onceFlag('reopen', '1');
        onceFlag('tab', 'change');
      });
      actions.appendChild(openLink);
    }
    const dup = textButton(t('duplicate'), '');
    dup.sayandshapeAllowed = !!ws.exists;
    dup.title = t('duplicateTitle');
    dup.addEventListener('click', function () { openForkForm(ws.slug); });
    variantButtons.push(dup);
    actions.appendChild(dup);
    if (current) {
      if (ws.promote) {
        const target = bySlugName(ws.promote.target) || ws.promote.target;
        const promote = textButton(t('mergeInto', { target: target }), 'rs-btn-primary');
        promote.id = 'sayandshape-promote-btn';
        promote.sayandshapeAllowed = ws.promote.commits > 0;
        promote.title = ws.promote.commits ? tn('changeCount', ws.promote.commits) + ', ' + tn('fileCount', ws.promote.files.length) : t('nothingToMerge');
        promote.addEventListener('click', function () { doPromote(ws, target); });
        variantButtons.push(promote);
        actions.appendChild(promote);
      }
      const rename = textButton(t('rename'), '');
      rename.id = 'sayandshape-rename-btn';
      rename.addEventListener('click', function () { doRename(ws); });
      variantButtons.push(rename);
      actions.appendChild(rename);
      if (!ws.public && !(children[ws.slug] || []).length) {
        const del = textButton(t('delete'), 'rs-btn-danger');
        del.id = 'sayandshape-delete-btn';
        del.addEventListener('click', function () { doDelete(ws); });
        variantButtons.push(del);
        actions.appendChild(del);
      }
    }
    row.append(title, lane, meta, actions);
    container.appendChild(row);
    const kids = children[ws.slug] || [];
    if (kids.length) {
      const sub = mk('div', 'rs-ws-children');
      kids.forEach(function (kid) { renderNode(kid, sub, children); });
      container.appendChild(sub);
    }
  }

  function bySlugName(slug) {
    const found = workspaces.find(function (ws) { return ws.slug === slug; });
    return found ? (found.name || found.slug) : '';
  }

  function openForkForm(source) {
    ui.forkSource = source;
    ui.forkForm.hidden = false;
    ui.forkName.value = '';
    ui.forkHint.textContent = t('forkHint', { name: bySlugName(source) || source });
    ui.forkName.focus();
  }

  async function submitFork() {
    const name = ui.forkName.value.trim();
    if (!name || busy || isRecording) return;
    ui.forkForm.hidden = true;
    setTab('change');
    await queueAction('fork', withContext({ name: name, source: ui.forkSource || publicSlug }));
  }

  async function doPromote(ws, targetName) {
    if (busy || isRecording) return;
    if (!confirm(t('promoteConfirm', { from: ws.name || ws.slug, target: targetName }))) return;
    setTab('change');
    await queueAction('promote', withContext({}));
  }

  async function doRename(ws) {
    if (busy || isRecording) return;
    const name = prompt(t('renamePrompt'), ws.name || ws.slug);
    if (name === null || !name.trim() || name.trim() === ws.name) return;
    await queueAction('rename_workspace', withContext({ name: name.trim() }));
  }

  async function doDelete(ws) {
    if (busy || isRecording) return;
    if (!confirm(t('deleteConfirm', { name: ws.name || ws.slug }))) return;
    setTab('change');
    await queueAction('delete_workspace', withContext({}));
  }

  /* ── History ─────────────────────────────────────────── */

  async function loadHistory() {
    try {
      const data = await request('/history.php?app_id=' + encodeURIComponent(APP_ID) + '&workspace=' + encodeURIComponent(WORKSPACE));
      if (!data.success) return;
      historyData = data;
      renderHistory(data);
      renderLastChange(data);
    } catch (err) { /* silently ignore */ }
  }

  function renderHistory(data) {
    const list = ui.historyList;
    const hasHistory = data.commits.length > 0 || (data.archives || []).length > 0;
    ui.tabs.history.hidden = !hasHistory;
    if (!hasHistory && ui.currentTab === 'history') setTab('change');
    const count = data.active_count === undefined ? data.commits.length : data.active_count;
    ui.historyCount.textContent = t('historyCount', { changes: tn('changeCount', count) });
    ui.base.hidden = !data.commits.length;
    ui.base.sayandshapeRollbackAllowed = data.commits.length > 0;
    ui.reset.style.display = data.commits.length ? 'block' : 'none';
    ui.reset.sayandshapeAllowed = data.commits.length > 0;
    historyButtons = [];
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!data.commits.length) {
      list.appendChild(mk('p', 'rs-empty', t((data.archives || []).length ? 'noChangesSinceBase' : 'noChanges')));
    }
    // Active entries follow rollback permissions; archived entries are read-only.
    data.commits.forEach(function (c, index) {
      const item = mk('div', 'rs-change' + (c.can_rollback ? '' : ' rs-change-locked') + (index === 0 ? ' rs-change-latest' : ''));
      const who = c.author && c.author !== 'SayAndShape' ? ' · ' + c.author : '';
      const meta = mk('div', 'rs-change-meta', fmtDate(c.date) + who + (index === 0 ? ' · ' + t('latest') : ''));
      const msg = mk('div', 'rs-change-msg', quoted(c.message));
      const actions = mk('div', 'rs-change-actions');
      const btn = textButton(t('undo'), '', 'undo');
      const allowed = c.can_rollback === true;
      btn.sayandshapeRollbackAllowed = allowed;
      btn.hidden = !allowed;
      btn.disabled = busy || isRecording || !allowed;
      btn.title = t(c.is_latest ? 'undoLatestTitle' : 'undoCheckedTitle');
      btn.addEventListener('click', function () { if (allowed) doRollback(c.hash); });
      historyButtons.push(btn);
      actions.appendChild(btn);
      item.append(meta, msg, actions);
      if (!allowed) {
        const locked = mk('span', 'rs-locked');
        locked.appendChild(iconSpan('lock'));
        locked.appendChild(mk('span', '', t('undoLocked')));
        actions.appendChild(locked);
        let reason = c.blocked_reason || t('notChecked');
        const dependentPrompts = (c.dependent_commits || []).map(function (hash) {
          const later = data.commits.find(function (entry) { return entry.hash === hash; });
          return later ? quoted(later.message.slice(0, 70)) : '';
        }).filter(Boolean);
        if (dependentPrompts.length) reason += ' ' + t('affected', { list: dependentPrompts.join(', ') });
        item.appendChild(mk('p', 'rs-change-reason', reason));
      }
      list.appendChild(item);
    });
    (data.archives || []).forEach(function (archive) {
      const block = mk('details', 'rs-archive');
      const entries = archive.commits || [];
      const summary = mk('summary', '', t('archiveSummary', { date: fmtDate(archive.created_at), changes: tn('changeCount', entries.length) }));
      block.appendChild(summary);
      block.appendChild(mk('p', 'rs-archive-note', t('archiveNote')));
      entries.forEach(function (entry) {
        const item = mk('div', 'rs-archive-item');
        item.append(mk('div', 'rs-change-meta', fmtDate(entry.date) + (entry.author && entry.author !== 'SayAndShape' ? ' · ' + entry.author : '')), mk('div', 'rs-change-msg', entry.message));
        block.appendChild(item);
      });
      list.appendChild(block);
    });
    updateControls();
  }

  function renderLastChange(data) {
    const box = ui.last;
    empty(box);
    ui.boxUndo = null;
    const latest = data.commits && data.commits[0];
    if (!latest) { box.hidden = true; syncLast(); return; }
    box.hidden = false;
    const text = mk('div', 'rs-last-text');
    text.append(mk('span', 'rs-hint', t('lastChange')), mk('span', 'rs-last-msg', latest.message),
                mk('span', 'rs-hint', [ago(latest.date), latest.author && latest.author !== 'SayAndShape' ? latest.author : ''].filter(Boolean).join(' · ')));
    box.appendChild(text);
    if (latest.can_rollback) {
      const undo = textButton(t('undo'), '', 'undo');
      undo.id = 'sayandshape-last-undo';
      undo.sayandshapeRollbackAllowed = true;
      undo.addEventListener('click', function () { doRollback(latest.hash); });
      ui.boxUndo = undo;
      box.appendChild(undo);
    }
    syncLast();
  }

  // The result card and the "Last change" box describe the same change right after a request:
  // then only the card is shown, and it carries the undo button.
  function syncLast() {
    const latest = historyData && historyData.commits && historyData.commits[0];
    const same = !!(lastResult && latest && lastResult.commit_hash && lastResult.commit_hash === latest.hash);
    ui.last.hidden = !latest || same;
    if (ui.resultUndo) {
      ui.resultUndo.hidden = !(same && latest.can_rollback);
      ui.resultUndo.sayandshapeHash = same ? latest.hash : null;
      ui.resultUndo.sayandshapeRollbackAllowed = same && latest.can_rollback === true;
    }
    ui.lastUndo = same ? ui.resultUndo : ui.boxUndo;
    updateControls();
  }

  async function doRollback(hash) {
    if (busy || isRecording || !confirm(t('undoConfirm'))) return;
    setTab('change');
    await queueAction('rollback', withContext({ commit_hash: hash }));
  }

  async function doEstablishBase() {
    if (busy || isRecording || !confirm(t('baselineConfirm'))) return;
    setTab('change');
    await queueAction('baseline', withContext({}));
  }

  async function doReset() {
    if (busy || isRecording || !confirm(t('resetConfirm'))) return;
    setTab('change');
    await queueAction('reset', withContext({}));
  }

  /* ── Boot ───────────────────────────────────────────── */

  // The app is public and view-only by default. The helper only appears once the visitor is
  // logged in as the host admin, checked server-side via /sayandshape/api/session.php.
  // The same answer carries the interface language, so the panel is built in it from the start.
  async function boot() {
    try {
      const res  = await fetch(API + '/session.php', { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (!data || !data.logged_in) return;
      lang = pickLanguage(data.language);
      storagePrefix = 'sayandshape:' + SAYANDSHAPE_BASE + ':' + APP_ID + ':' + WORKSPACE + ':' + data.user_id + ':';
    } catch (err) { return; }                  // on error → stay view-only
    init();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
