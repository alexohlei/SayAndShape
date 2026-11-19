"""Interface language of the texts the worker writes for people: job messages, rollback lock reasons and
commit subjects. English text is the key; DE holds the German version. AI prompts stay English.

The language is the top-level "language" in config/apps.json ("en" or "de", anything else means "en"),
changed on the setup page. It is read again for every use, so a change applies from the next job on."""
import json
from pathlib import Path
import re

LANGUAGES = ('en', 'de')
# Name of each language inside an English AI prompt ("write the reasons in German").
NAMES = {'en': 'English', 'de': 'German'}
CONFIG = Path(__file__).resolve().parents[1] / 'config/apps.json'

DE = {
    # worker.py: job status, blocked and error messages
    'Git step failed: {step}': 'Git-Schritt fehlgeschlagen: {step}',
    'Could not create a working directory': 'Arbeitsverzeichnis konnte nicht angelegt werden',
    'Time limit of {timeout} seconds reached': 'Zeitlimit von {timeout} Sekunden erreicht',
    'Execution failed (exit {code})': 'Ausführung fehlgeschlagen (Exit {code})',
    'The variant has uncommitted changes; please review them first': 'Variante enthält ungesicherte Änderungen; bitte zuerst prüfen',
    'Incomplete variant; existing files are kept': 'Unvollständige Variante; bestehende Dateien bleiben erhalten',
    'Source app not found': 'Ausgangs-App nicht gefunden',
    'This variant no longer exists': 'Diese Variante existiert nicht mehr',
    'A variant with this name already exists': 'Eine Variante mit diesem Namen existiert bereits',
    'The source variant does not exist': 'Die Ausgangs-Variante existiert nicht',
    'The public variant cannot be deleted': 'Die öffentliche Variante kann nicht gelöscht werden',
    'Delete the variants forked from this one first': 'Zuerst die davon abgeleiteten Varianten löschen',
    'Variant not found': 'Variante nicht gefunden',
    'Invalid job': 'Ungültiger Auftrag',
    'Invalid job ID': 'Ungültige Job-ID',
    'Invalid user': 'Ungültiger Benutzer',
    'Invalid app': 'Ungültige App',
    'Invalid variant': 'Ungültige Variante',
    'Invalid action': 'Ungültige Aktion',
    'Invalid instruction': 'Ungültige Anweisung',
    'Invalid commit': 'Ungültiger Commit',
    'Invalid source variant': 'Ungültige Ausgangs-Variante',
    'Invalid name': 'Ungültiger Name',
    'Invalid author': 'Ungültiger Autor',
    'Job cancelled': 'Auftrag abgebrochen',
    'Prompt check failed': 'Prompt-Prüfung fehlgeschlagen',
    'No usable answer received; please ask again': 'Keine verwertbare Antwort erhalten; bitte erneut fragen',
    'The dependency check modified the working copy; changes discarded':
        'Die Abhängigkeitsprüfung hat die Arbeitskopie verändert; Änderungen verworfen',
    'The variant has changed. Please reload and set the baseline again.':
        'Der Stand hat sich geändert. Bitte neu laden und erneut übernehmen.',
    'The history has changed. Please reload and select the change again.':
        'Der Verlauf hat sich geändert. Bitte neu laden und erneut auswählen.',
    # Quotes the panel's button label in each language.
    'Baseline metadata can only be changed with "Set new baseline"':
        'Basis-Metadaten dürfen nur über „Als Basis festlegen“ geändert werden',
    'The variant was changed in the meantime; job not applied': 'Variante wurde zwischenzeitlich geändert; Auftrag nicht übernommen',
    'No new changes to merge': 'Keine neuen Änderungen zum Übernehmen vorhanden',
    'Cannot merge: "{subject}" conflicts with the target variant in {files}. Please adjust the variant or fork it again.':
        'Übernahme nicht möglich: „{subject}“ kollidiert mit der Ziel-Variante in {files}. '
        'Bitte die Variante anpassen oder neu abzweigen.',
    'The merge left an unclear state; discarded': 'Übernahme hinterließ einen unklaren Stand; verworfen',
    'Interrupted by a restart; changes discarded': 'Durch Neustart unterbrochen; Änderungen verworfen',
    'Processing ended unexpectedly': 'Verarbeitung unerwartet beendet',
    'Interrupted by a restart; please submit the job again': 'Durch Neustart unterbrochen; bitte erneut beauftragen',
    # worker.py: commit for files the host app wrote itself (subject and author name)
    'Changes made in the app admin': 'Änderungen über die Verwaltung der App',
    'App admin': 'App-Verwaltung',
    # rollback_policy.py: lock reasons in the history
    'Dependencies have not been reliably checked yet. Undo later changes first.':
        'Abhängigkeiten noch nicht sicher geprüft. Zuerst spätere Änderungen zurücknehmen.',
    'Later changes edit the same files. Undo those first.':
        'Spätere Änderungen bearbeiten dieselben Dateien. Diese zuerst zurücknehmen.',
    'This change is not part of the current visible history.': 'Änderung gehört nicht zum aktuellen sichtbaren Verlauf.',
    'The history could not be checked reliably.': 'Verlauf konnte nicht sicher geprüft werden.',
    # repo_state.py: errors and the log messages of the metadata ref refs/sayandshape/state
    'Baseline metadata not readable': 'Basis-Metadaten nicht lesbar',
    'Invalid baseline metadata': 'Ungültige Basis-Metadaten',
    'Invalid baseline': 'Ungültige Basis',
    'No new changes to set as the baseline': 'Keine neuen Änderungen zum Übernehmen vorhanden',
    'Baseline metadata already exists': 'Basis-Metadaten existieren bereits',
    'SayAndShape: new baseline {created_at}': 'SayAndShape: neue Basis {created_at}',
    'SayAndShape: fork': 'SayAndShape: Abzweigung',
    # registry.py
    'Invalid public variant': 'Ungültige öffentliche Variante',
    'Invalid variant registry': 'Ungültige Varianten-Registry',
    'Git state not readable': 'Git-Stand nicht lesbar',
    'Unknown app': 'Unbekannte App',
    'Unknown command': 'Unbekannter Befehl',
    'Variants not readable: {error}': 'Varianten nicht lesbar: {error}',
    # migrate_workspaces.py: display name of a migrated per-user clone
    'Variant of user {user}': 'Variante von Nutzer {user}',
}


