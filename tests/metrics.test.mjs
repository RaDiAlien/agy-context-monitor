import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractModelTransition, resolveContextCapacity, snapObservedCompactionToWindow } from '../sidecars/dashboard/lib/models.mjs';
import { computeConversationMetrics } from '../sidecars/dashboard/lib/metrics.mjs';
import { clearTranscriptCaches, readConversationTranscript, readHookTimings } from '../sidecars/dashboard/lib/transcript.mjs';
import { computeUsageRollup, toUtc8DateKey } from '../sidecars/dashboard/lib/usage-rollup.mjs';

test('model transitions and capacity catalog resolve Antigravity and Claude windows', () => {
  const transition = extractModelTransition(
    '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from Gemini 4 Hydrogen (XHigh) to Orchestrator (Carbon).\n</USER_SETTINGS_CHANGE>'
  );
  assert.deepEqual(transition, {
    fromModel: 'Gemini 4 Hydrogen (XHigh)',
    toModel: 'Orchestrator (Carbon)',
  });

  const carbon = resolveContextCapacity('Orchestrator (Carbon)', 'auto');
  assert.equal(carbon.capacityTokens, 262_144);
  assert.equal(carbon.source, 'effective-model');
  assert.equal(carbon.providerCapacityTokens, 1_048_576);
  assert.equal(carbon.providerCapacityLabel, '1M');

  assert.equal(resolveContextCapacity('Gemini 4 Hydrogen (XHigh)', 'auto').capacityTokens, 262_144);
  assert.equal(resolveContextCapacity('Gemini 4 Argon (High)', 'auto').capacityTokens, 131_072);
  assert.equal(resolveContextCapacity('GPT-OSS 120B (Medium)', 'auto').capacityTokens, 131_072);

  const claude55 = resolveContextCapacity('Claude Sonnet 5.5 (Low)', 'auto');
  assert.equal(claude55.capacityTokens, 200_000);
  assert.equal(claude55.providerCapacityLabel, '1M');

  assert.equal(resolveContextCapacity('Claude Sonnet 4.5', 'auto').capacityTokens, 200_000);
  assert.equal(resolveContextCapacity('Claude Opus 4 [1M]', 'auto').capacityTokens, 1_000_000);
  assert.equal(resolveContextCapacity('Claude Sonnet 4.5', '128k').capacityTokens, 131_072);
  assert.equal(resolveContextCapacity('Claude Sonnet 4.5', '256k').capacityTokens, 262_144);
  assert.equal(resolveContextCapacity('Claude Sonnet 4.5', '512k').capacityTokens, 524_288);
  assert.equal(resolveContextCapacity('Unknown Custom Model', 'auto').source, 'default');
  assert.equal(resolveContextCapacity('Unknown Custom Model', 'auto').capacityTokens, 262_144);
  assert.equal(resolveContextCapacity('Unknown Custom Model', '200k').capacityTokens, 200_000);

  // CHECKPOINT compaction trigger snapping & dynamic promotion on growth
  assert.equal(snapObservedCompactionToWindow(259_971), 262_144);
  assert.equal(snapObservedCompactionToWindow(130_569), 131_072);
  const calibrated = resolveContextCapacity('Orchestrator (Carbon)', 'auto', {
    observedCompactionTokens: 259_971,
    currentUsedTokens: 120_000,
  });
  assert.equal(calibrated.capacityTokens, 262_144);
  assert.equal(calibrated.source, 'checkpoint-calibrated');

  const promoted = resolveContextCapacity('Orchestrator (Carbon)', 'auto', {
    observedCompactionTokens: 259_971,
    currentUsedTokens: 280_000,
  });
  assert.equal(promoted.capacityTokens, 524_288);
  assert.equal(promoted.source, 'observed-growth');
});

