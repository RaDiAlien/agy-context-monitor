/**
 * Model context window catalog, capacity presets, CHECKPOINT snapping, and model-selection parser.
 */

export const DEFAULT_CAPACITY_TOKENS = 262_144;

export const CAPACITY_PRESETS = Object.freeze([
  { id: 'auto', label: 'Auto', tokens: null },
  { id: '128k', label: '128K', tokens: 131_072 },
  { id: '200k', label: '200K', tokens: 200_000 },
  { id: '256k', label: '256K', tokens: 262_144 },
  { id: '512k', label: '512K', tokens: 524_288 },
  { id: '1m', label: '1M', tokens: 1_048_576 },
  { id: '2m', label: '2M', tokens: 2_097_152 },
]);

const PRESET_MAP = new Map(CAPACITY_PRESETS.map((p) => [p.id, p]));
const STANDARD_WINDOW_TIERS = [131_072, 200_000, 262_144, 524_288, 1_048_576, 2_097_152];
const PROMOTION_TIERS = [200_000, 262_144, 524_288, 1_048_576, 2_097_152];
const MODEL_KEY_RE = /^[a-z0-9][a-z0-9.\-]{0,47}$/;

export function isValidPresetId(id) {
  return PRESET_MAP.has(id);
}

export function isValidModelKey(key) {
  return typeof key === 'string' && MODEL_KEY_RE.test(key);
}

/**
 * Ordered matching rules (specific rules first).
 * `effectiveCapacity` tracks Antigravity host session windows before compaction;
 * `providerCapacityTokens` / `providerCapacityLabel` capture upstream provider docs for reference.
 */
