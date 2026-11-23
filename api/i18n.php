<?php
/**
 * Interface language: English (default) or German, set engine-wide in config/apps.json → "language".
 * The English text is the key: sayandshapeT('Not logged in') returns it unchanged in English and looks it up in
 * SAYANDSHAPE_DE in German. Texts with values use {name} placeholders, filled from $vars after the lookup.
 * Required by api/auth.php (so the API, the login and the setup page have it) and by router/router.php.
 */

const SAYANDSHAPE_LANGUAGES = ['en', 'de'];

/** English → German. Missing entries stay English. */
const SAYANDSHAPE_DE = [
    // ── API messages ──
    'Configuration not available' => 'Konfiguration nicht verfügbar',
    'Not logged in' => 'Nicht angemeldet',
    'Invalid user' => 'Ungültiger Benutzer',
    'This requires the SayAndShape login' => 'Dafür ist die SayAndShape-Anmeldung erforderlich',
    'No password has been set yet. Run on the server: bin/sayandshape passwd' => 'Es ist noch kein Passwort gesetzt. Auf dem Server ausführen: bin/sayandshape passwd',
    'Too many failed attempts. Please try again in a few minutes.' => 'Zu viele Fehlversuche. Bitte in einigen Minuten erneut versuchen.',
    'Wrong password.' => 'Passwort nicht korrekt.',
    'Login could not be saved (write permission on jobs/?)' => 'Anmeldung konnte nicht gespeichert werden (Schreibrechte auf jobs/?)',
    'POST required' => 'POST erforderlich',
    'Request not allowed' => 'Anfrage nicht erlaubt',
    'Request too large' => 'Anfrage zu groß',
    'Invalid JSON' => 'Ungültiges JSON',
    'Invalid project' => 'Ungültige App',
    'Unknown project' => 'Unbekannte App',
    'No access to this project' => 'Kein Zugriff auf dieses Projekt',
    'Invalid configuration' => 'Konfiguration ungültig',
    'Variant registry temporarily unreadable' => 'Varianten-Registry vorübergehend nicht lesbar',
    'Invalid variant' => 'Ungültige Variante',
    'Variant not found' => 'Variante nicht gefunden',
    'Invalid name' => 'Ungültiger Name',
    'Name must be 1–60 characters' => 'Name muss 1–60 Zeichen enthalten',
    'Helper process not available' => 'Hilfsprozess nicht verfügbar',
    'Helper process failed' => 'Hilfsprozess fehlgeschlagen',
    'Invalid job ID' => 'Ungültige Job-ID',
    'Job not found' => 'Auftrag nicht gefunden',
    'Job status temporarily not available' => 'Auftragsstatus vorübergehend nicht verfügbar',
    'A job is already running in the source variant' => 'In der Ausgangs-Variante läuft bereits ein Auftrag',
    'Queue not available' => 'Queue nicht verfügbar',
    'A job is already running in this variant' => 'In dieser Variante läuft bereits ein Auftrag',
    'A variant with this name already exists' => 'Eine Variante mit diesem Namen existiert bereits',
    'Job could not be saved' => 'Auftrag konnte nicht gespeichert werden',
    'No change history yet' => 'Kein Änderungsverlauf vorhanden',
    'Dependencies could not be checked' => 'Abhängigkeiten nicht prüfbar',
    'AI agent: only claude or codex' => 'KI: nur claude oder codex',
    'Model: invalid ID' => 'Modell: ungültige Kennung',
    'Effort: invalid value' => 'Denkaufwand: ungültiger Wert',
    'Language: only en or de' => 'Sprache: nur en oder de',
    'Configuration could not be saved (write permission on config/?)' => 'Konfiguration konnte nicht gespeichert werden (Schreibrechte auf config/?)',
    'Configuration could not be saved (write permission?)' => 'Konfiguration konnte nicht gespeichert werden (Schreibrechte?)',
    'Field {key} must be text' => 'Feld {key} muss Text sein',
    'Field {key} is too long (max. {max} characters)' => 'Feld {key} ist zu lang (max. {max} Zeichen)',
    'Field {key} must be a list' => 'Feld {key} muss eine Liste sein',
    'Field {key}: only text allowed' => 'Feld {key}: nur Text erlaubt',
    'Field {key}: invalid entry' => 'Feld {key}: Eintrag ungültig',
    "Field {key}: only relative paths without '..'" => 'Feld {key}: nur relative Pfade ohne „..“',
    'Field {key}: at most {max} entries' => 'Feld {key}: höchstens {max} Einträge',
    'ID: only lowercase letters, digits, - and _ (max. 40)' => 'Kennung: nur Kleinbuchstaben, Ziffern, - und _ (max. 40)',
    'Project not found' => 'Projekt nicht gefunden',
    'Folder must be an absolute path' => 'Ordner muss ein absoluter Pfad sein',
    'Folder not found' => 'Ordner nicht gefunden',
    'Folder not readable' => 'Ordner nicht lesbar',
    'This folder cannot be used as a project' => 'Dieser Ordner kann nicht als Projekt dienen',
    'Public variant: invalid ID' => 'Öffentliche Variante: ungültige Kennung',
    'Files per change: 1 to 200' => 'Dateien pro Änderung: 1 bis 200',
    'Uploads per request: 0 to 50' => 'Uploads pro Anfrage: 0 bis 50',
    'Upload size: 1 to 200 MB' => 'Upload-Größe: 1 bis 200 MB',
    'Upload types: only file endings such as jpg or pdf' => 'Upload-Dateitypen: nur Dateiendungen wie jpg oder pdf',
    'Files of the type {type} can never be uploaded' => 'Dateien vom Typ {type} können nie hochgeladen werden',
    'Invalid attachments' => 'Ungültige Anhänge',
    'At most {max} files per request' => 'Höchstens {max} Dateien pro Anfrage',
    'An uploaded file is no longer available. Please add it again.' => 'Eine hochgeladene Datei ist nicht mehr vorhanden. Bitte erneut hinzufügen.',
    'This file type is not allowed here' => 'Dieser Dateityp ist hier nicht erlaubt',
    'Upload not found' => 'Upload nicht gefunden',
    'Invalid upload' => 'Ungültiger Upload',
    'Uploads are switched off for this project' => 'Uploads sind für dieses Projekt ausgeschaltet',
    'The file is empty' => 'Die Datei ist leer',
    'The file is too large (max. {max} MB)' => 'Die Datei ist zu groß (max. {max} MB)',
    'Upload could not be saved (write permission on jobs/?)' => 'Upload konnte nicht gespeichert werden (Schreibrechte auf jobs/?)',
    'Upload out of order' => 'Upload in falscher Reihenfolge',
    'auto_commit_host_changes must be true or false' => 'auto_commit_host_changes muss ja/nein sein',
    'Parallel changes: 1 to 16' => 'Gleichzeitige Änderungen: 1 bis 16',
    'No new changes to adopt as baseline' => 'Keine neuen Änderungen zum Übernehmen vorhanden',
    'Cancellation could not be requested' => 'Abbruch konnte nicht angefordert werden',
    'The public variant cannot be deleted' => 'Die öffentliche Variante kann nicht gelöscht werden',
    'Delete the variants derived from it first' => 'Zuerst die davon abgeleiteten Varianten löschen',
    'A question is still running. Please wait or cancel it.' => 'Es läuft noch eine Frage. Bitte abwarten oder abbrechen.',
    'Chat could not be cleared' => 'Chat konnte nicht geleert werden',
    'Question required' => 'Frage erforderlich',
    'Question must be 1–10000 bytes' => 'Frage muss 1–10000 Bytes enthalten',
    'Name required' => 'Name erforderlich',
    'No valid ID can be made from this name' => 'Aus diesem Namen lässt sich keine gültige Kennung bilden',
    'The public variant has no parent variant' => 'Die öffentliche Variante hat keine übergeordnete Variante',
    'Invalid commit' => 'Ungültiger Commit',
    'Undo blocked' => 'Rücknahme gesperrt',
    'Instruction required' => 'Anweisung erforderlich',
    'Instruction must be 1–10000 bytes' => 'Anweisung muss 1–10000 Bytes enthalten',

    // ── Router (plain-text responses) ──
    'Bad request' => 'Ungültige Anfrage',
    'Not found' => 'Nicht gefunden',
    'SayAndShape: project not registered' => 'SayAndShape: Projekt nicht registriert',
    'SayAndShape: project folder not found' => 'SayAndShape: Projektordner nicht gefunden',

    // ── Login page ──
    'Login' => 'Anmeldung',
    'Request not allowed.' => 'Anfrage nicht erlaubt.',
    'You are logged in. The round helper button appears at the bottom right of the pages.' => 'Du bist angemeldet. Auf den Seiten erscheint unten rechts der runde Helfer-Button.',
    'Go to the site' => 'Zur Seite',
    'Setup' => 'Einrichtung',
    'Log out' => 'Abmelden',
    "Logged in through the app's admin area. You can log out there." => 'Angemeldet über die Verwaltung der App. Abmelden kannst du dich dort.',
    'No password has been set yet. Run this on the server: {command}' => 'Es ist noch kein Passwort gesetzt. Auf dem Server ausführen: {command}',
    'Once logged in, you can change the pages by text or voice. Visitors see none of this.' => 'Mit der Anmeldung lassen sich die Seiten per Text oder Sprache ändern. Besucher sehen davon nichts.',
    'Password' => 'Passwort',
    'Log in' => 'Anmelden',

    // ── Setup page ──
    'This page is only for SayAndShape administrators.' => 'Diese Seite ist nur für Administratoren von SayAndShape.',
    'Administrators only' => 'Nur für Administratoren',
    'Checking the service…' => 'Dienst wird geprüft…',
    'Configuration not writable' => 'Konfiguration nicht beschreibbar',
    'Settings' => 'Einstellungen',
    'Language' => 'Sprache',
    'AI agent' => 'KI-Agent',
    'for all projects' => 'für alle Projekte',
    'Model' => 'Modell',
    'Model ID, e.g. claude-opus-5-5' => 'Modell-Kennung, z. B. claude-opus-5-5',
    'Effort' => 'Denkaufwand',
    'Save' => 'Speichern',
    'Takes effect with the next job, no restart needed. Claude runs without fast mode.' => 'Gilt ab dem nächsten Auftrag, ohne Neustart. Claude läuft ohne Fast-Modus.',
    'Projects' => 'Projekte',
    'Add project' => 'Projekt hinzufügen',
    "Users don't see this page. They only get the panel in their app." => 'Nutzer sehen diese Seite nicht. Sie bekommen nur das Panel in ihrer App.',
    "On the first job, SayAndShape copies the web app into the public variant and sets up everything else itself. The app's folder stays unchanged." => 'SayAndShape kopiert die Web-App beim ersten Auftrag in die öffentliche Variante und legt alles Weitere selbst an. Der Ordner der App bleibt unverändert.',
    'e.g. Neighborhood blog' => 'z. B. Stadtteil-Blog',
    'ID' => 'Kennung',
    'generated automatically' => 'wird automatisch gebildet',
    'Web app folder on the server' => 'Ordner der Web-App auf dem Server',
    '/var/www/my-app' => '/var/www/meine-app',
    'Check' => 'Prüfen',
    'Absolute path. “Check” shows the size, files and large folders.' => 'Absoluter Pfad. „Prüfen“ zeigt Größe, Dateien und große Ordner.',
    'What may users change?' => 'Was dürfen Nutzer ändern?',
    'in your own words' => 'in eigenen Worten',
    'Look, layout, colors, animations, texts and content of the site. No changes to login, server or configuration.' => 'Aussehen, Layout, Farben, Animationen, Texte und Inhalte der Seite. Keine Änderungen an Login, Server oder Konfiguration.',
    'This becomes the rule every request is checked against before anything is changed.' => 'Daraus entsteht die Prüfregel, die jede Anfrage vor dem Ändern bewertet.',
    'Protected files' => 'Geschützte Dateien',
    'Type a file, press Enter' => 'Datei eingeben, Enter',
    'Never changed, not even on request. Patterns like {example} are allowed.' => 'Werden nie verändert, auch nicht auf Wunsch. Muster wie {example} sind erlaubt.',
    'Shared folders' => 'Geteilte Ordner',
    'images, uploads, content' => 'Bilder, Uploads, Inhalte',
    'Type a folder, press Enter' => 'Ordner eingeben, Enter',
    'Not copied per variant; served from the app folder instead.' => 'Werden nicht pro Variante kopiert, sondern aus dem App-Ordner ausgeliefert.',
    'Parallel changes' => 'Gleichzeitige Änderungen',
    'Every running change uses AI budget.' => 'Jede laufende Änderung kostet KI-Budget.',
    'App URL' => 'Adresse der App',
    'optional, for links' => 'optional, für Links',
    'https://example.org/my-app/' => 'https://example.org/meine-app/',
    'Advanced' => 'Erweitert',
    'Public variant' => 'Öffentliche Variante',
    'Files per change' => 'Dateien pro Änderung',
    'Uploads per request' => 'Uploads pro Anfrage',
    '0 switches uploads off' => '0 schaltet Uploads aus',
    'Largest upload (MB)' => 'Größter Upload (MB)',
    'Upload file types' => 'Dateitypen für Uploads',
    'file endings, separated by commas' => 'Dateiendungen, durch Komma getrennt',
    'Empty restores the standard list. Server code such as php is never accepted.' => 'Leer stellt die Standardliste wieder her. Server-Code wie php wird nie angenommen.',
    'Blocked terms' => 'Gesperrte Begriffe',
    'regex, applied before the AI check' => 'Regex, vor der KI-Prüfung',
    'Term, press Enter' => 'Begriff, Enter',
    "Automatically keep changes made in the app's admin area" => 'Änderungen der App-Verwaltung automatisch übernehmen',
    'Uploads and settings from the app are saved as a separate entry before each job.' => 'Uploads und Einstellungen aus der App werden vor jedem Auftrag als eigener Eintrag gesichert.',
    'Create project' => 'Projekt anlegen',
    'Cancel' => 'Abbrechen',
    'Remove project' => 'Projekt entfernen',
    "Takes a few seconds. The app's files are not deleted." => 'Dauert wenige Sekunden. Die Dateien der App werden nicht gelöscht.',
    'Connecting the app (one-time, technical)' => 'Einbindung in die App (einmalig, technisch)',
    'A project created here must be connected to the web server once, on the server. This command writes {router} (and, for Apache, the rewrite rules) into the project folder; after that the panel appears automatically:' => 'Ein hier angelegtes Projekt muss einmal auf dem Server mit dem Webserver verbunden werden. Dieser Befehl schreibt {router} (und bei Apache die Rewrite-Regeln) in den Projektordner; das Panel wird danach automatisch eingeblendet:',
    'Options such as {nginx} or {url}, and everything else: see INSTALL.md in the engine folder.' => 'Optionen wie {nginx} oder {url} und alles Weitere: INSTALL.md im Engine-Ordner.',
    // Setup page script
    'Request failed' => 'Anfrage fehlgeschlagen',
    'Remove {value}' => '{value} entfernen',
    'Edit project: {name}' => 'Projekt bearbeiten: {name}',
    'Folder not found.' => 'Ordner nicht gefunden.',
    '/path/to/project' => '/pfad/zum/projekt',
    'No projects set up yet.' => 'Noch kein Projekt eingerichtet.',
    '{n} variant' => '{n} Variante',
    '{n} variants' => '{n} Varianten',
    '{n} in progress' => '{n} in Arbeit',
    'nothing running' => 'nichts aktiv',
    'folder missing' => 'Ordner fehlt',
    'Edit' => 'Bearbeiten',
    'Open app' => 'App öffnen',
    'Service running' => 'Dienst läuft',
    'Service not running' => 'Dienst läuft nicht',
    'Checking…' => 'Wird geprüft…',
    'Folder found · {files} files · {mb} MB' => 'Ordner gefunden · {files} Dateien · {mb} MB',
    '{index} present' => '{index} vorhanden',
    'no index.php/index.html' => 'keine index.php/index.html',
    'contains .git' => 'enthält .git',
    'Saved.' => 'Gespeichert.',
    'Remove the project “{id}” from SayAndShape? The files of the app and its variants stay on the server.' => 'Projekt „{id}“ aus SayAndShape entfernen? Die Dateien der App und die Varianten bleiben auf dem Server.',
    'Project removed.' => 'Projekt entfernt.',
    'Low' => 'niedrig',
    'Medium' => 'mittel',
    'High' => 'hoch',
    'Very high' => 'sehr hoch',
    'Maximum' => 'maximal',
    'Other ID…' => 'Andere Kennung…',
    'Saved: {engine} · {model}' => 'Gespeichert: {engine} · {model}',
];

