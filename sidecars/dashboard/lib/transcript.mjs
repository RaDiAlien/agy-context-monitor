import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { cleanModelName, extractModelTransition, prettifyModelId } from './models.mjs';
import { GUID_RE, sanitizeWorkspaceName } from './paths.mjs';

const MAX_CACHE_ENTRIES = 128;
const transcriptCache = new Map();
const timingsCache = new Map();

function setBoundedCache(cache, key, value) {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, value);
}

function parseTimestampMs(iso) {
  if (typeof iso !== 'string' || !iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

const USER_REQUEST_RE = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/;
const SENDER_RE = /\bsender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
const SUBAGENT_CONV_ID_RE = /"conversationId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;
const TITLE_MAX_CHARS = 28;
const HEADER_READ_BYTES = 64 * 1024;
const headerCache = new Map();
const VALID_SURFACES = new Set(['desktop', 'ide', 'cli']);

function unquoteToolArg(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^"+|"+$/g, '').trim();
  return trimmed || null;
}

function parseEmbeddedJsonObject(text) {
  if (typeof text !== 'string' || !text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Conversations started by the user begin with `USER_INPUT`; subagent / swarm / scheduled
 * conversations begin with a non-empty `SYSTEM_MESSAGE` from their parent.
 * Leading empty `SYSTEM_MESSAGE` steps (e.g. 0-token `SessionStart` `user_markdown` pills) are ignored.
 */
function classifyFirstStep(type, source, content) {
  if (type === 'USER_INPUT' || source === 'USER_EXPLICIT') return 'user';
  if (type === 'SYSTEM_MESSAGE' || source === 'SYSTEM') {
    if (typeof content !== 'string' || !content.trim()) {
      return null;
    }
    return 'agent';
  }
  return null;
}

function extractUserRequest(content) {
  if (typeof content !== 'string' || !content) return '';
  const match = USER_REQUEST_RE.exec(content);
  return match ? match[1] : content;
}

function isManualCompactRequest(content) {
  return /^\/compact\b/i.test(extractUserRequest(content).trim());
}

/**
 * Build a short, display-only title from the first user request (first non-empty line, truncated).
 */
export function buildConversationTitle(content) {
  const request = extractUserRequest(content);
  const firstLine = request
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  const chars = Array.from(firstLine);
  return chars.length > TITLE_MAX_CHARS ? `${chars.slice(0, TITLE_MAX_CHARS).join('')}…` : firstLine;
}

/**
 * Read only the head of a transcript to derive `{ kind, title, parentId }` for the conversation picker.
 * The title lives in process memory only; it is never written to the usage cache or any file.
 */
export function readConversationHeader(filePath) {
  const empty = { kind: 'user', title: null, parentId: null };
  if (!filePath || !existsSync(filePath)) return empty;

  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    return empty;
  }
  const cached = headerCache.get(filePath);
  if (cached && (cached.complete || cached.size === stats.size)) {
    return cached.header;
  }

  let text = '';
  let fd = null;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(HEADER_READ_BYTES, stats.size));
    const read = readSync(fd, buf, 0, buf.length, 0);
    text = buf.subarray(0, read).toString('utf8');
  } catch {
    return empty;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }

  const header = { kind: null, title: null, parentId: null };
  let complete = false;
  const lines = text.split('\n');
  // The last line may be cut mid-way when the file exceeds the head buffer.
  const parseable = stats.size > HEADER_READ_BYTES ? lines.slice(0, -1) : lines;
  for (const line of parseable) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const type = typeof obj?.type === 'string' ? obj.type : '';
    const source = typeof obj?.source === 'string' ? obj.source : '';
    if (header.kind === null) {
      header.kind = classifyFirstStep(type, source, obj?.content);
      if (header.kind === 'agent') {
        const sender = SENDER_RE.exec(typeof obj.content === 'string' ? obj.content : '');
        header.parentId = sender ? sender[1].toLowerCase() : null;
        complete = true;
        break;
      }
    }
    if (type === 'USER_INPUT' || source === 'USER_EXPLICIT') {
      header.title = buildConversationTitle(obj.content);
      if (header.title) {
        complete = true;
        break;
      }
    }
  }
  if (stats.size > HEADER_READ_BYTES) complete = true;
  header.kind = header.kind ?? 'user';

  setBoundedCache(headerCache, filePath, { size: stats.size, complete, header });
  return header;
}

