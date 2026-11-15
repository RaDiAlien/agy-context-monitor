import {
  cleanModelName,
  estimateTokenCost,
  inferModelAtTime,
  isInternalWorkerModel,
  isValidPresetId,
  prettifyModelId,
  resolveContextCapacity,
  resolveModelKey,
} from './models.mjs';

const MIN_TPS_ELAPSED_SEC = 0.4;
const MAX_TPS_ELAPSED_SEC = 600;
const MIN_TPS_OUTPUT_TOKENS = 5;
const BASELINE_ELAPSED_SEC = 1.5;
const MIN_BASELINE_SAMPLES = 5;
const RECENT_WINDOW_SIZE = 5;
const SPARKLINE_LIMIT = 24;
const FORECAST_STEP_SAMPLES = 12;
const FORECAST_TURN_SAMPLES = 5;
const MIN_FORECAST_STEP_SAMPLES = 3;
const CACHE_TTL_GAP_MS = 5 * 60 * 1000;

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Match a hook timing window to a `PLANNER_RESPONSE` step without double-claiming windows.
 */
function claimHookWindow(step, windows, claimed) {
  // Priority 1: exact `initialNumSteps === step_index` match.
  for (let i = 0; i < windows.length; i++) {
    if (claimed.has(i)) continue;
    const win = windows[i];
    if (win.steps !== null && win.steps === step.stepIndex) {
      claimed.add(i);
      return win;
    }
  }

  // Priority 2: closest unmatched window within +-2s of transcript creation time.
  if (step.createdAtMs > 0) {
    let bestIdx = -1;
    let bestDelta = 2001;
    for (let i = 0; i < windows.length; i++) {
      if (claimed.has(i)) continue;
      const delta = Math.abs(windows[i].startMs - step.createdAtMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      claimed.add(bestIdx);
      return windows[bestIdx];
    }
  }

  return null;
}

/**
 * Find the last consecutive child tool step emitted during a `PLANNER_RESPONSE` turn.
 * Tool steps are recorded as `GENERIC` (`source: 'MODEL'`) when emitted, before execution finishes.
 */
function findLastToolChildStep(steps, plannerArrayIdx, toolCount) {
  let lastChild = null;
  let seen = 0;
  for (let j = plannerArrayIdx + 1; j < steps.length; j++) {
    const next = steps[j];
    if (next.type === 'PLANNER_RESPONSE' || next.type === 'USER_INPUT' || next.source === 'USER_EXPLICIT') {
      break;
    }
    if (next.type === 'GENERIC' && next.source === 'MODEL') {
      lastChild = next;
      seen++;
      if (toolCount > 0 && seen >= toolCount) {
        break;
      }
    }
  }
  return lastChild;
}

function userFacingHookModel(raw) {
  const cleaned = cleanModelName(raw);
  if (!cleaned || isInternalWorkerModel(cleaned)) return null;
  return prettifyModelId(cleaned);
}

/**
 * Determine the user-selected model. Priority:
 * 1. Transcript `Model Selection` switches (exact display names), unless a newer user-facing hook
 *    model belongs to a different model family.
 * 2. User-facing hook model ids (internal worker ids are ignored), prettified for display.
 * 3. Global selection timeline at the conversation start (user conversations only).
 */
function resolveDetectedModel(steps, transitions, windows, { kind, calibration, fallbackModel }) {
  let transcriptModel = null;
  let transcriptTs = -1;
  for (const t of transitions) {
    if (t.toModel && t.createdAtMs >= transcriptTs) {
      transcriptModel = t.toModel;
      transcriptTs = t.createdAtMs;
    }
  }
  if (!transcriptModel) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const m = cleanModelName(steps[i].inferredModel);
      if (m) {
        transcriptModel = m;
        break;
      }
    }
  }

  let hookModel = null;
  let hookTs = -1;
  for (const w of windows) {
    const name = userFacingHookModel(w.model);
    if (name && w.startMs >= hookTs) {
      hookModel = name;
      hookTs = w.startMs;
    }
  }

  if (transcriptModel) {
    const hookKey = resolveModelKey(hookModel);
    if (
      hookModel &&
      hookTs > transcriptTs &&
      hookKey !== 'unknown' &&
      hookKey !== resolveModelKey(transcriptModel)
    ) {
      return { name: hookModel, source: 'hook' };
    }
    return { name: transcriptModel, source: 'transcript' };
  }
  if (hookModel) {
    return { name: hookModel, source: 'hook' };
  }
  if (fallbackModel?.name && fallbackModel.name !== '__agents__') {
    const cleanedFallback = cleanModelName(fallbackModel.name);
    if (cleanedFallback) {
      return { name: cleanedFallback, source: fallbackModel.inferred ? 'inferred' : (fallbackModel.source || 'swarm') };
    }
  }
  if (kind !== 'agent') {
    const firstTs = steps.find((s) => s.createdAtMs > 0)?.createdAtMs ?? 0;
    const inferred = cleanModelName(inferModelAtTime(calibration?.modelTimeline, firstTs))
      ?? cleanModelName(calibration?.latestGlobalModel);
    if (inferred) {
      return { name: inferred, source: 'inferred' };
    }
  }
  return { name: null, source: null };
}

