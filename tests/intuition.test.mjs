import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inferModelAtTime,
  isInternalWorkerModel,
  prettifyModelId,
} from '../sidecars/dashboard/lib/models.mjs';
import { computeConversationMetrics } from '../sidecars/dashboard/lib/metrics.mjs';
import {
  buildConversationTitle,
  clearTranscriptCaches,
  readConversationTranscript,
} from '../sidecars/dashboard/lib/transcript.mjs';
import { AGENT_MODEL_LABEL, computeUsageRollup } from '../sidecars/dashboard/lib/usage-rollup.mjs';

function writeJsonl(file, rows) {
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

const iso = (sec) => new Date(Date.parse('2026-11-15T10:00:00Z') + sec * 1000).toISOString();
const switchMsg = (from, to) => `<USER_REQUEST>\nhi\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from ${from} to ${to}.\n</USER_SETTINGS_CHANGE>`;

test('hook model ids are prettified and internal worker ids are ignored', () => {
  assert.equal(prettifyModelId('claude-opus-5-5-high'), 'Claude Opus 5.5 (High)');
  assert.equal(prettifyModelId('gemini-4-hydrogen-xhigh'), 'Gemini 4 Hydrogen (XHigh)');
  assert.equal(prettifyModelId('gemini-pro-orchestrator'), 'Orchestrator (Carbon)');
  assert.equal(prettifyModelId('Gemini 4 Argon (High)'), 'Gemini 4 Argon (High)');
  assert.equal(isInternalWorkerModel('gemini-flash-worker-agy'), true);
  assert.equal(isInternalWorkerModel('claude-opus-5-5-high'), false);

  // Worker hook ids never override the transcript model; user-facing ids from another family do.
  const steps = [
    { stepIndex: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', createdAtMs: Date.parse(iso(0)), inferredModel: 'Orchestrator (Carbon)' },
    { stepIndex: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', createdAtMs: Date.parse(iso(1)), inputTokens: 100, cacheReadTokens: 0, outputTokens: 10, toolCount: 0, inferredModel: 'Orchestrator (Carbon)' },
  ];
  const transitions = [{ stepIndex: 0, createdAtMs: Date.parse(iso(0)), fromModel: 'Gemini 4 Hydrogen (XHigh)', toModel: 'Orchestrator (Carbon)' }];
  const base = { conversationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', transcript: { exists: true, steps, transitions } };

  const withWorker = computeConversationMetrics({
    ...base,
    timings: { exists: true, windows: [{ steps: 1, startMs: Date.parse(iso(1)), stopMs: Date.parse(iso(3)), model: 'gemini-flash-worker-agy' }] },
  });
  assert.equal(withWorker.model.name, 'Orchestrator (Carbon)');
  assert.equal(withWorker.model.nameSource, 'transcript');

  const withClaude = computeConversationMetrics({
    ...base,
    timings: { exists: true, windows: [{ steps: 1, startMs: Date.parse(iso(1)), stopMs: Date.parse(iso(3)), model: 'claude-opus-5-5-high' }] },
  });
  assert.equal(withClaude.model.name, 'Claude Opus 5.5 (High)');
  assert.equal(withClaude.model.nameSource, 'hook');
});

test('manual /compact is reported separately and never calibrates the window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-manual-compact-'));
  try {
    const file = join(dir, 'transcript.jsonl');
    writeJsonl(file, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: iso(0), content: switchMsg('Gemini 4 Hydrogen (XHigh)', 'Orchestrator (Carbon)') },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: iso(1), input_tokens: 242829, cache_read_tokens: 0, output_tokens: 17142 },
      { step_index: 2, source: 'SYSTEM', type: 'CHECKPOINT', created_at: iso(2), input_tokens: 251636, output_tokens: 7080 },
      { step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: iso(3), input_tokens: 20000, cache_read_tokens: 200000, output_tokens: 1000 },
      { step_index: 4, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: iso(4), content: '<USER_REQUEST>\n/compact \n</USER_REQUEST>' },
      { step_index: 5, source: 'SYSTEM', type: 'CHECKPOINT', created_at: iso(5), input_tokens: 294081, output_tokens: 2813 },
    ]);
    clearTranscriptCaches();
    const parsed = readConversationTranscript(file);
    assert.deepEqual(parsed.checkpoints.map((c) => c.manual), [false, true]);
    // Manual trigger = real pre-compaction footprint, not the inflated summarizer prompt.
    assert.equal(parsed.checkpoints[1].triggerTokens, 221000);

    const metrics = computeConversationMetrics({
      conversationId: '44444444-5555-6666-7777-888888888888',
      transcript: parsed,
      timings: { exists: false, windows: [] },
    });
    assert.equal(metrics.compaction.count, 2);
    assert.equal(metrics.compaction.autoCount, 1);
    assert.equal(metrics.compaction.manualCount, 1);
    assert.equal(metrics.compaction.lastAutoTriggerTokens, 259971);
    assert.equal(metrics.compaction.observedCeilingTokens, 259971);
    assert.equal(metrics.model.capacityTokens, 262_144);
    assert.equal(metrics.context.justCompacted, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model switch with oversized context warns instead of expanding the new window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-switch-'));
  try {
    const file = join(dir, 'transcript.jsonl');
    writeJsonl(file, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: iso(0), content: switchMsg('Gemini 4 Hydrogen (XHigh)', 'Orchestrator (Carbon)') },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: iso(1), input_tokens: 30000, cache_read_tokens: 200000, output_tokens: 1000 },
      { step_index: 2, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: iso(60), content: switchMsg('Orchestrator (Carbon)', 'Gemini 4 Argon (High)') },
    ]);
    clearTranscriptCaches();
    const metrics = computeConversationMetrics({
      conversationId: '44444444-5555-6666-7777-888888888888',
      transcript: readConversationTranscript(file),
      timings: { exists: false, windows: [] },
    });
    assert.equal(metrics.model.name, 'Gemini 4 Argon (High)');
    assert.equal(metrics.model.capacityTokens, 131_072);
    assert.equal(metrics.model.capacitySource, 'effective-model');
    assert.equal(metrics.context.switchPending, true);
    assert.equal(metrics.context.overCapacity, true);
    assert.equal(metrics.context.usedPercent, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forecast estimates remaining model calls and user turns from recent growth', () => {
  const rows = [];
  let idx = 0;
  let ctx = 50_000;
  // 4 user turns, each with 3 planner calls adding 5K each (=15K per turn).
  for (let turn = 0; turn < 4; turn++) {
    rows.push({ step_index: idx++, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: iso(idx * 10), content: turn === 0 ? switchMsg('Gemini 4 Hydrogen (XHigh)', 'Gemini 4 Argon (High)') : '<USER_REQUEST>\nnext\n</USER_REQUEST>' });
    for (let k = 0; k < 3; k++) {
      ctx += 5_000;
      rows.push({ step_index: idx++, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: iso(idx * 10), input_tokens: 2_000, cache_read_tokens: ctx - 2_000 - 500, output_tokens: 500 });
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'agy-forecast-'));
  try {
    const file = join(dir, 'transcript.jsonl');
    writeJsonl(file, rows);
    clearTranscriptCaches();
    const metrics = computeConversationMetrics({
      conversationId: '44444444-5555-6666-7777-888888888888',
      transcript: readConversationTranscript(file),
      timings: { exists: false, windows: [] },
    });
    assert.equal(metrics.context.usedTokens, 110_000);
    assert.equal(metrics.context.remainingTokens, 131_072 - 110_000);
    assert.equal(metrics.forecast.avgGrowthPerStep, 5_000);
    assert.equal(metrics.forecast.avgGrowthPerTurn, 15_000);
    assert.equal(metrics.forecast.stepsRemaining, 4);
    assert.equal(metrics.forecast.turnsRemaining, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rollup separates subagents, infers unswitched user conversations, and never caches titles', () => {
  assert.equal(buildConversationTitle('<USER_REQUEST>\n\n  帮我看看 这个插件\n第二行\n</USER_REQUEST>'), '帮我看看 这个插件');
  assert.equal(buildConversationTitle(`<USER_REQUEST>${'x'.repeat(40)}</USER_REQUEST>`), `${'x'.repeat(28)}…`);
  assert.equal(inferModelAtTime([{ ts: 100, fromModel: 'A', toModel: 'B' }], 50), 'A');
  assert.equal(inferModelAtTime([{ ts: 100, fromModel: 'A', toModel: 'B' }], 150), 'B');

  const appData = mkdtempSync(join(tmpdir(), 'agy-rollup-kind-'));
  try {
    const mk = (id, rows) => {
      const logs = join(appData, 'brain', id, '.system_generated', 'logs');
      mkdirSync(logs, { recursive: true });
      writeJsonl(join(logs, 'transcript.jsonl'), rows);
    };
    const switched = '11111111-1111-4111-8111-111111111111';
    const unswitched = '22222222-2222-4222-8222-222222222222';
    const agent = '33333333-3333-4333-8333-333333333333';
    mk(switched, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: iso(0), content: switchMsg('Gemini 4 Hydrogen (XHigh)', 'Gemini 4 Argon (High)') },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: iso(1), input_tokens: 1000, cache_read_tokens: 0, output_tokens: 100 },
    ]);
    mk(unswitched, [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: iso(100), content: '<USER_REQUEST>\nSECRET_TITLE_MARKER question\n</USER_REQUEST>' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: iso(101), input_tokens: 2000, cache_read_tokens: 0, output_tokens: 200 },
    ]);
    mk(agent, [
      { step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', created_at: iso(200), content: `[Message] sender=${unswitched} content=do work` },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: iso(201), input_tokens: 3000, cache_read_tokens: 0, output_tokens: 300 },
    ]);

    const env = { ANTIGRAVITY_APP_DATA_DIR: appData, PLUGIN_DATA: join(appData, 'plugin_data', 'agy-context-monitor') };
    clearTranscriptCaches();
    const rollup = computeUsageRollup({ env, nowMs: Date.parse(iso(300)), withHeaders: true });
    const byId = Object.fromEntries(rollup.conversations.map((c) => [c.conversationId, c]));

    assert.equal(byId[unswitched].model, 'Gemini 4 Argon (High)');
    assert.equal(byId[unswitched].modelInferred, true);
    assert.equal(byId[unswitched].title, 'SECRET_TITLE_MARKER question');
    assert.equal(byId[agent].kind, 'agent');
    assert.equal(byId[agent].model, AGENT_MODEL_LABEL);
    assert.equal(byId[agent].rootConversationId, unswitched);

    const models = Object.fromEntries(rollup.byModel.map((m) => [m.model, m]));
    assert.equal(models['Gemini 4 Argon (High)'].steps, 2);
    assert.equal(models['Gemini 4 Argon (High)'].inferredSteps, 1);
    assert.equal(models[AGENT_MODEL_LABEL].steps, 1);
    assert.equal(models.Unknown, undefined);
    assert.equal(rollup.totals.todayFreshTokens, 6600);

    const cacheJson = readFileSync(join(env.PLUGIN_DATA, 'usage-cache.json'), 'utf8');
    assert.equal(cacheJson.includes('SECRET_TITLE_MARKER'), false);
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
});