/**
 * Parse `transcript.jsonl` into sanitized metadata steps without retaining raw prompt or thinking text.
 * Uses `{ mtimeMs, size }` caching to keep polling cheap.
 */
export function readConversationTranscript(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {
      exists: false,
      mtimeMs: 0,
      size: 0,
      kind: 'user',
      parentId: null,
      steps: [],
      transitions: [],
      checkpoints: [],
      spawnedAgents: [],
    };
  }

  const stats = statSync(filePath);
  const cached = transcriptCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.parsed;
  }

  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const steps = [];
  const transitions = [];
  const checkpoints = [];
  const spawnByChildId = new Map();
  const swarmRosterToId = new Map();
  let pendingToolCalls = [];
  let pendingGenericIdx = 0;
  let lastPlannerFootprint = 0;
  let pendingManualCompact = false;
  let turnIndex = 0;
  let kind = null;
  let parentId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;

    const stepIndex = Number.isFinite(obj.step_index) ? obj.step_index : steps.length;
    const type = typeof obj.type === 'string' ? obj.type : 'UNKNOWN';
    const source = typeof obj.source === 'string' ? obj.source : 'UNKNOWN';
    const status = typeof obj.status === 'string' ? obj.status : 'UNKNOWN';
    const createdAt = typeof obj.created_at === 'string' ? obj.created_at : '';
    const createdAtMs = parseTimestampMs(createdAt);
    const inputTokens = toInt(obj.input_tokens);
    const cacheReadTokens = toInt(obj.cache_read_tokens);
    const outputTokens = toInt(obj.output_tokens);
    const toolCount = Array.isArray(obj.tool_calls) ? obj.tool_calls.length : 0;

    if (kind === null) {
      kind = classifyFirstStep(type, source, obj.content);
      if (kind === 'agent') {
        const sender = SENDER_RE.exec(typeof obj.content === 'string' ? obj.content : '');
        parentId = sender ? sender[1].toLowerCase() : null;
      }
    }

    const isUserTurn = type === 'USER_INPUT' || source === 'USER_EXPLICIT';
    if (isUserTurn) {
      turnIndex++;
      pendingToolCalls = [];
      pendingGenericIdx = 0;
      // Only a boolean is derived; the request text itself is never retained.
      pendingManualCompact = isManualCompactRequest(obj.content);
    }

    let modelTransition = null;
    if (isUserTurn || type === 'SYSTEM_MESSAGE') {
      modelTransition = extractModelTransition(obj.content);
      if (modelTransition) {
        transitions.push({
          stepIndex,
          createdAtMs,
          fromModel: cleanModelName(modelTransition.fromModel),
          toModel: cleanModelName(modelTransition.toModel),
        });
      }
    }

    if (type === 'PLANNER_RESPONSE') {
      pendingManualCompact = false;
      pendingGenericIdx = 0;
      if (
        Array.isArray(obj.tool_calls) &&
        obj.tool_calls.some((tc) => tc?.name === 'invoke_subagent' || tc?.name === 'swarm')
      ) {
        pendingToolCalls = obj.tool_calls.map((tc) => ({
          name: typeof tc?.name === 'string' ? tc.name : '',
          modelArg: unquoteToolArg(tc?.args?.Model ?? tc?.args?.model ?? tc?.arguments?.Model ?? tc?.arguments?.model),
          stepIndex,
          createdAtMs,
        }));
      } else {
        pendingToolCalls = [];
      }
      const footprint = inputTokens + cacheReadTokens + outputTokens;
      if (footprint > 0) {
        lastPlannerFootprint = footprint;
      }
    } else if (type === 'GENERIC' && source === 'MODEL' && pendingGenericIdx < pendingToolCalls.length) {
      const tc = pendingToolCalls[pendingGenericIdx++];
      const content = typeof obj.content === 'string' ? obj.content : '';
      if (tc.name === 'invoke_subagent') {
        const idMatch = SUBAGENT_CONV_ID_RE.exec(content);
        if (idMatch) {
          const childId = idMatch[1].toLowerCase();
          spawnByChildId.set(childId, {
            childId,
            via: 'subagent',
            model: null,
            modelSpec: tc.modelArg || 'inherit',
            stepIndex: tc.stepIndex,
            ts: tc.createdAtMs || createdAtMs,
            parentStepModel: null,
          });
        }
      } else if (tc.name === 'swarm') {
        const jObj = parseEmbeddedJsonObject(content);
        if (jObj) {
          const recordWorker = (entry) => {
            const rawId = typeof entry?.conversation_id === 'string' ? entry.conversation_id.trim().toLowerCase() : '';
            if (!GUID_RE.test(rawId)) return;
            const resolvedModel = cleanModelName(entry.model_display_name) ?? prettifyModelId(entry.model);
            if (typeof entry.name === 'string' && entry.name.trim()) {
              swarmRosterToId.set(entry.name.trim(), rawId);
            }
            spawnByChildId.set(rawId, {
              childId: rawId,
              via: 'swarm',
              model: resolvedModel,
              modelSpec: tc.modelArg || null,
              stepIndex: tc.stepIndex,
              ts: tc.createdAtMs || createdAtMs,
              parentStepModel: null,
            });
          };
          recordWorker(jObj);
          for (const arr of [jObj.workers, jObj.added]) {
            if (Array.isArray(arr)) arr.forEach(recordWorker);
          }
          // Handle `swarm` `model` switches or `status` roster updates by worker name
          const updateRosterModel = (entry) => {
            if (!entry || typeof entry.name !== 'string') return;
            const targetId = swarmRosterToId.get(entry.name.trim());
            if (!targetId) return;
            const nextModel = cleanModelName(entry.model_display_name) ?? prettifyModelId(entry.model);
            const existing = spawnByChildId.get(targetId);
            if (existing && nextModel) {
              existing.model = nextModel;
            }
          };
          if (!jObj.conversation_id && jObj.name) {
            updateRosterModel(jObj);
          }
          if (Array.isArray(jObj.members)) {
            jObj.members.forEach(updateRosterModel);
          }
        }
      }
    } else if (type === 'CHECKPOINT') {
      const cpPrompt = inputTokens + cacheReadTokens;
      const manual = pendingManualCompact;
      // Auto compaction fires when the live context reaches the window ceiling, so the larger of the
      // summarizer prompt and the last planner footprint approximates that ceiling. A manual `/compact`
      // can happen at any size and its summarizer prompt carries extra instructions, so only the real
      // pre-compaction footprint is meaningful (and it never calibrates the window).
      const triggerTokens = manual
        ? (lastPlannerFootprint || cpPrompt)
        : Math.max(cpPrompt, lastPlannerFootprint);
      checkpoints.push({
        stepIndex,
        createdAt,
        createdAtMs,
        triggerTokens,
        summaryTokens: outputTokens,
        manual,
        model: null,
      });
      lastPlannerFootprint = 0;
      pendingManualCompact = false;
    }

    steps.push({
      stepIndex,
      source,
      type,
      status,
      createdAt,
      createdAtMs,
      inputTokens,
      cacheReadTokens,
      outputTokens,
      toolCount,
      turnIndex,
      modelTransition,
    });
  }

  // Assign effective transcript-derived model per step (backfilling pre-switch `fromModel`).
  let activeModel = transitions[0]?.fromModel ?? null;
  let tIdx = 0;
  const stepModelByIdx = new Map();
  for (const step of steps) {
    while (tIdx < transitions.length && transitions[tIdx].stepIndex <= step.stepIndex) {
      activeModel = transitions[tIdx].toModel ?? activeModel;
      tIdx++;
    }
    step.inferredModel = activeModel;
    stepModelByIdx.set(step.stepIndex, activeModel);
  }

  for (const cp of checkpoints) {
    cp.model = stepModelByIdx.get(cp.stepIndex) ?? activeModel;
  }

  const spawnedAgents = [...spawnByChildId.values()].map(({ stepIndex: spIdx, ...sp }) => ({
    ...sp,
    parentStepModel: stepModelByIdx.get(spIdx) ?? activeModel ?? null,
  }));

  const parsed = {
    exists: true,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    kind: kind ?? 'user',
    parentId,
    steps,
    transitions,
    checkpoints,
    spawnedAgents,
  };
  setBoundedCache(transcriptCache, filePath, { mtimeMs: stats.mtimeMs, size: stats.size, parsed });
  return parsed;
}