const MODEL_CAPACITY_RULES = [
  {
    key: 'claude-1m',
    pattern: /\bclaude\b.*(?:\[?1m\]?|1000k)/i,
    canonical: 'Claude (1M)',
    effectiveCapacity: 1_000_000,
    providerCapacityTokens: 1_000_000,
    providerCapacityLabel: '1M',
  },
  {
    key: 'claude-modern',
    pattern: /\bclaude\b.*\b(?:4\.[678]|5[.-]\d)\b|\b(?:4\.[678]|5[.-]\d)\b.*\bclaude\b/i,
    canonical: 'Claude 4.6+/5.x',
    effectiveCapacity: 200_000,
    providerCapacityTokens: 1_000_000,
    providerCapacityLabel: '1M',
  },
  {
    key: 'claude',
    pattern: /\bclaude\b/i,
    canonical: 'Claude',
    effectiveCapacity: 200_000,
    providerCapacityTokens: 200_000,
    providerCapacityLabel: '200K',
  },
  {
    key: 'gemini-4-argon',
    pattern: /\borchestrator\b.*\bargon\b|\bgemini[- ]?4[- ]?argon\b|\bargon\b/i,
    canonical: 'Gemini 4 Argon',
    effectiveCapacity: 131_072,
    providerCapacityTokens: 1_048_576,
    providerCapacityLabel: '1M',
  },
  {
    key: 'gemini-4-carbon',
    pattern: /\borchestrator\b.*\bcarbon\b|\bgemini[- ]?pro[- ]?orchestrator\b|\bgemini[- ]?4[- ]?carbon\b|\bcarbon\b/i,
    canonical: 'Orchestrator (Carbon)',
    effectiveCapacity: 262_144,
    providerCapacityTokens: 1_048_576,
    providerCapacityLabel: '1M',
  },
  {
    key: 'gemini-4-hydrogen',
    pattern: /\bgemini[- ]?4[- ]?hydrogen\b|\bhydrogen\b/i,
    canonical: 'Gemini 4 Hydrogen',
    effectiveCapacity: 262_144,
    providerCapacityTokens: 1_048_576,
    providerCapacityLabel: '1M',
  },
  {
    key: 'gemini-3.8-flash',
    pattern: /\bgemini[- ]?3\.8[- ]?flash\b/i,
    canonical: 'Gemini 3.8 Flash',
    effectiveCapacity: 262_144,
    providerCapacityTokens: 1_048_576,
    providerCapacityLabel: '1M',
  },
  {
    key: 'gemini-1.5-pro',
    pattern: /\bgemini[- ]?1\.5[- ]?pro\b/i,
    canonical: 'Gemini 1.5 Pro',
    effectiveCapacity: 262_144,
    providerCapacityTokens: 2_097_152,
    providerCapacityLabel: '2M',
  },
  {
    key: 'gemini',
    pattern: /\bgemini\b/i,
    canonical: 'Gemini',
    effectiveCapacity: 262_144,
    providerCapacityTokens: 1_048_576,
    providerCapacityLabel: '1M',
  },
  {
    key: 'gpt-oss-120b',
    pattern: /\bgpt[- ]?oss[- ]?120b\b/i,
    canonical: 'GPT-OSS 120B',
    effectiveCapacity: 131_072,
    providerCapacityTokens: 131_072,
    providerCapacityLabel: '128K',
  },
  {
    key: 'gpt-4.1',
    pattern: /\bgpt[- ]?4\.1\b/i,
    canonical: 'GPT-4.1',
    effectiveCapacity: 262_144,
    providerCapacityTokens: 1_047_576,
    providerCapacityLabel: '1M',
  },
  {
    key: 'gpt-5',
    pattern: /\bgpt[- ]?5\b/i,
    canonical: 'GPT-5',
    effectiveCapacity: 262_144,
    providerCapacityTokens: 400_000,
    providerCapacityLabel: '400K',
  },
  {
    key: 'openai-reasoning',
    pattern: /\b(?:o1|o3|o4(?:-mini)?)\b/i,
    canonical: 'OpenAI Reasoning',
    effectiveCapacity: 200_000,
    providerCapacityTokens: 200_000,
    providerCapacityLabel: '200K',
  },
  {
    key: 'gpt',
    pattern: /\bgpt[- ]?4o\b|\bgpt[- ]?oss\b/i,
    canonical: 'GPT',
    effectiveCapacity: 131_072,
    providerCapacityTokens: 128_000,
    providerCapacityLabel: '128K',
  },
];

const MODEL_SWITCH_FROM_TO_RE = /changed setting `Model Selection`\s+from\s+(.+?)\s+to\s+([^\r\n`<]+?)(?:\.(?=\s|$|<)|\s*(?=<|$))/i;
const MODEL_SWITCH_TO_RE = /changed setting `Model Selection`(?: from .+? to| to)\s+([^\r\n`<]+?)(?:\.(?=\s|$|<)|\s*(?=<|$))/i;

