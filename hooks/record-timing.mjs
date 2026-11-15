import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { computeConversationMetrics } from '../sidecars/dashboard/lib/metrics.mjs';
import {
  GUID_RE,
  resolveSurfaceFromPath,
  sanitizeWorkspaceName,
} from '../sidecars/dashboard/lib/paths.mjs';
import { readPreferences } from '../sidecars/dashboard/lib/preferences.mjs';
import {
  readConversationHeader,
  readConversationTranscript,
  readHookTimings,
} from '../sidecars/dashboard/lib/transcript.mjs';

const MAX_TIMING_FILE_BYTES = 2 * 1024 * 1024;
const KEEP_RECENT_LINES = 4000;
const ALERT_THRESHOLD_PERCENT = 85;
const SUBAGENT_INPUT_RE = /\[Message\][\s\S]*\bsender=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const SIDECAR_URL = 'sidecar://agy-context-monitor/dashboard/';

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

function formatCompactTokens(num) {
  if (!Number.isFinite(num) || num <= 0) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(1)}K`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return String(Math.round(num));
}

function zeroTokenMarkdownStep(markdown) {
  return {
    systemMessage: {
      systemMessage: '',
      metadata: {
        user_markdown: markdown,
      },
    },
  };
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
    SessionStart: 'start',
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

  const rawWs = (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) || payload.cwd || '';
  const ws = sanitizeWorkspaceName(rawWs);
  if (ws) {
    record.ws = ws;
  }

  if (typeof payload.transcriptPath === 'string' && payload.transcriptPath.trim()) {
    record.surface = resolveSurfaceFromPath(payload.transcriptPath);
  }

  return record;
}

function buildSessionStartPill(payload, prefs) {
  if (prefs.sessionStartPill === false) return null;
  if (typeof payload?.lastUserInput === 'string' && SUBAGENT_INPUT_RE.test(payload.lastUserInput)) {
    return null;
  }
  if (typeof payload?.transcriptPath === 'string' && payload.transcriptPath.trim() && existsSync(payload.transcriptPath)) {
    if (readConversationHeader(payload.transcriptPath).kind === 'agent') {
      return null;
    }
  }
  const isZh = prefs.locale !== 'en';
  const markdown = isZh
    ? `📊 [上下文与速率](${SIDECAR_URL})`
    : `📊 [Context & TPS](${SIDECAR_URL})`;
  return { injectSteps: [zeroTokenMarkdownStep(markdown)] };
}

function maybeBuildContextAlert(payload, convId, timingFilePath, prefs) {
  if (prefs.inlineContextAlert === false) return null;
  const transcriptPath = typeof payload?.transcriptPath === 'string' ? payload.transcriptPath.trim() : '';
  if (!transcriptPath || !existsSync(transcriptPath)) return null;

  const transcript = readConversationTranscript(transcriptPath);
  if (!transcript.exists || transcript.kind === 'agent') return null;

  const timings = readHookTimings(timingFilePath);
  const metrics = computeConversationMetrics({
    conversationId: convId,
    transcript,
    timings,
    capacityOverrides: prefs.capacityOverrides,
  });

  if (metrics.context.justCompacted || metrics.context.usedPercent < ALERT_THRESHOLD_PERCENT) {
    return null;
  }

  const cycle = metrics.compaction.count || 0;
  if (timings.alertedCycles.includes(cycle)) {
    return null;
  }

  appendFileSync(timingFilePath, `${JSON.stringify({ ts: Date.now(), event: 'alert', cycle })}\n`, 'utf8');

  const isZh = prefs.locale !== 'en';
  const pct = metrics.context.usedPercent.toFixed(1);
  const used = formatCompactTokens(metrics.context.usedTokens);
  const cap = formatCompactTokens(metrics.context.totalTokens);
  const stepsRem = metrics.forecast?.stepsRemaining;

  let markdown;
  if (isZh) {
    const remHint = Number.isFinite(stepsRem) ? `，预计约 ${stepsRem} 次调用后自动压缩` : '';
    markdown = `⚠️ 上下文窗口已用 **${pct}%**（${used} / ${cap}${remHint}）· 可适时 \`/compact\` · [上下文与速率](${SIDECAR_URL})`;
  } else {
    const remHint = Number.isFinite(stepsRem) ? `, ~${stepsRem} calls until auto-compaction` : '';
    markdown = `⚠️ Context window at **${pct}%** (${used} / ${cap}${remHint}) · consider \`/compact\` · [Context & TPS](${SIDECAR_URL})`;
  }

  return { injectSteps: [zeroTokenMarkdownStep(markdown)] };
}

async function main() {
  let isStop = process.argv.includes('stop');
  let outputObj = null;
  try {
    const raw = await readAllStdin();
    if (!raw.trim()) return;

    const payload = JSON.parse(raw);
    const hookEventName = String(payload?.hookEventName || '');
    isStop = hookEventName === 'Stop';

    const convId = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
    if (!GUID_RE.test(convId)) return;

    const record = buildRecord(payload, Date.now());
    if (!record) return;

    const pluginDataDir = resolvePluginDataDir(process.env);
    const timingsDir = join(pluginDataDir, 'timings');
    mkdirSync(timingsDir, { recursive: true });
    const filePath = join(timingsDir, `${convId}.jsonl`);
    trimIfOversized(filePath);
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');

    if (hookEventName === 'SessionStart') {
      const prefs = readPreferences({ ...process.env, PLUGIN_DATA: pluginDataDir });
      outputObj = buildSessionStartPill(payload, prefs);
    } else if (hookEventName === 'PostInvocation' || hookEventName === 'PreInvocation') {
      const prefs = readPreferences({ ...process.env, PLUGIN_DATA: pluginDataDir });
      outputObj = maybeBuildContextAlert(payload, convId, filePath, prefs);
    }
  } catch {
    // Fail-safe: hook failures must never block or disrupt agent execution.
  } finally {
    if (isStop) {
      process.stdout.write('{"decision":"stop"}\n');
    } else if (outputObj) {
      process.stdout.write(`${JSON.stringify(outputObj)}\n`);
    } else {
      process.stdout.write('{}\n');
    }
  }
}

main();