function crossesCheckpoint(prevIdx, nextIdx, checkpointIdxs) {
  return checkpointIdxs.some((cp) => cp > prevIdx && cp < nextIdx);
}

function mean(values) {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function medianOf(values) {
  return median([...values].sort((x, y) => x - y));
}

function roundUsd(value) {
  return Number((Number(value) || 0).toFixed(4));
}

/**
 * Flag abrupt prompt-cache drops between consecutive calls (excluding post-compaction resets).
 */
function annotateCacheBusts(plannerSteps, checkpointIdxs) {
  let count = 0;
  for (let i = 1; i < plannerSteps.length; i++) {
    const prev = plannerSteps[i - 1];
    const curr = plannerSteps[i];
    if (crossesCheckpoint(prev.stepIndex, curr.stepIndex, checkpointIdxs)) continue;

    const prevWarm = prev.cacheReadTokens >= 16_000 || (prev.promptTokens >= 20_000 && prev.cacheHitRate >= 0.5);
    if (!prevWarm) continue;
    if (curr.promptTokens < 16_000 || curr.uncachedInputTokens < 12_000) continue;
    if (curr.cacheHitRate >= 0.25 || curr.cacheReadTokens >= prev.cacheReadTokens * 0.25) continue;

    let reason = 'prefix-invalidated';
    if (prev.model && curr.model && resolveModelKey(prev.model) !== resolveModelKey(curr.model)) {
      reason = 'model-switch';
    } else if (prev.createdAtMs > 0 && curr.createdAtMs > 0 && (curr.createdAtMs - prev.createdAtMs) >= CACHE_TTL_GAP_MS) {
      reason = 'ttl-expired';
    }
    curr.cacheBust = true;
    curr.cacheBustReason = reason;
    count++;
  }
  return count;
}

/**
 * Estimate how many more model calls / user turns fit before the context reaches the window,
 * from recent context growth (deltas never span a compaction).
 */
function forecastCompaction(plannerSteps, checkpointIdxs, remainingTokens) {
  const withContext = plannerSteps.filter((s) => s.footprint > 0);

  const stepDeltas = [];
  for (let i = 1; i < withContext.length; i++) {
    const prev = withContext[i - 1];
    const next = withContext[i];
    if (crossesCheckpoint(prev.stepIndex, next.stepIndex, checkpointIdxs)) continue;
    stepDeltas.push(next.footprint - prev.footprint);
  }
  const recentStepDeltas = stepDeltas.slice(-FORECAST_STEP_SAMPLES);
  const perStep = recentStepDeltas.length >= MIN_FORECAST_STEP_SAMPLES ? mean(recentStepDeltas) : null;

  // Turn-end footprints for completed user turns (the latest turn may still be running).
  const turnEnds = [];
  for (const row of withContext) {
    const last = turnEnds[turnEnds.length - 1];
    if (last && last.turnIndex === row.turnIndex) {
      turnEnds[turnEnds.length - 1] = row;
    } else {
      turnEnds.push(row);
    }
  }
  const completedTurnEnds = turnEnds.slice(0, -1);
  const turnDeltas = [];
  for (let i = 1; i < completedTurnEnds.length; i++) {
    const prev = completedTurnEnds[i - 1];
    const next = completedTurnEnds[i];
    if (crossesCheckpoint(prev.stepIndex, next.stepIndex, checkpointIdxs)) continue;
    turnDeltas.push(next.footprint - prev.footprint);
  }
  const recentTurnDeltas = turnDeltas.slice(-FORECAST_TURN_SAMPLES);
  // Turn sizes vary a lot (one long implementation turn vs. quick Q&A), so use the median.
  const perTurn = recentTurnDeltas.length >= 1 ? medianOf(recentTurnDeltas) : null;

  const estimate = (growth) => (growth && growth > 0 ? Math.max(0, Math.floor(remainingTokens / growth)) : null);
  return {
    avgGrowthPerStep: perStep !== null ? Math.round(perStep) : null,
    avgGrowthPerTurn: perTurn !== null ? Math.round(perTurn) : null,
    stepsRemaining: estimate(perStep),
    turnsRemaining: estimate(perTurn),
    sampleSteps: recentStepDeltas.length,
    sampleTurns: recentTurnDeltas.length,
  };
}

/**
 * Compute full context window, cache hit rate, timing, cost, subagent tree, and TPS telemetry.
 */
export function computeConversationMetrics({
  conversationId,
  transcript,
  timings,
  capacityPreset = 'auto',
  capacityOverrides = null,
  calibration = null,
  subagents = null,
  fallbackModel = null,
}) {
  const steps = transcript?.steps ?? [];
  const transitions = transcript?.transitions ?? [];
  const windows = timings?.windows ?? [];
  const claimedWindows = new Set();

  const checkpoints = transcript?.checkpoints ?? [];
  const sessionCheckpoints = checkpoints.filter((c) => c.triggerTokens > 0 || c.stepIndex >= 0);
  const checkpointIdxs = sessionCheckpoints.map((c) => c.stepIndex);

  const plannerSteps = [];
  let totalUncachedInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalOutputTokens = 0;
  let latestPromptStep = null;
  let latestPlannerStep = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type !== 'PLANNER_RESPONSE') continue;

    const hookWin = claimHookWindow(step, windows, claimedWindows);
    const promptTokens = step.inputTokens + step.cacheReadTokens;
    const cacheHitRate = promptTokens > 0 ? step.cacheReadTokens / promptTokens : 0;

    totalUncachedInputTokens += step.inputTokens;
    totalCacheReadTokens += step.cacheReadTokens;
    totalOutputTokens += step.outputTokens;

    let elapsedSec = null;
    let timingSource = 'unavailable';

    if (step.toolCount > 0) {
      // Keep both endpoints in consistent transcript clock resolution so integer-second rounding
      // does not mix with ms hook start timestamps on sub-second steps.
      const lastChild = findLastToolChildStep(steps, i, step.toolCount);
      if (lastChild && step.createdAtMs > 0 && lastChild.createdAtMs > step.createdAtMs) {
        elapsedSec = (lastChild.createdAtMs - step.createdAtMs) / 1000;
        timingSource = 'transcript';
      }
    } else if (hookWin) {
      // No-tool responses rely exclusively on PreInvocation -> Stop/PostInvocation hooks.
      // Never subtract the subsequent USER_INPUT timestamp (that measures human idle time).
      const endMs = hookWin.stopMs ?? hookWin.postMs;
      if (endMs && endMs > hookWin.startMs) {
        elapsedSec = (endMs - hookWin.startMs) / 1000;
        timingSource = 'hook';
      }
    }

    let candidateTps = null;
    let tpsExcludedReason = null;
    if (elapsedSec === null) {
      tpsExcludedReason = step.toolCount === 0 ? 'no-hook-timing' : 'no-end-timestamp';
    } else if (elapsedSec < MIN_TPS_ELAPSED_SEC) {
      tpsExcludedReason = 'too-short';
    } else if (elapsedSec > MAX_TPS_ELAPSED_SEC) {
      tpsExcludedReason = 'too-long';
    } else if (step.outputTokens < MIN_TPS_OUTPUT_TOKENS) {
      tpsExcludedReason = 'low-output';
    } else {
      candidateTps = step.outputTokens / elapsedSec;
    }

    const row = {
      stepIndex: step.stepIndex,
      createdAt: step.createdAt,
      createdAtMs: step.createdAtMs,
      status: step.status,
      model: cleanModelName(step.inferredModel) ?? userFacingHookModel(hookWin?.model),
      turnIndex: step.turnIndex ?? 0,
      footprint: promptTokens + step.outputTokens,
      uncachedInputTokens: step.inputTokens,
      cacheReadTokens: step.cacheReadTokens,
      promptTokens,
      outputTokens: step.outputTokens,
      cacheHitRate,
      cacheBust: false,
      cacheBustReason: null,
      toolCount: step.toolCount,
      elapsedSec,
      timingSource,
      tps: candidateTps,
      tpsEligible: candidateTps !== null,
      tpsExcludedReason,
    };

    plannerSteps.push(row);
    latestPlannerStep = row;
    if (promptTokens > 0) {
      latestPromptStep = row;
    }
  }

  const cacheBustCount = annotateCacheBusts(plannerSteps, checkpointIdxs);

  // MAD outlier filtering against >= 1.5s baseline turns.
  const baselineValues = plannerSteps
    .filter((s) => s.tpsEligible && s.elapsedSec >= BASELINE_ELAPSED_SEC)
    .map((s) => s.tps)
    .sort((a, b) => a - b);

  let outlierUpperBound = null;
  if (baselineValues.length >= MIN_BASELINE_SAMPLES) {
    const med = median(baselineValues);
    const absDevs = baselineValues.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    const mad = median(absDevs);
    outlierUpperBound = Math.max(med * 6, med + mad * 10);

    for (const row of plannerSteps) {
      if (row.tpsEligible && row.elapsedSec < BASELINE_ELAPSED_SEC && row.tps > outlierUpperBound) {
        row.tpsEligible = false;
        row.tpsExcludedReason = 'outlier';
      }
    }
  }

  const eligibleSteps = plannerSteps.filter((s) => s.tpsEligible);
  const latestEligible = eligibleSteps.length > 0 ? eligibleSteps[eligibleSteps.length - 1] : null;
  const recentWindow = eligibleSteps.slice(-RECENT_WINDOW_SIZE);

  const sumRecentOut = recentWindow.reduce((acc, s) => acc + s.outputTokens, 0);
  const sumRecentSec = recentWindow.reduce((acc, s) => acc + s.elapsedSec, 0);
  const recentTps = sumRecentSec > 0 ? sumRecentOut / sumRecentSec : null;

  const sumSessionOut = eligibleSteps.reduce((acc, s) => acc + s.outputTokens, 0);
  const sumSessionSec = eligibleSteps.reduce((acc, s) => acc + s.elapsedSec, 0);
  const sessionTps = sumSessionSec > 0 ? sumSessionOut / sumSessionSec : null;

  const conversationKind = transcript?.kind === 'agent' ? 'agent' : 'user';
  const detected = resolveDetectedModel(steps, transitions, windows, {
    kind: conversationKind,
    calibration,
    fallbackModel,
  });
  const detectedModel = detected.name;
  const modelKey = resolveModelKey(detectedModel);

  let sumCostUsd = 0;
  let sumFullCostUsd = 0;
  for (const row of plannerSteps) {
    const stepCost = estimateTokenCost(row.model ?? detectedModel, {
      uncachedInputTokens: row.uncachedInputTokens,
      cacheReadTokens: row.cacheReadTokens,
      outputTokens: row.outputTokens,
    });
    sumCostUsd += stepCost.estimatedCostUsd;
    sumFullCostUsd += stepCost.fullCostWithoutCacheUsd;
  }
  const sumCacheSavedUsd = Math.max(0, sumFullCostUsd - sumCostUsd);
  const cacheSavedPercent = sumFullCostUsd > 0
    ? Number(((sumCacheSavedUsd / sumFullCostUsd) * 100).toFixed(1))
    : 0;

  const autoCheckpoints = sessionCheckpoints.filter((c) => !c.manual);
  const manualCheckpoints = sessionCheckpoints.filter((c) => c.manual);
  const lastCheckpoint = sessionCheckpoints.length > 0
    ? sessionCheckpoints[sessionCheckpoints.length - 1]
    : null;
  const lastAutoCheckpoint = autoCheckpoints.length > 0
    ? autoCheckpoints[autoCheckpoints.length - 1]
    : null;

  // Only automatic compactions reveal the window ceiling; manual `/compact` can happen at any size.
  let observedCompactionTokens = null;
  for (const cp of autoCheckpoints) {
    if (cp.triggerTokens < 64_000) continue;
    if (modelKey !== 'unknown' && cp.model && resolveModelKey(cp.model) !== modelKey) continue;
    observedCompactionTokens = Math.max(observedCompactionTokens || 0, cp.triggerTokens);
  }
  if (!observedCompactionTokens && modelKey !== 'unknown') {
    const learned = calibration?.learnedCompactionByModelKey?.[modelKey];
    if (Number.isFinite(learned) && learned >= 64_000) {
      observedCompactionTokens = learned;
    }
  }

  const postCheckpointEmpty = Boolean(
    lastCheckpoint && (!latestPromptStep || lastCheckpoint.stepIndex > latestPromptStep.stepIndex)
  );

  let uncachedContextTokens;
  let cachedContextTokens;
  let retainedOutputTokens;
  let promptTokensForCache;
  let contextUsedTokens;

  if (postCheckpointEmpty) {
    uncachedContextTokens = lastCheckpoint.summaryTokens || 0;
    cachedContextTokens = 0;
    retainedOutputTokens = 0;
    promptTokensForCache = uncachedContextTokens;
    contextUsedTokens = uncachedContextTokens;
  } else {
    uncachedContextTokens = latestPromptStep?.uncachedInputTokens ?? 0;
    cachedContextTokens = latestPromptStep?.cacheReadTokens ?? 0;
    retainedOutputTokens = latestPromptStep?.outputTokens ?? 0;
    promptTokensForCache = uncachedContextTokens + cachedContextTokens;
    contextUsedTokens = promptTokensForCache + retainedOutputTokens;
  }

  // A model switch after the latest measured step means the current footprint was measured under
  // the previous model: never "expand" the new model's window to fit it, warn instead.
  const latestTransition = transitions.length > 0 ? transitions[transitions.length - 1] : null;
  const switchPending = Boolean(
    latestTransition &&
    latestPromptStep &&
    latestTransition.stepIndex > latestPromptStep.stepIndex &&
    resolveModelKey(latestTransition.toModel) !== resolveModelKey(latestTransition.fromModel)
  );

  const overridePreset = isValidPresetId(capacityPreset) && capacityPreset !== 'auto'
    ? capacityPreset
    : (capacityOverrides && isValidPresetId(capacityOverrides[modelKey]) ? capacityOverrides[modelKey] : 'auto');

  const capacity = resolveContextCapacity(detectedModel, overridePreset, {
    observedCompactionTokens,
    currentUsedTokens: contextUsedTokens,
    allowPromotion: !switchPending,
  });
  const contextTotalTokens = capacity.capacityTokens;
  const contextPercent = contextTotalTokens > 0
    ? Math.min(100, (contextUsedTokens / contextTotalTokens) * 100)
    : 0;
  const contextRemainingTokens = Math.max(0, contextTotalTokens - contextUsedTokens);
  const latestCacheHitRate = postCheckpointEmpty ? 0 : (latestPromptStep?.cacheHitRate ?? 0);
  const totalPromptTokens = totalUncachedInputTokens + totalCacheReadTokens;
  const sessionCacheHitRate = totalPromptTokens > 0 ? totalCacheReadTokens / totalPromptTokens : 0;

  const overCapacity = contextUsedTokens > contextTotalTokens;
  const forecast = forecastCompaction(plannerSteps, checkpointIdxs, contextRemainingTokens);

  let healthLevel = 'normal';
  if (contextPercent >= 85) {
    healthLevel = 'critical';
  } else if (contextPercent >= 70) {
    healthLevel = 'warning';
  }

  const normalizedSubagents = {
    count: subagents?.count || 0,
    steps: subagents?.steps || 0,
    uncachedInputTokens: subagents?.uncachedInputTokens ?? subagents?.inputTokens ?? 0,
    cacheReadTokens: subagents?.cacheReadTokens || 0,
    outputTokens: subagents?.outputTokens || 0,
    freshTokens: subagents?.freshTokens || 0,
    totalTokens: subagents?.totalTokens || 0,
    estimatedCostUsd: roundUsd(subagents?.estimatedCostUsd || 0),
    rootConversationId: subagents?.rootConversationId ?? null,
    parentConversationId: subagents?.parentConversationId ?? transcript?.parentId ?? null,
  };

  return {
    conversationId,
    exists: Boolean(transcript?.exists),
    updatedAtMs: Math.max(transcript?.mtimeMs ?? 0, timings?.mtimeMs ?? 0),
    hooksActive: Boolean(timings?.exists && windows.length > 0),
    conversationKind,
    workspace: timings?.workspace ?? null,
    surface: timings?.surface ?? null,
    model: {
      name: detectedModel ?? 'Unknown',
      key: modelKey,
      detected: detectedModel !== null,
      nameSource: detected.source,
      inferredFromRecent: detected.source === 'inferred',
      overridden: capacity.source === 'preset',
      capacityTokens: contextTotalTokens,
      capacitySource: capacity.source,
      preset: capacity.preset,
      matchedRule: capacity.matchedRule,
      providerCapacityTokens: capacity.providerCapacityTokens,
      providerCapacityLabel: capacity.providerCapacityLabel,
    },
    context: {
      usedTokens: contextUsedTokens,
      promptTokens: promptTokensForCache,
      uncachedTokens: uncachedContextTokens,
      cachedTokens: cachedContextTokens,
      outputTokensLastStep: retainedOutputTokens,
      totalTokens: contextTotalTokens,
      remainingTokens: contextRemainingTokens,
      usedPercent: Number(contextPercent.toFixed(2)),
      cacheHitRate: Number((latestCacheHitRate * 100).toFixed(2)),
      healthLevel,
      overCapacity,
      switchPending,
      justCompacted: postCheckpointEmpty,
      lastStepCacheBust: postCheckpointEmpty ? null : (latestPromptStep?.cacheBustReason ?? null),
    },
    forecast,
    compaction: {
      count: sessionCheckpoints.length,
      autoCount: autoCheckpoints.length,
      manualCount: manualCheckpoints.length,
      lastStepIndex: lastCheckpoint?.stepIndex ?? null,
      lastManual: Boolean(lastCheckpoint?.manual),
      lastTriggerTokens: lastCheckpoint?.triggerTokens || null,
      lastAutoTriggerTokens: lastAutoCheckpoint?.triggerTokens || null,
      observedCeilingTokens: observedCompactionTokens || null,
    },
    tps: {
      latestTps: latestEligible ? Number(latestEligible.tps.toFixed(1)) : null,
      latestStepIndex: latestEligible?.stepIndex ?? null,
      recentTps: recentTps !== null ? Number(recentTps.toFixed(1)) : null,
      recentWindowCount: recentWindow.length,
      sessionTps: sessionTps !== null ? Number(sessionTps.toFixed(1)) : null,
      measuredStepCount: eligibleSteps.length,
      totalMeasuredSec: Number(sumSessionSec.toFixed(1)),
      outlierUpperBound: outlierUpperBound !== null ? Number(outlierUpperBound.toFixed(1)) : null,
      series: eligibleSteps.slice(-SPARKLINE_LIMIT).map((s) => ({
        stepIndex: s.stepIndex,
        tps: Number(s.tps.toFixed(1)),
        outputTokens: s.outputTokens,
        elapsedSec: Number(s.elapsedSec.toFixed(2)),
        timingSource: s.timingSource,
      })),
    },
    sessionTotals: {
      totalSteps: steps.length,
      plannerSteps: plannerSteps.length,
      uncachedInputTokens: totalUncachedInputTokens,
      cacheReadTokens: totalCacheReadTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalPromptTokens + totalOutputTokens,
      cacheHitRate: Number((sessionCacheHitRate * 100).toFixed(2)),
      cacheBustCount,
      activeStepStatus: latestPlannerStep?.status ?? null,
      cost: {
        estimatedCostUsd: roundUsd(sumCostUsd),
        fullCostWithoutCacheUsd: roundUsd(sumFullCostUsd),
        cacheSavedUsd: roundUsd(sumCacheSavedUsd),
        cacheSavedPercent,
      },
    },
    subagents: normalizedSubagents,
    steps: plannerSteps.map(({ footprint, ...row }) => ({
      ...row,
      contextTokens: footprint,
      cacheHitRate: Number((row.cacheHitRate * 100).toFixed(1)),
      elapsedSec: row.elapsedSec !== null ? Number(row.elapsedSec.toFixed(2)) : null,
      tps: row.tps !== null ? Number(row.tps.toFixed(1)) : null,
    })),
  };
}
