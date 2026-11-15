import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  cleanModelName,
  estimateTokenCost,
  inferModelAtTime,
  isInternalWorkerModel,
  prettifyModelId,
  resolveModelKey,
  resolveSubagentModelAlias,
} from './models.mjs';
import {
  isValidConversationId,
  PLUGIN_ID,
  resolveAllAppDataRoots,
  resolveTimingsPath,
  resolveUsageCachePath,
} from './paths.mjs';
import { readConversationHeader, readConversationTranscript, readHookTimings } from './transcript.mjs';

const CACHE_VERSION = 5;
export const AGENT_MODEL_LABEL = '__agents__';
export const UNKNOWN_MODEL_LABEL = 'Unknown';
const UTC8_OFFSET_MS = 8 * 3600 * 1000;
const DAYS_WINDOW = 30;

function roundUsd(value) {
  return Number((Number(value) || 0).toFixed(4));
}

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
 * Resolve the display model for a user conversation:
 * 1. Explicit transcript `Model Selection` switches
 * 2. Hook timing `model` (excluding internal worker IDs)
 * 3. Global selection timeline at conversation start
 */
function resolveUserConversationModel(summary, timingMeta, timeline) {
  if (summary.model && summary.model !== UNKNOWN_MODEL_LABEL) {
    return { model: summary.model, inferred: false, source: 'transcript' };
  }
  if (timingMeta?.hookModel) {
    return { model: timingMeta.hookModel, inferred: false, source: 'hook' };
  }
  const inferred = inferModelAtTime(timeline, summary.firstStepMs || summary.updatedAtMs);
  return inferred
    ? { model: inferred, inferred: true, source: 'inferred' }
    : { model: UNKNOWN_MODEL_LABEL, inferred: false, source: null };
}