function sanitizeExtractedModel(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[.。`]+$/, '').trim();
  return cleaned || null;
}

function matchModelRule(modelName) {
  const cleanedModel = cleanModelName(modelName);
  if (!cleanedModel) return null;
  for (const rule of MODEL_CAPACITY_RULES) {
    if (rule.pattern.test(cleanedModel)) {
      return rule;
    }
  }
  return null;
}

/**
 * Extract `{ fromModel, toModel }` from an Antigravity `<USER_SETTINGS_CHANGE>` line when present.
 */
export function extractModelTransition(text) {
  if (typeof text !== 'string' || !text) return null;
  const fromTo = MODEL_SWITCH_FROM_TO_RE.exec(text);
  if (fromTo) {
    const fromModel = sanitizeExtractedModel(fromTo[1]);
    const toModel = sanitizeExtractedModel(fromTo[2]);
    if (toModel) return { fromModel, toModel };
  }
  const toOnly = MODEL_SWITCH_TO_RE.exec(text);
  if (toOnly) {
    const toModel = sanitizeExtractedModel(toOnly[1]);
    if (toModel) return { fromModel: null, toModel };
  }
  return null;
}

/**
 * Extract the selected model display name from an Antigravity `<USER_SETTINGS_CHANGE>` line.
 */
export function extractModelChange(text) {
  return extractModelTransition(text)?.toModel ?? null;
}

/**
 * Clean a raw model string (treating empty / `"auto"` as unset).
 */
export function cleanModelName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'auto' || trimmed.toLowerCase() === 'unknown') {
    return null;
  }
  return trimmed;
}

/**
 * Hook payloads sometimes report internal sub-worker models (e.g. `gemini-flash-worker-agy`)
 * that are not the user's selected model. Those must never override the displayed model.
 */
export function isInternalWorkerModel(value) {
  const cleaned = cleanModelName(value);
  if (!cleaned) return false;
  return /worker|-agy$|^internal[-_]/i.test(cleaned);
}

const KNOWN_MODEL_IDS = new Map([
  ['gemini-pro-orchestrator', 'Orchestrator (Carbon)'],
  ['gemini-3.8-flash-tiered', 'Gemini 3.8 Flash'],
]);

/**
 * Turn a raw hook model id (e.g. `claude-opus-5-5-high`) into a readable display name
 * (`Claude Opus 5.5 (High)`). Display names that already contain spaces are returned as-is.
 */
export function prettifyModelId(value) {
  const cleaned = cleanModelName(value);
  if (!cleaned) return null;
  if (/\s/.test(cleaned)) return cleaned;
  const lower = cleaned.toLowerCase();
  if (KNOWN_MODEL_IDS.has(lower)) return KNOWN_MODEL_IDS.get(lower);

  const effortWords = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'minimal', 'thinking']);
  const parts = lower.split(/[-_]+/).filter((p) => p && p !== 'tiered');
  let effort = null;
  if (parts.length > 1 && effortWords.has(parts[parts.length - 1])) {
    effort = parts.pop();
  }

  const words = [];
  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i];
    const next = parts[i + 1];
    // Join split version numbers: `5-5` -> `5.5`, `3-8` -> `3.8`.
    if (/^\d+$/.test(cur) && next && /^\d+$/.test(next) && next.length <= 2) {
      words.push(`${cur}.${next}`);
      i++;
      continue;
    }
    if (/^gpt$/.test(cur)) {
      words.push('GPT');
    } else if (/^oss$/.test(cur)) {
      words.push('OSS');
    } else if (/^\d+b$/.test(cur)) {
      words.push(cur.toUpperCase());
    } else {
      words.push(cur.charAt(0).toUpperCase() + cur.slice(1));
    }
  }
  const base = words.join(' ');
  if (!effort) return base;
  const effortLabel = effort === 'xhigh' ? 'XHigh' : effort.charAt(0).toUpperCase() + effort.slice(1);
  return `${base} (${effortLabel})`;
}

/**
 * Resolve `invoke_subagent` `Model` aliases (`inherit`, `flash`, `flash_lite`, `pro`) or explicit names.
 */
export function resolveSubagentModelAlias(modelSpec, parentModel = null) {
  const raw = typeof modelSpec === 'string' ? modelSpec.trim().replace(/^"+|"+$/g, '').trim() : '';
  const lower = raw.toLowerCase();
  if (!lower || lower === 'inherit') {
    const inherited = cleanModelName(parentModel);
    return inherited ? { model: inherited, inferred: true } : { model: null, inferred: false };
  }
  if (lower === 'flash') {
    return { model: 'Gemini 3.8 Flash', inferred: true };
  }
  if (lower === 'flash_lite' || lower === 'flash-lite') {
    return { model: 'Gemini 3.8 Flash Lite', inferred: true };
  }
  if (lower === 'pro') {
    return { model: 'Gemini 3.1 Pro', inferred: true };
  }
  const explicit = prettifyModelId(raw);
  return explicit ? { model: explicit, inferred: false } : { model: null, inferred: false };
}

/**
 * `Model Selection` is global app state, so a conversation that never switched models inline ran on
 * whatever was selected when it started. Given a time-sorted `[{ ts, fromModel, toModel }]` timeline
 * gathered across all conversations, return the model selected at `ts` (or null when unknowable).
 */
export function inferModelAtTime(timeline, ts) {
  if (!Array.isArray(timeline) || timeline.length === 0 || !Number.isFinite(ts) || ts <= 0) return null;
  let before = null;
  for (const entry of timeline) {
    if (!entry || !Number.isFinite(entry.ts)) continue;
    if (entry.ts <= ts) {
      if (entry.toModel) before = entry.toModel;
    } else {
      // First switch after `ts`: its `fromModel` is what was selected at `ts`.
      return before ?? cleanModelName(entry.fromModel);
    }
  }
  return before;
}

/**
 * Return the canonical rule key for grouping compaction observations per model family.
 */
export function resolveModelKey(modelName) {
  return matchModelRule(modelName)?.key ?? 'unknown';
}

/**
 * Snap an observed pre-compaction token trigger near a standard binary/decimal window tier.
 */
export function snapObservedCompactionToWindow(triggerTokens) {
  if (!Number.isFinite(triggerTokens) || triggerTokens <= 32_000) return null;
  for (const tier of STANDARD_WINDOW_TIERS) {
    if (triggerTokens >= tier * 0.88 && triggerTokens <= tier * 1.06) {
      return tier;
    }
  }
  return Math.ceil(triggerTokens / 1024) * 1024;
}

/**
 * Resolve effective context window capacity from preset, calibrated CHECKPOINT ceilings,
 * model rules, and live growth observation.
 */
export function resolveContextCapacity(
  modelName,
  presetId = 'auto',
  { observedCompactionTokens = null, currentUsedTokens = 0, allowPromotion = true } = {}
) {
  const rule = matchModelRule(modelName);
  const providerCapacityTokens = rule?.providerCapacityTokens ?? null;
  const providerCapacityLabel = rule?.providerCapacityLabel ?? null;

  const normalizedPreset = PRESET_MAP.has(presetId) ? presetId : 'auto';
  const preset = PRESET_MAP.get(normalizedPreset);
  if (preset && preset.tokens !== null) {
    return {
      capacityTokens: preset.tokens,
      source: 'preset',
      preset: preset.id,
      matchedRule: rule?.canonical ?? null,
      providerCapacityTokens,
      providerCapacityLabel,
    };
  }

  const snappedObserved = observedCompactionTokens
    ? snapObservedCompactionToWindow(observedCompactionTokens)
    : null;

  let capacityTokens = snappedObserved ?? rule?.effectiveCapacity ?? DEFAULT_CAPACITY_TOKENS;
  let source = snappedObserved
    ? 'checkpoint-calibrated'
    : (rule ? 'effective-model' : 'default');

  if (allowPromotion && Number.isFinite(currentUsedTokens) && currentUsedTokens > capacityTokens * 1.03) {
    const maxCap = Math.max(currentUsedTokens, providerCapacityTokens || 1_048_576);
    let promoted = PROMOTION_TIERS.find((tier) => tier >= currentUsedTokens && tier <= maxCap);
    if (!promoted) {
      promoted = maxCap;
    }
    capacityTokens = promoted;
    source = 'observed-growth';
  }

  return {
    capacityTokens,
    source,
    preset: 'auto',
    matchedRule: rule?.canonical ?? null,
    providerCapacityTokens,
    providerCapacityLabel,
  };
}

/**
 * Reference public API pricing rules (USD per 1M tokens) for equivalent cost & cache-savings estimates.
 */
const MODEL_PRICING_RULES = [
  {
    pattern: /\bclaude\b.*\bopus\b.*\b(?:4\.[5-9]|5)\b|\b(?:4\.[5-9]|5[.-]\d)\b.*\bopus\b/i,
    tier: 'Claude Opus',
    inputPerM: 5.0,
    cacheReadPerM: 0.5,
    outputPerM: 25.0,
  },
  {
    pattern: /\bclaude\b.*\bopus\b/i,
    tier: 'Claude Opus (Legacy)',
    inputPerM: 15.0,
    cacheReadPerM: 1.5,
    outputPerM: 75.0,
  },
  {
    pattern: /\bclaude\b.*\bhaiku\b/i,
    tier: 'Claude Haiku',
    inputPerM: 1.0,
    cacheReadPerM: 0.1,
    outputPerM: 5.0,
  },
  {
    pattern: /\bclaude\b/i,
    tier: 'Claude Sonnet',
    inputPerM: 3.0,
    cacheReadPerM: 0.3,
    outputPerM: 15.0,
  },
  {
    pattern: /\bgemini\b.*\bflash\b|\bargon\b/i,
    tier: 'Gemini Flash / Argon',
    inputPerM: 0.3,
    cacheReadPerM: 0.03,
    outputPerM: 2.5,
  },
  {
    pattern: /\borchestrator\b|\bcarbon\b|\bhydrogen\b|\bgemini\b/i,
    tier: 'Gemini Pro / Frontier',
    inputPerM: 2.0,
    cacheReadPerM: 0.2,
    outputPerM: 12.0,
  },
  {
    pattern: /\bgpt[- ]?oss[- ]?120b\b/i,
    tier: 'GPT-OSS 120B',
    inputPerM: 0.15,
    cacheReadPerM: 0.04,
    outputPerM: 0.6,
  },
  {
    pattern: /\bgpt\b|\b(?:o1|o3|o4(?:-mini)?)\b/i,
    tier: 'OpenAI GPT / Reasoning',
    inputPerM: 2.0,
    cacheReadPerM: 0.5,
    outputPerM: 8.0,
  },
];

const DEFAULT_PRICING_RULE = Object.freeze({
  tier: 'Standard Reference',
  inputPerM: 2.0,
  cacheReadPerM: 0.2,
  outputPerM: 12.0,
});

export function resolveModelPricing(modelName) {
  const cleaned = cleanModelName(modelName);
  if (cleaned) {
    for (const rule of MODEL_PRICING_RULES) {
      if (rule.pattern.test(cleaned)) {
        return rule;
      }
    }
  }
  return DEFAULT_PRICING_RULE;
}

/**
 * Estimate equivalent API cost and prompt-cache savings in USD for a token tuple.
 */
export function estimateTokenCost(
  modelName,
  { uncachedInputTokens = 0, cacheReadTokens = 0, outputTokens = 0 } = {}
) {
  const rate = resolveModelPricing(modelName);
  const uncached = Math.max(0, Number(uncachedInputTokens) || 0);
  const cached = Math.max(0, Number(cacheReadTokens) || 0);
  const out = Math.max(0, Number(outputTokens) || 0);

  const estimatedCostUsd =
    (uncached * rate.inputPerM + cached * rate.cacheReadPerM + out * rate.outputPerM) / 1_000_000;
  const fullCostWithoutCacheUsd =
    ((uncached + cached) * rate.inputPerM + out * rate.outputPerM) / 1_000_000;
  const cacheSavedUsd = Math.max(0, fullCostWithoutCacheUsd - estimatedCostUsd);
  const cacheSavedPercent = fullCostWithoutCacheUsd > 0
    ? (cacheSavedUsd / fullCostWithoutCacheUsd) * 100
    : 0;

  return {
    tier: rate.tier,
    inputPerM: rate.inputPerM,
    cacheReadPerM: rate.cacheReadPerM,
    outputPerM: rate.outputPerM,
    estimatedCostUsd,
    fullCostWithoutCacheUsd,
    cacheSavedUsd,
    cacheSavedPercent,
  };
}
