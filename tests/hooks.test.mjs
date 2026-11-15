import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');

function runHook(command, args, stdinPayload, env) {
  return spawnSync(command, args, {
    cwd: PLUGIN_ROOT,
    input: typeof stdinPayload === 'string' ? stdinPayload : JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('hooks record timing events via wrapper shell without storing raw user input', () => {
  const pluginData = mkdtempSync(join(tmpdir(), 'agy-hook-test-'));
  try {
    const convId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const secretUserInput = 'SENSITIVE_USER_MESSAGE_MUST_NEVER_BE_LOGGED';

    const preRes = runHook(
      './hooks/run-hook.sh',
      ['pre'],
      {
        conversationId: convId,
        hookEventName: 'PreInvocation',
        invocationNum: 1,
        initialNumSteps: 3,
        modelName: 'gemini-4-carbon',
        workspacePaths: ['/Users/secret_person/projects/my-cool-repo'],
        transcriptPath: '/Users/secret_person/.gemini/antigravity-cli/brain/aaaaaaaa-1111-2222-3333-444444444444/.system_generated/logs/transcript.jsonl',
        lastUserInput: secretUserInput,
      },
      { PLUGIN_DATA: pluginData }
    );
    assert.equal(preRes.status, 0);
    assert.deepEqual(JSON.parse(preRes.stdout), {});

    const postRes = runHook(
      './hooks/run-hook.sh',
      ['post'],
      {
        conversationId: convId,
        hookEventName: 'PostInvocation',
        invocationNum: 1,
        initialNumSteps: 3,
        modelName: 'auto',
      },
      { PLUGIN_DATA: pluginData }
    );
    assert.equal(postRes.status, 0);
    assert.deepEqual(JSON.parse(postRes.stdout), {});

    const stopRes = runHook(
      './hooks/run-hook.sh',
      ['stop'],
      {
        conversationId: convId,
        hookEventName: 'Stop',
        executionNum: 1,
        terminationReason: 'NO_TOOL_CALL',
        modelName: 'gemini-4-carbon',
      },
      { PLUGIN_DATA: pluginData }
    );
    assert.equal(stopRes.status, 0);
    assert.deepEqual(JSON.parse(stopRes.stdout), { decision: 'stop' });

    const timingPath = join(pluginData, 'timings', `${convId}.jsonl`);
    assert.equal(existsSync(timingPath), true);

    const raw = readFileSync(timingPath, 'utf8');
    assert.equal(raw.includes(secretUserInput), false);
    assert.equal(raw.includes('secret_person'), false);

    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.equal(lines[0].event, 'pre');
    assert.equal(lines[0].steps, 3);
    assert.equal(lines[0].model, 'gemini-4-carbon');
    assert.equal(lines[0].ws, 'my-cool-repo');
    assert.equal(lines[0].surface, 'cli');
    assert.equal(lines[1].event, 'post');
    assert.equal(lines[1].model, undefined); // "auto" omitted cleanly
    assert.equal(lines[2].event, 'stop');
    assert.equal(lines[2].reason, 'NO_TOOL_CALL');
  } finally {
    rmSync(pluginData, { recursive: true, force: true });
  }
});

test('SessionStart injects 0-token user_markdown pill for user sessions only and respects preferences', () => {
  const pluginData = mkdtempSync(join(tmpdir(), 'agy-hook-start-'));
  try {
    const convId = 'bbbbbbbb-1111-4111-8111-222222222222';
    const startRes = runHook(
      './hooks/run-hook.sh',
      ['start'],
      {
        conversationId: convId,
        hookEventName: 'SessionStart',
        workspacePaths: ['/Users/dev/agy-context-monitor'],
      },
      { PLUGIN_DATA: pluginData }
    );
    assert.equal(startRes.status, 0);
    const out = JSON.parse(startRes.stdout);
    assert.equal(Array.isArray(out.injectSteps), true);
    assert.equal(out.injectSteps[0].systemMessage.systemMessage, '');
    assert.match(out.injectSteps[0].systemMessage.metadata.user_markdown, /sidecar:\/\/agy-context-monitor\/dashboard\//);

    // Subagent sessions must NOT receive the SessionStart pill
    const subRes = runHook(
      './hooks/run-hook.sh',
      ['start'],
      {
        conversationId: 'cccccccc-1111-4111-8111-333333333333',
        hookEventName: 'SessionStart',
        lastUserInput: '[Message] sender=bbbbbbbb-1111-4111-8111-222222222222 content=research',
      },
      { PLUGIN_DATA: pluginData }
    );
    assert.deepEqual(JSON.parse(subRes.stdout), {});

    // Disabling sessionStartPill in preferences suppresses injection
    writeFileSync(
      join(pluginData, 'preferences.json'),
      JSON.stringify({ locale: 'en', sessionStartPill: false, inlineContextAlert: true, capacityOverrides: {} }),
      'utf8'
    );
    const disabledRes = runHook(
      './hooks/run-hook.sh',
      ['start'],
      {
        conversationId: 'dddddddd-1111-4111-8111-444444444444',
        hookEventName: 'SessionStart',
      },
      { PLUGIN_DATA: pluginData }
    );
    assert.deepEqual(JSON.parse(disabledRes.stdout), {});
  } finally {
    rmSync(pluginData, { recursive: true, force: true });
  }
});

test('PostInvocation emits 0-token >=85% context alert once per compaction cycle', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'agy-hook-alert-'));
  try {
    const pluginData = join(tempRoot, 'plugin_data');
    const convId = 'eeeeeeee-1111-4111-8111-555555555555';
    const logsDir = join(tempRoot, 'brain', convId, '.system_generated', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const transcriptPath = join(logsDir, 'transcript.jsonl');

    // Argon window = 131,072; 118,000 / 131,072 = 90.0% (>= 85%)
    const baseLines = [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-15T10:00:00Z', content: 'The user changed setting `Model Selection` from Gemini 4 Hydrogen (XHigh) to Gemini 4 Argon (High).' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-15T10:00:05Z', input_tokens: 18000, cache_read_tokens: 99000, output_tokens: 1000 },
    ];
    writeFileSync(transcriptPath, baseLines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

    const firstPost = runHook(
      './hooks/run-hook.sh',
      ['post'],
      { conversationId: convId, hookEventName: 'PostInvocation', transcriptPath },
      { PLUGIN_DATA: pluginData }
    );
    const firstOut = JSON.parse(firstPost.stdout);
    assert.equal(Array.isArray(firstOut.injectSteps), true);
    assert.equal(firstOut.injectSteps[0].systemMessage.systemMessage, '');
    assert.match(firstOut.injectSteps[0].systemMessage.metadata.user_markdown, /90\.0%/);

    // Second PostInvocation in the same compaction cycle (cycle 0) must NOT repeat the alert
    const secondPost = runHook(
      './hooks/run-hook.sh',
      ['post'],
      { conversationId: convId, hookEventName: 'PostInvocation', transcriptPath },
      { PLUGIN_DATA: pluginData }
    );
    assert.deepEqual(JSON.parse(secondPost.stdout), {});

    // After a CHECKPOINT compaction (cycle 1) and climbing back >= 85%, it alerts again once
    writeFileSync(
      transcriptPath,
      [
        ...baseLines,
        { step_index: 2, source: 'SYSTEM', type: 'CHECKPOINT', created_at: '2026-11-15T10:01:00Z', input_tokens: 120000, output_tokens: 5000 },
        { step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-15T10:02:00Z', input_tokens: 20000, cache_read_tokens: 96000, output_tokens: 1000 },
      ].map((l) => JSON.stringify(l)).join('\n') + '\n',
      'utf8'
    );

    const nextCyclePost = runHook(
      './hooks/run-hook.sh',
      ['post'],
      { conversationId: convId, hookEventName: 'PostInvocation', transcriptPath },
      { PLUGIN_DATA: pluginData }
    );
    const nextCycleOut = JSON.parse(nextCyclePost.stdout);
    assert.equal(Array.isArray(nextCycleOut.injectSteps), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('hooks reject invalid conversationId and malformed stdin gracefully without blocking', () => {
  const pluginData = mkdtempSync(join(tmpdir(), 'agy-hook-safe-'));
  try {
    const traversal = runHook(
      'node',
      ['./hooks/record-timing.mjs'],
      {
        conversationId: '../../evil',
        hookEventName: 'PreInvocation',
      },
      { PLUGIN_DATA: pluginData }
    );
    assert.equal(traversal.status, 0);
    assert.deepEqual(JSON.parse(traversal.stdout), {});
    assert.equal(existsSync(join(pluginData, 'timings')), false);

    const malformed = runHook(
      'node',
      ['./hooks/record-timing.mjs', 'stop'],
      '{not-json',
      { PLUGIN_DATA: pluginData }
    );
    assert.equal(malformed.status, 0);
    assert.deepEqual(JSON.parse(malformed.stdout), { decision: 'stop' });
  } finally {
    rmSync(pluginData, { recursive: true, force: true });
  }
});