test('transcript & metrics compute context breakdown, multi-tool duration, and never count human idle time', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'agy-metrics-test-'));
  try {
    const convId = '11111111-2222-3333-4444-555555555555';
    const transcriptFile = join(tempRoot, 'transcript.jsonl');
    const timingsFile = join(tempRoot, 'timings.jsonl');
    const secretPrompt = 'TOP_SECRET_USER_PROMPT_SHOULD_NOT_LEAK';
    const secretThinking = 'TOP_SECRET_CHAIN_OF_THOUGHT';

    const lines = [
      // Step 0: user prompt
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-15T10:00:00Z', content: secretPrompt },
      // Step 1: planner emits 2 tools, last GENERIC step at +10s -> 1000 / 10 = 100.0 tok/s
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-15T10:00:01Z', input_tokens: 10000, cache_read_tokens: 0, output_tokens: 1000, thinking: secretThinking, tool_calls: [{ id: 't1' }, { id: 't2' }] },
      { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: '2026-11-15T10:00:04Z' },
      { step_index: 3, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: '2026-11-15T10:00:11Z' },
      // Step 4: model switch + no-tool response WITHOUT hook timing -> must NOT subtract step 5 (+2 hours human idle!)
      { step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-15T10:00:15Z', input_tokens: 4000, cache_read_tokens: 16000, output_tokens: 600, tool_calls: [] },
      { step_index: 5, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-15T12:00:15Z', content: 'The user changed setting `Model Selection` from Gemini 4 Hydrogen (XHigh) to Orchestrator (Carbon).' },
      // Step 6: no-tool response WITH hook timing (2.5s for 500 tokens = 200.0 tok/s)
      { step_index: 6, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-15T12:00:16Z', input_tokens: 5000, cache_read_tokens: 95000, output_tokens: 500, tool_calls: [] },
    ];
    writeFileSync(transcriptFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

    const hookEvents = [
      { ts: Date.parse('2026-11-15T12:00:16.000Z'), event: 'pre', inv: 1, steps: 6, model: 'auto' },
      { ts: Date.parse('2026-11-15T12:00:18.500Z'), event: 'stop', exec: 1, reason: 'NO_TOOL_CALL', model: 'auto' },
    ];
    writeFileSync(timingsFile, hookEvents.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

    clearTranscriptCaches();
    const transcript = readConversationTranscript(transcriptFile);
    const timings = readHookTimings(timingsFile);

    // Backfilled model for earlier steps + updated model for step 6
    assert.equal(transcript.steps[1].inferredModel, 'Gemini 4 Hydrogen (XHigh)');
    assert.equal(transcript.steps[6].inferredModel, 'Orchestrator (Carbon)');

    const metrics = computeConversationMetrics({
      conversationId: convId,
      transcript,
      timings,
      capacityPreset: 'auto',
    });

    const serialized = JSON.stringify(metrics);
    assert.equal(serialized.includes(secretPrompt), false);
    assert.equal(serialized.includes(secretThinking), false);

    assert.equal(metrics.model.name, 'Orchestrator (Carbon)');
    assert.equal(metrics.model.capacityTokens, 262_144);
    assert.equal(metrics.model.providerCapacityLabel, '1M');
    assert.equal(metrics.context.usedTokens, 100_500);
    assert.equal(metrics.context.promptTokens, 100_000);
    assert.equal(metrics.context.cachedTokens, 95_000);
    assert.equal(metrics.context.uncachedTokens, 5_000);
    assert.equal(metrics.context.outputTokensLastStep, 500);
    assert.equal(metrics.context.cacheHitRate, 95);
    assert.equal(metrics.hooksActive, true);

    assert.equal(metrics.steps.length, 3);
    // Step 1 uses last GENERIC child step (10s), yielding 100.0 tok/s
    assert.equal(metrics.steps[0].elapsedSec, 10);
    assert.equal(metrics.steps[0].tps, 100);
    assert.equal(metrics.steps[0].timingSource, 'transcript');

    // Step 4 has 0 tools and no matching hook -> must remain unmeasured (never 7200s!)
    assert.equal(metrics.steps[1].tpsEligible, false);
    assert.equal(metrics.steps[1].tpsExcludedReason, 'no-hook-timing');
    assert.equal(metrics.steps[1].elapsedSec, null);

    // Step 6 uses hook pre -> stop window (2.5s), yielding 200.0 tok/s
    assert.equal(metrics.steps[2].elapsedSec, 2.5);
    assert.equal(metrics.steps[2].tps, 200);
    assert.equal(metrics.steps[2].timingSource, 'hook');

    // Token-weighted TPS: (1000 + 500) / (10 + 2.5) = 120.0 tok/s
    assert.equal(metrics.tps.latestTps, 200);
    assert.equal(metrics.tps.sessionTps, 120);
    assert.equal(metrics.tps.measuredStepCount, 2);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('MAD outlier filter excludes <1.5s spikes when >=5 baseline steps exist', () => {
  const steps = [];
  const baseMs = Date.parse('2026-11-15T10:00:00Z');

  // 5 stable baseline steps: 500 tokens / 5s = 100 tok/s each
  for (let i = 0; i < 5; i++) {
    const startSec = i * 20;
    steps.push({
      stepIndex: i * 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      createdAt: new Date(baseMs + startSec * 1000).toISOString(),
      createdAtMs: baseMs + startSec * 1000,
      inputTokens: 1000,
      cacheReadTokens: 0,
      outputTokens: 500,
      toolCount: 1,
      inferredModel: 'Orchestrator (Carbon)',
    });
    steps.push({
      stepIndex: i * 2 + 1,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      createdAt: new Date(baseMs + (startSec + 5) * 1000).toISOString(),
      createdAtMs: baseMs + (startSec + 5) * 1000,
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      toolCount: 0,
    });
  }

  // Add a <1.5s anomalous spike: 1500 tokens in 1.0s = 1500 tok/s
  steps.push({
    stepIndex: 10,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    createdAt: new Date(baseMs + 200 * 1000).toISOString(),
    createdAtMs: baseMs + 200 * 1000,
    inputTokens: 1000,
    cacheReadTokens: 0,
    outputTokens: 1500,
    toolCount: 1,
    inferredModel: 'Orchestrator (Carbon)',
  });
  steps.push({
    stepIndex: 11,
    source: 'MODEL',
    type: 'GENERIC',
    status: 'DONE',
    createdAt: new Date(baseMs + 201 * 1000).toISOString(),
    createdAtMs: baseMs + 201 * 1000,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    toolCount: 0,
  });

  const metrics = computeConversationMetrics({
    conversationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    transcript: { exists: true, mtimeMs: baseMs, size: 100, steps, transitions: [] },
    timings: { exists: false, windows: [] },
  });

  assert.equal(metrics.steps[5].tpsEligible, false);
  assert.equal(metrics.steps[5].tpsExcludedReason, 'outlier');
  assert.equal(metrics.tps.sessionTps, 100);
  assert.equal(metrics.tps.measuredStepCount, 5);
});

test('usage rollup groups days in UTC+8 and caches summary cleanly without raw text', () => {
  assert.equal(toUtc8DateKey(Date.parse('2026-11-15T16:05:00Z')), '2026-11-16');

  const appData = mkdtempSync(join(tmpdir(), 'agy-rollup-test-'));
  try {
    const convId = '22222222-3333-4444-5555-666666666666';
    const logsDir = join(appData, 'brain', convId, '.system_generated', 'logs');
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(
      join(logsDir, 'transcript.jsonl'),
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-15T16:10:00Z',
        input_tokens: 1200,
        cache_read_tokens: 8800,
        output_tokens: 400,
        content: 'PRIVATE_CONTENT_MARKER',
      }) + '\n',
      'utf8'
    );

    const env = {
      ANTIGRAVITY_APP_DATA_DIR: appData,
      PLUGIN_DATA: join(appData, 'plugin_data', 'agy-context-monitor'),
    };
    const nowMs = Date.parse('2026-11-15T18:00:00Z'); // 2026-11-16 02:00 UTC+8
    const rollup = computeUsageRollup({ env, nowMs, persistCache: true });

    assert.equal(rollup.totals.conversations, 1);
    assert.equal(rollup.totals.todayTokens, 10400);
    assert.equal(rollup.totals.todayOutputTokens, 400);

    const cacheJson = readFileSync(join(env.PLUGIN_DATA, 'usage-cache.json'), 'utf8');
    assert.equal(cacheJson.includes('PRIVATE_CONTENT_MARKER'), false);
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
});

test('CHECKPOINT parsing calibrates effective ceiling and handles pre/post compaction state', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'agy-checkpoint-test-'));
  try {
    const convId = '44444444-5555-6666-7777-888888888888';
    const transcriptFile = join(tempRoot, 'transcript.jsonl');

    const lines = [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-15T10:00:00Z', content: 'The user changed setting `Model Selection` from Gemini 4 Hydrogen (XHigh) to Orchestrator (Carbon).' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-15T10:05:00Z', input_tokens: 242829, cache_read_tokens: 0, output_tokens: 17142, tool_calls: [{ id: 't1' }] },
      { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: '2026-11-15T10:05:20Z' },
      { step_index: 3, source: 'SYSTEM', type: 'CHECKPOINT', status: 'DONE', created_at: '2026-11-15T10:06:00Z', input_tokens: 251636, cache_read_tokens: 0, output_tokens: 7080 },
    ];
    writeFileSync(transcriptFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

    clearTranscriptCaches();
    const parsedBefore = readConversationTranscript(transcriptFile);
    assert.equal(parsedBefore.checkpoints.length, 1);
    assert.equal(parsedBefore.checkpoints[0].triggerTokens, 259971);
    assert.equal(parsedBefore.checkpoints[0].summaryTokens, 7080);

    // Immediately after compaction with no new planner step yet: show summary footprint
    const immediateMetrics = computeConversationMetrics({
      conversationId: convId,
      transcript: parsedBefore,
      timings: { exists: false, windows: [] },
    });
    assert.equal(immediateMetrics.compaction.count, 1);
    assert.equal(immediateMetrics.compaction.lastTriggerTokens, 259971);
    assert.equal(immediateMetrics.model.capacityTokens, 262_144);
    assert.equal(immediateMetrics.model.capacitySource, 'checkpoint-calibrated');
    assert.equal(immediateMetrics.context.usedTokens, 7080);

    // Next planner step starts fresh compacted context while preserving compaction history & calibration
    writeFileSync(
      transcriptFile,
      [
        ...lines,
        { step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-15T10:07:00Z', input_tokens: 19737, cache_read_tokens: 0, output_tokens: 1031, tool_calls: [] },
      ].map((l) => JSON.stringify(l)).join('\n') + '\n',
      'utf8'
    );
    clearTranscriptCaches();
    const afterMetrics = computeConversationMetrics({
      conversationId: convId,
      transcript: readConversationTranscript(transcriptFile),
      timings: { exists: false, windows: [] },
    });
    assert.equal(afterMetrics.compaction.count, 1);
    assert.equal(afterMetrics.context.usedTokens, 20768);
    assert.equal(afterMetrics.model.capacitySource, 'checkpoint-calibrated');
    assert.equal(afterMetrics.model.capacityTokens, 262_144);
    // Post-CHECKPOINT cache drop must NOT be flagged as an unexpected cache bust!
    assert.equal(afterMetrics.steps[afterMetrics.steps.length - 1].cacheBust, false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('cache bust detector flags TTL expiry and model-switch drops while estimating prompt cache USD savings', () => {
  const baseMs = Date.parse('2026-11-15T10:00:00Z');
  const steps = [
    {
      stepIndex: 1,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      status: 'DONE',
      createdAt: new Date(baseMs).toISOString(),
      createdAtMs: baseMs,
      inputTokens: 4_000,
      cacheReadTokens: 76_000,
      outputTokens: 800,
      toolCount: 0,
      inferredModel: 'Orchestrator (Carbon)',
    },
    // +10 minutes idle -> cacheRead drops to 0 and full 81K prompt is re-billed uncached -> ttl-expired
    {
      stepIndex: 2,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      status: 'DONE',
      createdAt: new Date(baseMs + 10 * 60 * 1000).toISOString(),
      createdAtMs: baseMs + 10 * 60 * 1000,
      inputTokens: 81_000,
      cacheReadTokens: 0,
      outputTokens: 900,
      toolCount: 0,
      inferredModel: 'Orchestrator (Carbon)',
    },
    // Warm again
    {
      stepIndex: 3,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      status: 'DONE',
      createdAt: new Date(baseMs + 11 * 60 * 1000).toISOString(),
      createdAtMs: baseMs + 11 * 60 * 1000,
      inputTokens: 2_000,
      cacheReadTokens: 82_000,
      outputTokens: 700,
      toolCount: 0,
      inferredModel: 'Orchestrator (Carbon)',
    },
    // Model switch to Claude -> cacheRead drops to 0 -> model-switch
    {
      stepIndex: 4,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      status: 'DONE',
      createdAt: new Date(baseMs + 12 * 60 * 1000).toISOString(),
      createdAtMs: baseMs + 12 * 60 * 1000,
      inputTokens: 85_000,
      cacheReadTokens: 0,
      outputTokens: 600,
      toolCount: 0,
      inferredModel: 'Claude Sonnet 5.5 (High)',
    },
  ];

  const metrics = computeConversationMetrics({
    conversationId: '99999999-8888-4777-8666-555555555555',
    transcript: { exists: true, steps, transitions: [], checkpoints: [] },
    timings: { exists: false, windows: [] },
  });

  assert.equal(metrics.sessionTotals.cacheBustCount, 2);
  assert.equal(metrics.steps[1].cacheBust, true);
  assert.equal(metrics.steps[1].cacheBustReason, 'ttl-expired');
  assert.equal(metrics.steps[2].cacheBust, false);
  assert.equal(metrics.steps[3].cacheBust, true);
  assert.equal(metrics.steps[3].cacheBustReason, 'model-switch');
  assert.equal(metrics.context.lastStepCacheBust, 'model-switch');
  assert.ok(metrics.sessionTotals.cost.estimatedCostUsd > 0);
  assert.ok(metrics.sessionTotals.cost.cacheSavedUsd > 0);
});
