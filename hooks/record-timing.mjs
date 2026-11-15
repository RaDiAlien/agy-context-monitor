import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TIMING_FILE_BYTES = 2 * 1024 * 1024;
const KEEP_RECENT_LINES = 4000;

function readAllStdin() {
  return new Promise((resolvePromise) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolvePromise(''));
  });
}

function resolvePluginDataDir(env = process.env) {
  if (env.PLUGIN_DATA) {
    return resolve(env.PLUGIN_DATA);
  }
  const appData = env.ANTIGRAVITY_APP_DATA_DIR
    ? resolve(env.ANTIGRAVITY_APP_DATA_DIR)
    : join(homedir(), '.gemini', 'antigravity');
  return join(appData, 'plugin_data', 'agy-context-monitor');
}

function cleanModel(modelName) {
  if (typeof modelName !== 'string') return undefined;
  const trimmed = modelName.trim();
  if (!trimmed || trimmed.toLowerCase() === 'auto') return undefined;
  return trimmed;
}

function trimIfOversized(filePath) {
  try {
    const stats = statSync(filePath);
    if (stats.size <= MAX_TIMING_FILE_BYTES) return;
    const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const kept = lines.slice(-KEEP_RECENT_LINES).join('\n') + '\n';
    writeFileSync(filePath, kept, 'utf8');
  } catch {
    // Non-fatal: never interrupt agent lifecycle for log trimming.
  }
}

function buildRecord(payload, nowMs) {
  const hookEventName = String(payload?.hookEventName || '');
  const eventMap = {
    PreInvocation: 'pre',
    PostInvocation: 'post',
    Stop: 'stop',
  };
  const event = eventMap[hookEventName];
  if (!event) return null;

  const record = {
    ts: nowMs,
    event,
  };

  if (Number.isFinite(payload.invocationNum)) {
    record.inv = payload.invocationNum;
  }
  if (Number.isFinite(payload.initialNumSteps)) {
    record.steps = payload.initialNumSteps;
  }
  if (Number.isFinite(payload.executionNum)) {
    record.exec = payload.executionNum;
  }
  if (typeof payload.terminationReason === 'string' && payload.terminationReason) {
    record.reason = payload.terminationReason;
  }
  const model = cleanModel(payload.modelName);
  if (model) {
    record.model = model;
  }

  return record;
}

async function main() {
  let isStop = process.argv.includes('stop');
  try {
    const raw = await readAllStdin();
    if (!raw.trim()) return;

    const payload = JSON.parse(raw);
    isStop = payload?.hookEventName === 'Stop';

    const convId = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
    if (!GUID_RE.test(convId)) return;

    const record = buildRecord(payload, Date.now());
    if (!record) return;

    const timingsDir = join(resolvePluginDataDir(process.env), 'timings');
    mkdirSync(timingsDir, { recursive: true });
    const filePath = join(timingsDir, `${convId}.jsonl`);
    trimIfOversized(filePath);
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Fail-safe: hook failures must never block or disrupt agent execution.
  } finally {
    process.stdout.write(isStop ? '{"decision":"stop"}\n' : '{}\n');
  }
}

main();
