import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanModelName, inferModelAtTime, resolveModelKey } from './models.mjs';
import { isValidConversationId, resolveBrainDir, resolveTranscriptPath, resolveUsageCachePath } from './paths.mjs';
import { readConversationHeader, readConversationTranscript } from './transcript.mjs';

const CACHE_VERSION = 3;
export const AGENT_MODEL_LABEL = '__agents__';
export const UNKNOWN_MODEL_LABEL = 'Unknown';
const UTC8_OFFSET_MS = 8 * 3600 * 1000;
const DAYS_WINDOW = 30;

/**
 * Format epoch ms into UTC+8 `YYYY-MM-DD` date key deterministically regardless of host timezone.
 */
export function toUtc8DateKey(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms + UTC8_OFFSET_MS).toISOString().slice(0, 10);
}

function createEmptyBucket() {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    steps: 0,
  };
}

/**
 * Resolve the display model for an unswitched conversation: subagent / swarm conversations are grouped
 * separately (their model is not recorded), user conversations inherit the global selection at start.
 */
function resolveConversationModel(summary, timeline) {
  if (summary.model && summary.model !== UNKNOWN_MODEL_LABEL) {
    return { model: summary.model, inferred: false };
  }
  if (summary.kind === 'agent') {
    return { model: AGENT_MODEL_LABEL, inferred: false };
  }
  const inferred = inferModelAtTime(timeline, summary.firstStepMs || summary.updatedAtMs);
  return inferred
    ? { model: inferred, inferred: true }
    : { model: UNKNOWN_MODEL_LABEL, inferred: false };
}

function summarizeTranscriptForCache(parsed) {
  const dailyBuckets = Object.create(null);
  const modelBuckets = Object.create(null);
  let latestContextUsed = 0;
  let lastModel = null;
  let updatedAtMs = parsed.mtimeMs || 0;
  let totalInput = 0;
  let totalCacheRead = 0;
  let totalOutput = 0;
  let stepCount = 0;
  let firstStepMs = 0;

  for (const step of parsed.steps) {
    if (step.createdAtMs > updatedAtMs) {
      updatedAtMs = step.createdAtMs;
    }
    if (step.createdAtMs > 0 && (firstStepMs === 0 || step.createdAtMs < firstStepMs)) {
      firstStepMs = step.createdAtMs;
    }
    if (step.type === 'CHECKPOINT') {
      if (step.outputTokens > 0) {
        latestContextUsed = step.outputTokens;
      }
      continue;
    }
    if (step.type !== 'PLANNER_RESPONSE') continue;

    const stepFootprint = step.inputTokens + step.cacheReadTokens + step.outputTokens;
    if (stepFootprint > 0) {
      latestContextUsed = stepFootprint;
    }

    const modelLabel = cleanModelName(step.inferredModel) ?? 'Unknown';
    if (modelLabel !== 'Unknown') {
      lastModel = modelLabel;
    }

    totalInput += step.inputTokens;
    totalCacheRead += step.cacheReadTokens;
    totalOutput += step.outputTokens;
    stepCount++;

    const dateKey = toUtc8DateKey(step.createdAtMs || parsed.mtimeMs);
    if (dateKey) {
      const day = dailyBuckets[dateKey] ?? (dailyBuckets[dateKey] = createEmptyBucket());
      day.inputTokens += step.inputTokens;
      day.cacheReadTokens += step.cacheReadTokens;
      day.outputTokens += step.outputTokens;
      day.steps += 1;
    }

    const mod = modelBuckets[modelLabel] ?? (modelBuckets[modelLabel] = createEmptyBucket());
    mod.inputTokens += step.inputTokens;
    mod.cacheReadTokens += step.cacheReadTokens;
    mod.outputTokens += step.outputTokens;
    mod.steps += 1;
  }

  const checkpointPeaksByModel = Object.create(null);
  let autoCompactions = 0;
  let manualCompactions = 0;
  for (const cp of parsed.checkpoints ?? []) {
    if (cp.manual) {
      manualCompactions++;
      continue; // A manual `/compact` says nothing about the window ceiling.
    }
    autoCompactions++;
    if (cp.triggerTokens >= 64_000) {
      const key = resolveModelKey(cp.model);
      checkpointPeaksByModel[key] = Math.max(checkpointPeaksByModel[key] || 0, cp.triggerTokens);
    }
  }

  // Model names only (no conversation text) so the global selection timeline can be rebuilt from cache.
  const modelTimeline = (parsed.transitions ?? [])
    .filter((tr) => tr.toModel && tr.createdAtMs > 0)
    .map((tr) => ({ ts: tr.createdAtMs, fromModel: tr.fromModel ?? null, toModel: tr.toModel }));

  return {
    mtimeMs: parsed.mtimeMs,
    size: parsed.size,
    kind: parsed.kind === 'agent' ? 'agent' : 'user',
    firstStepMs,
    updatedAtMs,
    model: lastModel ?? UNKNOWN_MODEL_LABEL,
    latestContextUsed,
    inputTokens: totalInput,
    cacheReadTokens: totalCacheRead,
    outputTokens: totalOutput,
    stepCount,
    dailyBuckets,
    modelBuckets,
    checkpointPeaksByModel,
    autoCompactions,
    manualCompactions,
    modelTimeline,
  };
}