class Message(str):
    """English text with its {placeholders} filled in that remembers template and values. Code that does not
    know the language raises it, and the text is translated where it is shown (see message())."""

    def __new__(cls, template, **values):
        text = super().__new__(cls, _fill(template, values))
        text.template, text.values = template, values
        return text


def _fill(text, values):
    # One pass, so a value that itself contains "{name}" stays as it is.
    return re.sub(r'\{(\w+)\}', lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), text)


def language(config=CONFIG):
    """'en' or 'de' from the parsed config or the config file; missing, unreadable or anything else means 'en'."""
    if not isinstance(config, dict):
        try:
            config = json.loads(Path(config).read_text())
        except (OSError, ValueError):
            return 'en'
    value = config.get('language') if isinstance(config, dict) else None
    return value if value in LANGUAGES else 'en'


def t(text, lang='en', **values):
    """`text` (English) in `lang`, then {name} placeholders filled from `values`. Unknown text stays English."""
    if isinstance(text, Message):
        text, values = text.template, {**text.values, **values}
    if lang == 'de':
        text = DE.get(text, text)
    return _fill(text, values) if values else text


def message(exc, lang='en'):
    """The text of an exception in `lang`."""
    return t(exc.args[0] if exc.args and isinstance(exc.args[0], Message) else str(exc), lang)