/** The configured interface language, 'en' or 'de'. Read once per request. */
function sayandshapeLanguage(): string {
    static $language = null;
    if ($language === null) {
        $config = json_decode((string) @file_get_contents(dirname(__DIR__) . '/config/apps.json'), true);
        $value = is_array($config) ? ($config['language'] ?? null) : null;
        $language = in_array($value, SAYANDSHAPE_LANGUAGES, true) ? $value : 'en';
    }
    return $language;
}

/** $text (English) in the interface language, with {name} placeholders filled from $vars. */
function sayandshapeT(string $text, array $vars = []): string {
    if (sayandshapeLanguage() === 'de') $text = SAYANDSHAPE_DE[$text] ?? $text;
    if (!$vars) return $text;
    $pairs = [];
    foreach ($vars as $name => $value) $pairs['{' . $name . '}'] = (string) $value;
    return strtr($text, $pairs);
}

/** sayandshapeT() for HTML: the text is escaped, then placeholders are filled with the markup in $html as given. */
function sayandshapeTHtml(string $text, array $html = []): string {
    $out = htmlspecialchars(sayandshapeT($text), ENT_QUOTES);
    if (!$html) return $out;
    $pairs = [];
    foreach ($html as $name => $markup) $pairs['{' . $name . '}'] = (string) $markup;
    return strtr($out, $pairs);
}
