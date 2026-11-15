import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../sidecars/dashboard/main.mjs';

test('standalone dashboard HTTP server serves CSP UI, metrics API, history, and persisted preferences', async () => {
  const appData = mkdtempSync(join(tmpdir(), 'agy-server-test-'));
  const convId = '33333333-4444-5555-6666-777777777777';
  const pluginData = join(appData, 'plugin_data', 'agy-context-monitor');

  const logsDir = join(appData, 'brain', convId, '.system_generated', 'logs');
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(
    join(logsDir, 'transcript.jsonl'),
    [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-15T10:00:00Z', content: '<USER_REQUEST>\nhello world\nsecond line\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>The user changed setting `Model Selection` from Gemini 4 Hydrogen (XHigh) to Orchestrator (Carbon).</USER_SETTINGS_CHANGE>' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-15T10:00:01Z', input_tokens: 15000, cache_read_tokens: 45000, output_tokens: 900, content: 'SECRET_MODEL_OUTPUT', tool_calls: [{ id: '1' }] },
      { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: '2026-11-15T10:00:07Z' },
    ].map((x) => JSON.stringify(x)).join('\n') + '\n',
    'utf8'
  );

  const started = await startServer({
    port: 0,
    env: {
      ANTIGRAVITY_APP_DATA_DIR: appData,
      PLUGIN_DATA: pluginData,
      ANTIGRAVITY_CONVERSATION_ID: convId,
    },
  });

  const baseUrl = `http://127.0.0.1:${started.port}`;

  try {
    // HTML page + strict CSP
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers.get('content-security-policy') || '', /script-src 'self'/);
    assert.equal(htmlRes.headers.get('x-content-type-options'), 'nosniff');
    const html = await htmlRes.text();
    assert.equal(html.includes('<script src="/preload.js"></script>'), true);

    // Static assets & content types
    const cssRes = await fetch(`${baseUrl}/styles.css`);
    assert.equal(cssRes.status, 200);
    assert.match(cssRes.headers.get('content-type') || '', /text\/css/);

    const jsRes = await fetch(`${baseUrl}/app.js`);
    assert.equal(jsRes.status, 200);
    assert.match(jsRes.headers.get('content-type') || '', /javascript/);

    const preloadRes = await fetch(`${baseUrl}/preload.js`);
    assert.equal(preloadRes.status, 200);

    // Path traversal rejection
    const badRes = await fetch(`${baseUrl}/api/metrics?conversationId=../../etc/passwd`);
    assert.equal(badRes.status, 400);

    // Metrics accuracy & privacy check
    const metricsRes = await fetch(`${baseUrl}/api/metrics?conversationId=${convId}`);
    assert.equal(metricsRes.status, 200);
    const metrics = await metricsRes.json();
    assert.equal(JSON.stringify(metrics).includes('SECRET_MODEL_OUTPUT'), false);
    assert.equal(metrics.model.name, 'Orchestrator (Carbon)');
    assert.equal(metrics.model.capacityTokens, 262_144);
    assert.equal(metrics.model.providerCapacityLabel, '1M');
    assert.equal(metrics.context.usedTokens, 60900);
    assert.equal(metrics.context.promptTokens, 60000);
    assert.equal(metrics.context.outputTokensLastStep, 900);
    assert.equal(metrics.context.cacheHitRate, 75);
    assert.equal(metrics.tps.latestTps, 150);

    // Conversations & history endpoints
    const convs = await (await fetch(`${baseUrl}/api/conversations`)).json();
    assert.equal(convs.conversations.length, 1);
    assert.equal(convs.conversations[0].conversationId, convId);

    const history = await (await fetch(`${baseUrl}/api/history`)).json();
    assert.equal(history.daily.length, 30);
    assert.equal(history.byModel.length, 1);

    // Conversation picker gets a display-only title + kind
    assert.equal(convs.conversations[0].kind, 'user');
    assert.equal(convs.conversations[0].title, 'hello world');
    assert.equal(history.conversations, undefined);

    // Per-model window override only affects that model family
    const prefRes = await fetch(`${baseUrl}/api/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capacityOverride: { modelKey: metrics.model.key, preset: '200k' }, locale: 'en' }),
    });
    assert.equal(prefRes.status, 200);
    const updatedPref = await prefRes.json();
    assert.deepEqual(updatedPref, { locale: 'en', capacityOverrides: { 'gemini-4-carbon': '200k' } });

    const metricsAfter = await (await fetch(`${baseUrl}/api/metrics?conversationId=${convId}`)).json();
    assert.equal(metricsAfter.context.totalTokens, 200_000);
    assert.equal(metricsAfter.context.usedPercent, 30.45);
    assert.equal(metricsAfter.model.capacitySource, 'preset');
    assert.equal(metricsAfter.model.overridden, true);

    // Invalid override payloads are ignored; 'auto' removes the override
    await fetch(`${baseUrl}/api/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capacityOverride: { modelKey: '../evil', preset: '1m' } }),
    });
    const resetRes = await fetch(`${baseUrl}/api/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capacityOverride: { modelKey: 'gemini-4-carbon', preset: 'auto' } }),
    });
    assert.deepEqual(await resetRes.json(), { locale: 'en', capacityOverrides: {} });
    const metricsReset = await (await fetch(`${baseUrl}/api/metrics?conversationId=${convId}`)).json();
    assert.equal(metricsReset.context.totalTokens, 262_144);
  } finally {
    await new Promise((resolvePromise) => started.server.close(resolvePromise));
    rmSync(appData, { recursive: true, force: true });
  }
});

test('auto-follow tracks newest active conversation and infers recent model when unswitched', async () => {
  const appData = mkdtempSync(join(tmpdir(), 'agy-autofollow-test-'));
  const oldConv = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const newConv = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const pluginData = join(appData, 'plugin_data', 'agy-context-monitor');

  mkdirSync(join(appData, 'brain', oldConv, '.system_generated', 'logs'), { recursive: true });
  mkdirSync(join(appData, 'brain', newConv, '.system_generated', 'logs'), { recursive: true });

  writeFileSync(
    join(appData, 'brain', oldConv, '.system_generated', 'logs', 'transcript.jsonl'),
    [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-15T10:00:00Z', content: 'The user changed setting `Model Selection` from Gemini 4 Hydrogen (XHigh) to Gemini 4 Argon (High).' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-15T10:01:00Z', input_tokens: 10000, cache_read_tokens: 0, output_tokens: 500, tool_calls: [] },
    ].map((x) => JSON.stringify(x)).join('\n') + '\n',
    'utf8'
  );

  // Newer session never switched Model Selection inline -> inherits latest global switch ("Gemini 4 Argon (High)")
  writeFileSync(
    join(appData, 'brain', newConv, '.system_generated', 'logs', 'transcript.jsonl'),
    [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-15T11:00:00Z', content: 'hello' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-15T11:00:05Z', input_tokens: 8000, cache_read_tokens: 2000, output_tokens: 300, tool_calls: [] },
    ].map((x) => JSON.stringify(x)).join('\n') + '\n',
    'utf8'
  );

  const started = await startServer({
    port: 0,
    env: {
      ANTIGRAVITY_APP_DATA_DIR: appData,
      PLUGIN_DATA: pluginData,
    },
  });

  try {
    const res = await fetch(`http://127.0.0.1:${started.port}/api/metrics`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.conversationId, newConv);
    assert.equal(body.model.name, 'Gemini 4 Argon (High)');
    assert.equal(body.model.inferredFromRecent, true);
    assert.equal(body.model.capacityTokens, 131_072);
    assert.equal(body.context.usedTokens, 10300);
  } finally {
    await new Promise((resolvePromise) => started.server.close(resolvePromise));
    rmSync(appData, { recursive: true, force: true });
  }
});