function summarizeTranscriptForCache(parsed, surface = 'desktop') {
  const dailyBuckets = Object.create(null);
  const dailyModelBuckets = Object.create(null);
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

    const modelLabel = cleanModelName(step.inferredModel) ?? UNKNOWN_MODEL_LABEL;
    if (modelLabel !== UNKNOWN_MODEL_LABEL) {
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

      const byMod = dailyModelBuckets[dateKey] ?? (dailyModelBuckets[dateKey] = Object.create(null));
      const dayMod = byMod[modelLabel] ?? (byMod[modelLabel] = createEmptyBucket());
      dayMod.inputTokens += step.inputTokens;
      dayMod.cacheReadTokens += step.cacheReadTokens;
      dayMod.outputTokens += step.outputTokens;
      dayMod.steps += 1;
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
    surface,
    kind: parsed.kind === 'agent' ? 'agent' : 'user',
    parentId: parsed.parentId ?? null,
    firstStepMs,
    updatedAtMs,
    model: lastModel ?? UNKNOWN_MODEL_LABEL,
    latestContextUsed,
    inputTokens: totalInput,
    cacheReadTokens: totalCacheRead,
    outputTokens: totalOutput,
    stepCount,
    dailyBuckets,
    dailyModelBuckets,
    modelBuckets,
    checkpointPeaksByModel,
    autoCompactions,
    manualCompactions,
    modelTimeline,
    spawnedAgents: (parsed.spawnedAgents ?? []).map((sp) => ({
      childId: sp.childId,
      via: sp.via,
      model: sp.model ?? null,
      modelSpec: sp.modelSpec ?? null,
      parentStepModel: sp.parentStepModel ?? null,
      ts: sp.ts || 0,
    })),
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

function findTimingMetadata(convId, rootAppDataDir, env) {
  const primary = resolveTimingsPath(convId, env);
  const fallback = join(rootAppDataDir, 'plugin_data', PLUGIN_ID, 'timings', `${convId}.jsonl`);
  const path = existsSync(primary) ? primary : (existsSync(fallback) ? fallback : null);
  if (!path) return { workspace: null, surface: null, hookModel: null };
  const parsed = readHookTimings(path);
  let hookModel = null;
  for (let i = (parsed.events?.length || 0) - 1; i >= 0; i--) {
    const raw = parsed.events[i]?.model;
    if (raw && !isInternalWorkerModel(raw)) {
      hookModel = prettifyModelId(raw);
      if (hookModel) break;
    }
  }
  return {
    workspace: parsed.workspace ?? null,
    surface: parsed.surface ?? null,
    hookModel,
  };
}

/**
 * Compute incremental conversation list + UTC+8 30-day, per-model, per-workspace, and subagent tree
 * usage rollup across all discovered Antigravity surfaces (`desktop`, `ide`, `cli`).
 */
export function computeUsageRollup({
  env = process.env,
  nowMs = Date.now(),
  persistCache = true,
  withHeaders = false,
} = {}) {
  const roots = resolveAllAppDataRoots(env);
  const cachePath = resolveUsageCachePath(env);
  const cache = loadUsageCache(cachePath);
  let dirty = false;

  const discovered = new Map();
  for (const root of roots) {
    const brainDir = join(root.appDataDir, 'brain');
    if (!existsSync(brainDir)) continue;
    let entries = [];
    try {
      entries = readdirSync(brainDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidConversationId(entry.name)) continue;
      const convId = entry.name;
      const transcriptPath = join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
      if (!existsSync(transcriptPath)) continue;

      let stats;
      try {
        stats = statSync(transcriptPath);
      } catch {
        continue;
      }

      const prev = discovered.get(convId);
      if (!prev || stats.mtimeMs > prev.stats.mtimeMs) {
        discovered.set(convId, {
          convId,
          transcriptPath,
          surface: root.surface,
          appDataDir: root.appDataDir,
          stats,
        });
      }
    }
  }

  const activeIds = new Set();
  const transcriptPaths = new Map();

  for (const [convId, info] of discovered.entries()) {
    let summary = cache.files[convId];
    if (
      !summary ||
      summary.mtimeMs !== info.stats.mtimeMs ||
      summary.size !== info.stats.size ||
      summary.surface !== info.surface
    ) {
      const parsed = readConversationTranscript(info.transcriptPath);
      if (!parsed.exists) continue;
      summary = summarizeTranscriptForCache(parsed, info.surface);
      cache.files[convId] = summary;
      dirty = true;
    }
    activeIds.add(convId);
    transcriptPaths.set(convId, info.transcriptPath);
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
  const dailyMap = new Map(
    dateWindow.map((date) => [
      date,
      {
        date,
        ...createEmptyBucket(),
        totalTokens: 0,
        freshTokens: 0,
        estimatedCostUsd: 0,
        fullCostWithoutCacheUsd: 0,
      },
    ])
  );
  const modelMap = new Map();
  const surfaceMap = new Map();
  const learnedCompactionByModelKey = Object.create(null);
  const latestEntry = modelTimeline[modelTimeline.length - 1];
  const latestGlobalModel = latestEntry?.toModel ?? null;

  let grandInput = 0;
  let grandCacheRead = 0;
  let grandOutput = 0;
  let grandSteps = 0;
  let grandCostUsd = 0;
  let grandFullCostUsd = 0;

  // Index hook timing metadata & parent `swarm.add` / `invoke_subagent` spawn records first
  // so subagent / swarm sessions resolve to their real models instead of an opaque bucket.
  const timingMetaById = new Map();
  const spawnIndex = new Map();
  for (const convId of activeIds) {
    const summary = cache.files[convId];
    if (!summary) continue;
    const info = discovered.get(convId);
    timingMetaById.set(convId, findTimingMetadata(convId, info?.appDataDir || '', env));
    for (const sp of summary.spawnedAgents || []) {
      if (!sp?.childId) continue;
      const prev = spawnIndex.get(sp.childId);
      if (!prev || (sp.ts || 0) >= (prev.ts || 0)) {
        spawnIndex.set(sp.childId, { ...sp, parentConvId: convId });
      }
    }
  }

  const resolvedById = new Map();
  for (const convId of activeIds) {
    const summary = cache.files[convId];
    if (!summary || summary.kind === 'agent') continue;
    resolvedById.set(convId, resolveUserConversationModel(summary, timingMetaById.get(convId), modelTimeline));
  }

  // Multi-pass resolution for subagent / swarm trees (handles nested worker -> helper `inherit` chains).
  for (let pass = 0; pass < 6; pass++) {
    let progressed = false;
    for (const convId of activeIds) {
      if (resolvedById.has(convId)) continue;
      const summary = cache.files[convId];
      if (!summary) continue;
      const timingMeta = timingMetaById.get(convId);
      if (summary.model && summary.model !== UNKNOWN_MODEL_LABEL) {
        resolvedById.set(convId, { model: summary.model, inferred: false, source: 'transcript' });
        progressed = true;
        continue;
      }
      if (timingMeta?.hookModel) {
        resolvedById.set(convId, { model: timingMeta.hookModel, inferred: false, source: 'hook' });
        progressed = true;
        continue;
      }
      const spawn = spawnIndex.get(convId);
      if (!spawn) {
        resolvedById.set(convId, { model: AGENT_MODEL_LABEL, inferred: false, source: null });
        progressed = true;
        continue;
      }
      if (spawn.model) {
        resolvedById.set(convId, { model: spawn.model, inferred: false, source: 'swarm' });
        progressed = true;
        continue;
      }
      const parentResolved = resolvedById.get(spawn.parentConvId);
      const specLower = String(spawn.modelSpec || 'inherit').toLowerCase();
      if ((specLower === 'inherit' || !specLower) && !spawn.parentStepModel && activeIds.has(spawn.parentConvId) && !parentResolved) {
        continue; // Wait for parent conversation in next pass
      }
      const rawParentModel = spawn.parentStepModel
        ?? parentResolved?.model
        ?? inferModelAtTime(modelTimeline, spawn.ts);
      const cleanParent = rawParentModel && rawParentModel !== UNKNOWN_MODEL_LABEL && rawParentModel !== AGENT_MODEL_LABEL
        ? rawParentModel
        : null;
      const aliasRes = resolveSubagentModelAlias(spawn.modelSpec, cleanParent);
      if (aliasRes.model) {
        resolvedById.set(convId, { model: aliasRes.model, inferred: aliasRes.inferred, source: 'parent-spawn' });
      } else {
        resolvedById.set(convId, { model: AGENT_MODEL_LABEL, inferred: false, source: null });
      }
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const convId of activeIds) {
    if (!resolvedById.has(convId)) {
      resolvedById.set(convId, { model: AGENT_MODEL_LABEL, inferred: false, source: null });
    }
  }

  for (const convId of activeIds) {
    const summary = cache.files[convId];
    if (!summary) continue;

    const timingMeta = timingMetaById.get(convId) || { workspace: null, surface: null, hookModel: null };
    const resolved = resolvedById.get(convId);
    const spawn = spawnIndex.get(convId);
    const isAgent = summary.kind === 'agent';
    const promptTotal = summary.inputTokens + summary.cacheReadTokens;

    let convCostUsd = 0;
    let convFullCostUsd = 0;
    for (const [rawModelName, bucket] of Object.entries(summary.modelBuckets || {})) {
      const modelName = rawModelName === UNKNOWN_MODEL_LABEL ? resolved.model : rawModelName;
      const cost = estimateTokenCost(modelName, {
        uncachedInputTokens: bucket.inputTokens,
        cacheReadTokens: bucket.cacheReadTokens,
        outputTokens: bucket.outputTokens,
      });
      convCostUsd += cost.estimatedCostUsd;
      convFullCostUsd += cost.fullCostWithoutCacheUsd;

      const target = modelMap.get(modelName) ?? {
        model: modelName,
        ...createEmptyBucket(),
        totalTokens: 0,
        freshTokens: 0,
        cacheHitRate: 0,
        inferredSteps: 0,
        agentSteps: 0,
        agentFreshTokens: 0,
        estimatedCostUsd: 0,
        fullCostWithoutCacheUsd: 0,
      };
      target.inputTokens += bucket.inputTokens;
      target.cacheReadTokens += bucket.cacheReadTokens;
      target.outputTokens += bucket.outputTokens;
      target.steps += bucket.steps;
      target.totalTokens += bucket.inputTokens + bucket.cacheReadTokens + bucket.outputTokens;
      target.freshTokens += bucket.inputTokens + bucket.outputTokens;
      target.estimatedCostUsd += cost.estimatedCostUsd;
      target.fullCostWithoutCacheUsd += cost.fullCostWithoutCacheUsd;
      if (rawModelName === UNKNOWN_MODEL_LABEL && resolved.inferred) {
        target.inferredSteps += bucket.steps;
      }
      if (isAgent) {
        target.agentSteps += bucket.steps;
        target.agentFreshTokens += bucket.inputTokens + bucket.outputTokens;
      }
      modelMap.set(modelName, target);
    }

    const surface = timingMeta.surface || summary.surface || 'desktop';
    const conv = {
      conversationId: convId,
      kind: isAgent ? 'agent' : 'user',
      parentId: spawn?.parentConvId ?? summary.parentId ?? null,
      surface,
      workspace: timingMeta.workspace ?? null,
      updatedAtMs: summary.updatedAtMs,
      model: resolved.model,
      modelInferred: resolved.inferred,
      modelSource: resolved.source ?? null,
      contextUsedTokens: summary.latestContextUsed,
      inputTokens: summary.inputTokens,
      cacheReadTokens: summary.cacheReadTokens,
      outputTokens: summary.outputTokens,
      freshTokens: summary.inputTokens + summary.outputTokens,
      totalTokens: promptTotal + summary.outputTokens,
      cacheHitRate: promptTotal > 0 ? Number(((summary.cacheReadTokens / promptTotal) * 100).toFixed(1)) : 0,
      stepCount: summary.stepCount,
      compactions: (summary.autoCompactions || 0) + (summary.manualCompactions || 0),
      estimatedCostUsd: roundUsd(convCostUsd),
      _rawCostUsd: convCostUsd,
      _rawFullCostUsd: convFullCostUsd,
    };

    if (withHeaders) {
      const header = readConversationHeader(transcriptPaths.get(convId));
      conv.title = header.title;
      conv.parentId = conv.parentId ?? header.parentId;
      if (header.kind === 'agent') conv.kind = 'agent';
    }
    conversations.push(conv);

    const surfBucket = surfaceMap.get(surface) ?? {
      surface,
      conversations: 0,
      steps: 0,
      freshTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
    surfBucket.conversations += 1;
    surfBucket.steps += summary.stepCount;
    surfBucket.freshTokens += summary.inputTokens + summary.outputTokens;
    surfBucket.totalTokens += promptTotal + summary.outputTokens;
    surfBucket.estimatedCostUsd += convCostUsd;
    surfaceMap.set(surface, surfBucket);

    for (const [modelKey, peakTokens] of Object.entries(summary.checkpointPeaksByModel || {})) {
      if (modelKey === 'unknown' || !Number.isFinite(peakTokens) || peakTokens < 64_000) continue;
      learnedCompactionByModelKey[modelKey] = Math.max(learnedCompactionByModelKey[modelKey] || 0, peakTokens);
    }

    grandInput += summary.inputTokens;
    grandCacheRead += summary.cacheReadTokens;
    grandOutput += summary.outputTokens;
    grandSteps += summary.stepCount;
    grandCostUsd += convCostUsd;
    grandFullCostUsd += convFullCostUsd;

    for (const [dateKey, bucket] of Object.entries(summary.dailyBuckets || {})) {
      if (!dateSet.has(dateKey)) continue;
      const target = dailyMap.get(dateKey);
      target.inputTokens += bucket.inputTokens;
      target.cacheReadTokens += bucket.cacheReadTokens;
      target.outputTokens += bucket.outputTokens;
      target.steps += bucket.steps;
      target.totalTokens += bucket.inputTokens + bucket.cacheReadTokens + bucket.outputTokens;
      target.freshTokens += bucket.inputTokens + bucket.outputTokens;

      const byMod = summary.dailyModelBuckets?.[dateKey];
      if (byMod) {
        for (const [rawModelName, modBucket] of Object.entries(byMod)) {
          const modelName = rawModelName === UNKNOWN_MODEL_LABEL ? resolved.model : rawModelName;
          const dayCost = estimateTokenCost(modelName, {
            uncachedInputTokens: modBucket.inputTokens,
            cacheReadTokens: modBucket.cacheReadTokens,
            outputTokens: modBucket.outputTokens,
          });
          target.estimatedCostUsd += dayCost.estimatedCostUsd;
          target.fullCostWithoutCacheUsd += dayCost.fullCostWithoutCacheUsd;
        }
      }
    }
  }

  conversations.sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  // Walk subagent / swarm parent links up to their root conversation (works with or without headers).
  const byId = new Map(conversations.map((c) => [c.conversationId, c]));
  const subagentsByRoot = Object.create(null);

  for (const conv of conversations) {
    if (conv.kind !== 'agent') continue;
    let cursor = conv;
    let lastKnownParentId = conv.parentId ?? null;
    const seen = new Set([conv.conversationId]);
    for (let depth = 0; depth < 12 && cursor?.parentId; depth++) {
      if (seen.has(cursor.parentId)) break;
      seen.add(cursor.parentId);
      lastKnownParentId = cursor.parentId;
      const next = byId.get(cursor.parentId);
      if (!next) break;
      cursor = next;
      if (cursor.kind === 'user') {
        conv.rootConversationId = cursor.conversationId;
        if (withHeaders) {
          conv.rootTitle = cursor.title ?? null;
        }
        if (!conv.workspace && cursor.workspace) {
          conv.workspace = cursor.workspace;
        }
        break;
      }
    }

    const rootKey = conv.rootConversationId || lastKnownParentId;
    if (rootKey) {
      const agg = subagentsByRoot[rootKey] ?? (subagentsByRoot[rootKey] = {
        count: 0,
        steps: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        freshTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      });
      agg.count += 1;
      agg.steps += conv.stepCount;
      agg.inputTokens += conv.inputTokens;
      agg.cacheReadTokens += conv.cacheReadTokens;
      agg.outputTokens += conv.outputTokens;
      agg.freshTokens += conv.freshTokens;
      agg.totalTokens += conv.totalTokens;
      agg.estimatedCostUsd = roundUsd(agg.estimatedCostUsd + conv._rawCostUsd);
    }
  }

  // Aggregate per-workspace usage after subagent workspace inheritance.
  const workspaceMap = new Map();
  for (const conv of conversations) {
    const subAgg = subagentsByRoot[conv.conversationId];
    conv.subagentCount = subAgg?.count ?? 0;
    conv.subagentFreshTokens = subAgg?.freshTokens ?? 0;

    if (conv.workspace) {
      const ws = workspaceMap.get(conv.workspace) ?? {
        workspace: conv.workspace,
        conversations: 0,
        userConversations: 0,
        steps: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        freshTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        fullCostWithoutCacheUsd: 0,
      };
      ws.conversations += 1;
      if (conv.kind === 'user') ws.userConversations += 1;
      ws.steps += conv.stepCount;
      ws.inputTokens += conv.inputTokens;
      ws.cacheReadTokens += conv.cacheReadTokens;
      ws.outputTokens += conv.outputTokens;
      ws.freshTokens += conv.freshTokens;
      ws.totalTokens += conv.totalTokens;
      ws.estimatedCostUsd += conv._rawCostUsd;
      ws.fullCostWithoutCacheUsd += conv._rawFullCostUsd;
      workspaceMap.set(conv.workspace, ws);
    }

    delete conv._rawCostUsd;
    delete conv._rawFullCostUsd;
  }

  const daily = dateWindow.map((d) => {
    const item = dailyMap.get(d);
    const cacheSavedUsd = Math.max(0, item.fullCostWithoutCacheUsd - item.estimatedCostUsd);
    return {
      date: item.date,
      inputTokens: item.inputTokens,
      cacheReadTokens: item.cacheReadTokens,
      outputTokens: item.outputTokens,
      steps: item.steps,
      totalTokens: item.totalTokens,
      freshTokens: item.freshTokens,
      estimatedCostUsd: roundUsd(item.estimatedCostUsd),
      cacheSavedUsd: roundUsd(cacheSavedUsd),
    };
  });

  const byModel = [...modelMap.values()]
    .map((m) => {
      const prompt = m.inputTokens + m.cacheReadTokens;
      const saved = Math.max(0, m.fullCostWithoutCacheUsd - m.estimatedCostUsd);
      return {
        model: m.model,
        inputTokens: m.inputTokens,
        cacheReadTokens: m.cacheReadTokens,
        outputTokens: m.outputTokens,
        steps: m.steps,
        totalTokens: m.totalTokens,
        freshTokens: m.freshTokens,
        cacheHitRate: prompt > 0 ? Number(((m.cacheReadTokens / prompt) * 100).toFixed(1)) : 0,
        inferredSteps: m.inferredSteps,
        agentSteps: m.agentSteps,
        agentFreshTokens: m.agentFreshTokens,
        estimatedCostUsd: roundUsd(m.estimatedCostUsd),
        cacheSavedUsd: roundUsd(saved),
      };
    })
    .sort((a, b) => b.freshTokens - a.freshTokens);

  const byWorkspace = [...workspaceMap.values()]
    .map((w) => {
      const prompt = w.inputTokens + w.cacheReadTokens;
      const saved = Math.max(0, w.fullCostWithoutCacheUsd - w.estimatedCostUsd);
      return {
        workspace: w.workspace,
        conversations: w.conversations,
        userConversations: w.userConversations,
        steps: w.steps,
        inputTokens: w.inputTokens,
        cacheReadTokens: w.cacheReadTokens,
        outputTokens: w.outputTokens,
        freshTokens: w.freshTokens,
        totalTokens: w.totalTokens,
        cacheHitRate: prompt > 0 ? Number(((w.cacheReadTokens / prompt) * 100).toFixed(1)) : 0,
        estimatedCostUsd: roundUsd(w.estimatedCostUsd),
        cacheSavedUsd: roundUsd(saved),
      };
    })
    .sort((a, b) => b.freshTokens - a.freshTokens);

  const bySurface = [...surfaceMap.values()]
    .map((s) => ({
      ...s,
      estimatedCostUsd: roundUsd(s.estimatedCostUsd),
    }))
    .sort((a, b) => b.freshTokens - a.freshTokens);

  const sumDays = (list, key) => list.reduce((acc, d) => acc + d[key], 0);
  const todayBucket = daily[daily.length - 1];
  const last7 = daily.slice(-7);
  const activeDays = daily.filter((d) => d.totalTokens > 0).length;
  const grandSavedUsd = Math.max(0, grandFullCostUsd - grandCostUsd);
  const grandSavedPct = grandFullCostUsd > 0
    ? Number(((grandSavedUsd / grandFullCostUsd) * 100).toFixed(1))
    : 0;

  return {
    timezone: 'UTC+8',
    conversations,
    subagentsByRoot,
    daily,
    byModel,
    byWorkspace,
    bySurface,
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
      estimatedCostUsd: roundUsd(grandCostUsd),
      cacheSavedUsd: roundUsd(grandSavedUsd),
      cacheSavedPercent: grandSavedPct,
      todayTokens: todayBucket?.totalTokens ?? 0,
      todayFreshTokens: todayBucket?.freshTokens ?? 0,
      todayCacheReadTokens: todayBucket?.cacheReadTokens ?? 0,
      todayOutputTokens: todayBucket?.outputTokens ?? 0,
      todayCostUsd: roundUsd(todayBucket?.estimatedCostUsd ?? 0),
      last7dTokens: sumDays(last7, 'totalTokens'),
      last7dFreshTokens: sumDays(last7, 'freshTokens'),
      last7dCostUsd: roundUsd(sumDays(last7, 'estimatedCostUsd')),
      last30dTokens: sumDays(daily, 'totalTokens'),
      last30dFreshTokens: sumDays(daily, 'freshTokens'),
      last30dCostUsd: roundUsd(sumDays(daily, 'estimatedCostUsd')),
      last30dCacheSavedUsd: roundUsd(sumDays(daily, 'cacheSavedUsd')),
    },
    calibration: {
      learnedCompactionByModelKey,
      latestGlobalModel,
      modelTimeline,
    },
  };
}
