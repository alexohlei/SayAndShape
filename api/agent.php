<?php
// Engine settings: GET returns them, POST saves them in config/apps.json → "agent" (AI agent for all projects)
// and "language" (interface language, see api/i18n.php).
// The worker reads the settings again for every job (orchestrator/worker.py, Worker.agent()).
// "agent.sandbox" is deliberately not changeable here: switching the agent sandbox off needs the command line
// (bin/sayandshape agent --sandbox off), not just the shared login. A stored value is kept as it is.
require_once __DIR__ . '/auth.php';
sayandshapeRequireEngineAdmin();
$configPath = sayandshapeEngineDir() . '/config/apps.json';

const SAYANDSHAPE_AGENT_DEFAULTS = ['engine' => 'claude', 'claude_model' => 'claude-opus-5-5', 'codex_model' => 'gpt-6.1-terra', 'effort' => 'medium'];
const SAYANDSHAPE_AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const SAYANDSHAPE_AGENT_MODEL_RE = '/^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/D';
const SAYANDSHAPE_AGENT_MODELS = [
    'claude' => [
        ['id' => 'claude-opus-5-5', 'label' => 'Claude Opus 5.5'],
        ['id' => 'claude-sonnet-5-5', 'label' => 'Claude Sonnet 5.5'],
        ['id' => 'claude-haiku-5-5', 'label' => 'Claude Haiku 5.5'],
        ['id' => 'claude-fable-5-2', 'label' => 'Claude Fable 5.2'],
    ],
    'codex' => [
        ['id' => 'gpt-6.1-terra', 'label' => 'GPT-6.1 Terra'],
        ['id' => 'gpt-6.1-sol', 'label' => 'GPT-6.1 Sol'],
        ['id' => 'gpt-6-astra', 'label' => 'GPT-6 Astra'],
        ['id' => 'gpt-6-sol', 'label' => 'GPT-6 Sol'],
        ['id' => 'gpt-6-luna', 'label' => 'GPT-6 Luna'],
    ],
];

function sayandshapeAgentSettings(array $config): array {
    $out = SAYANDSHAPE_AGENT_DEFAULTS;
    $saved = is_array($config['agent'] ?? null) ? $config['agent'] : [];
    foreach (SAYANDSHAPE_AGENT_DEFAULTS as $key => $default) {
        $value = $saved[$key] ?? null;
        if (!is_string($value)) continue;
        if ($key === 'engine' && !in_array($value, ['claude', 'codex'], true)) continue;
        if ($key === 'effort' && !in_array($value, SAYANDSHAPE_AGENT_EFFORTS, true)) continue;
        if (str_ends_with($key, '_model') && !preg_match(SAYANDSHAPE_AGENT_MODEL_RE, $value)) continue;
        $out[$key] = $value;
    }
    return $out;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $config = sayandshapeLoadAppsConfig();
    sayandshapeJsonResponse(['success' => true, 'agent' => sayandshapeAgentSettings($config), 'language' => sayandshapeLanguage(),
        'models' => SAYANDSHAPE_AGENT_MODELS, 'efforts' => SAYANDSHAPE_AGENT_EFFORTS,
        'config_writable' => is_writable($configPath) && is_writable(dirname($configPath))]);
    exit;
}

$body = sayandshapeBody();
$config = sayandshapeLoadAppsConfig();
$agent = sayandshapeAgentSettings($config);
$language = sayandshapeLanguage();
if (array_key_exists('language', $body)) {
    if (!in_array($body['language'], SAYANDSHAPE_LANGUAGES, true)) sayandshapeFail('Language: only en or de');
    $language = $body['language'];
}
if (array_key_exists('engine', $body)) {
    if (!in_array($body['engine'], ['claude', 'codex'], true)) sayandshapeFail('AI agent: only claude or codex');
    $agent['engine'] = $body['engine'];
}
foreach (['claude_model', 'codex_model'] as $key) {
    if (!array_key_exists($key, $body)) continue;
    $value = is_string($body[$key]) ? trim($body[$key]) : '';
    if (!preg_match(SAYANDSHAPE_AGENT_MODEL_RE, $value)) sayandshapeFail('Model: invalid ID');
    $agent[$key] = $value;
}
if (array_key_exists('effort', $body)) {
    if (!in_array($body['effort'], SAYANDSHAPE_AGENT_EFFORTS, true)) sayandshapeFail('Effort: invalid value');
    $agent['effort'] = $body['effort'];
}
$config['agent'] = $agent + (is_array($config['agent'] ?? null) ? $config['agent'] : []);
$config['language'] = $language;
try { sayandshapeAtomicJson($configPath, $config, true); } catch (Throwable $e) { sayandshapeFail('Configuration could not be saved (write permission on config/?)', 503); }
sayandshapeJsonResponse(['success' => true, 'agent' => $agent, 'language' => $language]);
