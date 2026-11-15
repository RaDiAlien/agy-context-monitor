import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.equal(lines[0].event, 'pre');
    assert.equal(lines[0].steps, 3);
    assert.equal(lines[0].model, 'gemini-4-carbon');
    assert.equal(lines[1].event, 'post');
    assert.equal(lines[1].model, undefined); // "auto" omitted cleanly
    assert.equal(lines[2].event, 'stop');
    assert.equal(lines[2].reason, 'NO_TOOL_CALL');
  } finally {
    rmSync(pluginData, { recursive: true, force: true });
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