/**
 * Parse hook timing JSONL records and pair `PreInvocation` -> `PostInvocation` / `Stop` windows.
 * Also extracts sanitized workspace basename (`ws`), surface (`desktop` | `ide` | `cli`), and alert cycles.
 */
export function readHookTimings(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {
      exists: false,
      mtimeMs: 0,
      size: 0,
      workspace: null,
      surface: null,
      alertedCycles: [],
      events: [],
      windows: [],
    };
  }

  const stats = statSync(filePath);
  const cached = timingsCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.parsed;
  }

  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const events = [];
  let workspace = null;
  let surface = null;
  const alertedSet = new Set();

  for (const line of lines) {
    if (!line || !line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object' && Number.isFinite(obj.ts) && typeof obj.event === 'string') {
        const ws = sanitizeWorkspaceName(obj.ws);
        if (ws) workspace = ws;
        if (typeof obj.surface === 'string' && VALID_SURFACES.has(obj.surface)) {
          surface = obj.surface;
        }
        if (obj.event === 'alert' && Number.isFinite(obj.cycle)) {
          alertedSet.add(Math.trunc(obj.cycle));
        }
        events.push({
          ts: obj.ts,
          event: obj.event,
          inv: Number.isFinite(obj.inv) ? obj.inv : null,
          steps: Number.isFinite(obj.steps) ? obj.steps : null,
          exec: Number.isFinite(obj.exec) ? obj.exec : null,
          reason: typeof obj.reason === 'string' ? obj.reason : '',
          model: cleanModelName(obj.model),
          ws,
          surface: typeof obj.surface === 'string' && VALID_SURFACES.has(obj.surface) ? obj.surface : null,
        });
      }
    } catch {
      // Skip malformed partial lines safely.
    }
  }

  const windows = pairHookEvents(events);
  const parsed = {
    exists: true,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    workspace,
    surface,
    alertedCycles: [...alertedSet].sort((a, b) => a - b),
    events,
    windows,
  };
  setBoundedCache(timingsCache, filePath, { mtimeMs: stats.mtimeMs, size: stats.size, parsed });
  return parsed;
}

/**
 * Pair raw hook lifecycle events into invocation timing windows.
 */
export function pairHookEvents(events) {
  const windows = [];
  let pending = null;

  for (const ev of events) {
    if (ev.event === 'pre') {
      if (pending) {
        windows.push(pending);
      }
      pending = {
        steps: ev.steps,
        inv: ev.inv,
        startMs: ev.ts,
        postMs: null,
        stopMs: null,
        reason: '',
        model: ev.model,
      };
    } else if (ev.event === 'post') {
      if (pending) {
        pending.postMs = ev.ts;
        pending.model = ev.model ?? pending.model;
      }
    } else if (ev.event === 'stop') {
      if (pending) {
        pending.stopMs = ev.ts;
        pending.reason = ev.reason || pending.reason;
        pending.model = ev.model ?? pending.model;
        windows.push(pending);
        pending = null;
      }
    }
  }

  if (pending) {
    windows.push(pending);
  }
  return windows;
}

export function clearTranscriptCaches() {
  transcriptCache.clear();
  timingsCache.clear();
  headerCache.clear();
}