function loadUsageCache(cachePath) {
  try {
    if (!existsSync(cachePath)) return { version: CACHE_VERSION, files: {} };
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (parsed?.version === CACHE_VERSION && parsed.files && typeof parsed.files === 'object') {
      return parsed;
    }
  } catch {
    // Corrupt cache is safely rebuilt from transcripts.
  }
  return { version: CACHE_VERSION, files: {} };
}

function saveUsageCacheAtomic(cachePath, cacheObj) {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(cacheObj), 'utf8');
    renameSync(tmpPath, cachePath);
  } catch {
    // Non-fatal: cache write errors do not break API reads.
  }
}

function buildLastNDates(days, nowMs) {
  const result = [];
  const todayUtc8Ms = nowMs + UTC8_OFFSET_MS;
  const dayMs = 24 * 3600 * 1000;
  for (let offset = days - 1; offset >= 0; offset--) {
    result.push(new Date(todayUtc8Ms - offset * dayMs).toISOString().slice(0, 10));
  }
  return result;
}

/**
 * Compute incremental conversation list + UTC+8 30-day & per-model usage rollup across `<appData>/brain`.
 * `withHeaders` adds display-only conversation titles (read from transcript heads, kept in memory only).
 */
export function computeUsageRollup({
  env = process.env,
  nowMs = Date.now(),
  persistCache = true,
  withHeaders = false,
} = {}) {
  const brainDir = resolveBrainDir(env);
  const cachePath = resolveUsageCachePath(env);
  const cache = loadUsageCache(cachePath);
  let dirty = false;

  const activeIds = new Set();
  const transcriptPaths = new Map();

  if (existsSync(brainDir)) {
    const entries = readdirSync(brainDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidConversationId(entry.name)) continue;
      const convId = entry.name;
      const transcriptPath = resolveTranscriptPath(convId, env);
      if (!existsSync(transcriptPath)) continue;

      let stats;
      try {
        stats = statSync(transcriptPath);
      } catch {
        continue;
      }

      let summary = cache.files[convId];
      if (
        !summary ||
        summary.mtimeMs !== stats.mtimeMs ||
        summary.size !== stats.size
      ) {
        const parsed = readConversationTranscript(transcriptPath);
        if (!parsed.exists) continue;
        summary = summarizeTranscriptForCache(parsed);
        cache.files[convId] = summary;
        dirty = true;
      }
      activeIds.add(convId);
      transcriptPaths.set(convId, transcriptPath);
    }
  }

  for (const oldId of Object.keys(cache.files)) {
    if (!activeIds.has(oldId)) {
      delete cache.files[oldId];
      dirty = true;
    }
  }

  if (dirty && persistCache) {
    saveUsageCacheAtomic(cachePath, cache);
  }

  // Global `Model Selection` timeline across every conversation (model names only).
  const modelTimeline = [];
  for (const convId of activeIds) {
    for (const entry of cache.files[convId]?.modelTimeline || []) {
      if (entry && Number.isFinite(entry.ts) && entry.toModel) modelTimeline.push(entry);
    }
  }
  modelTimeline.sort((a, b) => a.ts - b.ts);

  const conversations = [];
  const dateWindow = buildLastNDates(DAYS_WINDOW, nowMs);
  const dateSet = new Set(dateWindow);
  const dailyMap = new Map(dateWindow.map((date) => [date, { date, ...createEmptyBucket(), totalTokens: 0, freshTokens: 0 }]));
  const modelMap = new Map();
  const learnedCompactionByModelKey = Object.create(null);
  const latestEntry = modelTimeline[modelTimeline.length - 1];
  const latestGlobalModel = latestEntry?.toModel ?? null;

  let grandInput = 0;
  let grandCacheRead = 0;
  let grandOutput = 0;
  let grandSteps = 0;

  for (const convId of activeIds) {
    const summary = cache.files[convId];
    if (!summary) continue;

    const resolved = resolveConversationModel(summary, modelTimeline);
    const promptTotal = summary.inputTokens + summary.cacheReadTokens;
    const conv = {
      conversationId: convId,
      kind: summary.kind === 'agent' ? 'agent' : 'user',
      updatedAtMs: summary.updatedAtMs,
      model: resolved.model,
      modelInferred: resolved.inferred,
      contextUsedTokens: summary.latestContextUsed,
      inputTokens: summary.inputTokens,
      cacheReadTokens: summary.cacheReadTokens,
      outputTokens: summary.outputTokens,
      freshTokens: summary.inputTokens + summary.outputTokens,
      totalTokens: promptTotal + summary.outputTokens,
      cacheHitRate: promptTotal > 0 ? Number(((summary.cacheReadTokens / promptTotal) * 100).toFixed(1)) : 0,
      stepCount: summary.stepCount,
      compactions: (summary.autoCompactions || 0) + (summary.manualCompactions || 0),
    };
    if (withHeaders) {
      const header = readConversationHeader(transcriptPaths.get(convId));
      conv.title = header.title;
      conv.parentId = header.parentId;
      if (header.kind === 'agent') conv.kind = 'agent';
    }
    conversations.push(conv);

    for (const [modelKey, peakTokens] of Object.entries(summary.checkpointPeaksByModel || {})) {
      if (modelKey === 'unknown' || !Number.isFinite(peakTokens) || peakTokens < 64_000) continue;
      learnedCompactionByModelKey[modelKey] = Math.max(learnedCompactionByModelKey[modelKey] || 0, peakTokens);
    }

    grandInput += summary.inputTokens;
    grandCacheRead += summary.cacheReadTokens;
    grandOutput += summary.outputTokens;
    grandSteps += summary.stepCount;

    for (const [dateKey, bucket] of Object.entries(summary.dailyBuckets || {})) {
      if (!dateSet.has(dateKey)) continue;
      const target = dailyMap.get(dateKey);
      target.inputTokens += bucket.inputTokens;
      target.cacheReadTokens += bucket.cacheReadTokens;
      target.outputTokens += bucket.outputTokens;
      target.steps += bucket.steps;
      target.totalTokens += bucket.inputTokens + bucket.cacheReadTokens + bucket.outputTokens;
      target.freshTokens += bucket.inputTokens + bucket.outputTokens;
    }

    for (const [rawModelName, bucket] of Object.entries(summary.modelBuckets || {})) {
      // Steps without any recorded model inherit the conversation-level resolution.
      const modelName = rawModelName === UNKNOWN_MODEL_LABEL ? resolved.model : rawModelName;
      const target = modelMap.get(modelName) ?? {
        model: modelName,
        ...createEmptyBucket(),
        totalTokens: 0,
        freshTokens: 0,
        cacheHitRate: 0,
        inferredSteps: 0,
      };
      target.inputTokens += bucket.inputTokens;
      target.cacheReadTokens += bucket.cacheReadTokens;
      target.outputTokens += bucket.outputTokens;
      target.steps += bucket.steps;
      target.totalTokens += bucket.inputTokens + bucket.cacheReadTokens + bucket.outputTokens;
      target.freshTokens += bucket.inputTokens + bucket.outputTokens;
      if (rawModelName === UNKNOWN_MODEL_LABEL && resolved.inferred) {
        target.inferredSteps += bucket.steps;
      }
      modelMap.set(modelName, target);
    }
  }

  conversations.sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  if (withHeaders) {
    // Walk subagent / swarm parent links up to the user conversation that spawned them.
    const byId = new Map(conversations.map((c) => [c.conversationId, c]));
    for (const conv of conversations) {
      if (conv.kind !== 'agent') continue;
      let cursor = conv;
      const seen = new Set([conv.conversationId]);
      for (let depth = 0; depth < 12 && cursor?.parentId; depth++) {
        if (seen.has(cursor.parentId)) break;
        seen.add(cursor.parentId);
        cursor = byId.get(cursor.parentId);
        if (cursor?.kind === 'user') {
          conv.rootConversationId = cursor.conversationId;
          conv.rootTitle = cursor.title ?? null;
          break;
        }
      }
    }
  }

  const daily = dateWindow.map((d) => dailyMap.get(d));
  const byModel = [...modelMap.values()]
    .map((m) => {
      const prompt = m.inputTokens + m.cacheReadTokens;
      return {
        ...m,
        cacheHitRate: prompt > 0 ? Number(((m.cacheReadTokens / prompt) * 100).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.freshTokens - a.freshTokens);

  const sumDays = (list, key) => list.reduce((acc, d) => acc + d[key], 0);
  const todayBucket = daily[daily.length - 1];
  const last7 = daily.slice(-7);
  const activeDays = daily.filter((d) => d.totalTokens > 0).length;

  return {
    timezone: 'UTC+8',
    conversations,
    daily,
    byModel,
    totals: {
      conversations: conversations.length,
      userConversations: conversations.filter((c) => c.kind === 'user').length,
      activeDays,
      inputTokens: grandInput,
      cacheReadTokens: grandCacheRead,
      outputTokens: grandOutput,
      freshTokens: grandInput + grandOutput,
      totalTokens: grandInput + grandCacheRead + grandOutput,
      steps: grandSteps,
      todayTokens: todayBucket?.totalTokens ?? 0,
      todayFreshTokens: todayBucket?.freshTokens ?? 0,
      todayCacheReadTokens: todayBucket?.cacheReadTokens ?? 0,
      todayOutputTokens: todayBucket?.outputTokens ?? 0,
      last7dTokens: sumDays(last7, 'totalTokens'),
      last7dFreshTokens: sumDays(last7, 'freshTokens'),
      last30dTokens: sumDays(daily, 'totalTokens'),
      last30dFreshTokens: sumDays(daily, 'freshTokens'),
    },
    calibration: {
      learnedCompactionByModelKey,
      latestGlobalModel,
      modelTimeline,
    },
  };
}
