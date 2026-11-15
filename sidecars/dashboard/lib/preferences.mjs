import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isValidModelKey, isValidPresetId } from './models.mjs';
import { resolvePreferencesPath } from './paths.mjs';

const VALID_LOCALES = new Set(['zh-CN', 'en']);
const MAX_OVERRIDES = 32;

export const DEFAULT_PREFERENCES = Object.freeze({
  locale: 'zh-CN',
  capacityOverrides: Object.freeze({}),
});

function sanitizeOverrides(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, preset] of Object.entries(input).slice(0, MAX_OVERRIDES)) {
    if (isValidModelKey(key) && isValidPresetId(preset) && preset !== 'auto') {
      out[key] = preset;
    }
  }
  return out;
}

/**
 * Preferences schema v2: window overrides are stored per model family (`capacityOverrides[modelKey]`)
 * instead of one global preset, so pinning Claude to 200K never affects Gemini sessions.
 * The legacy global `capacityPreset` field is dropped on read.
 */
export function sanitizePreferences(input) {
  const obj = input && typeof input === 'object' ? input : {};
  return {
    locale: VALID_LOCALES.has(obj.locale) ? obj.locale : DEFAULT_PREFERENCES.locale,
    capacityOverrides: sanitizeOverrides(obj.capacityOverrides),
  };
}

export function readPreferences(env = process.env) {
  const filePath = resolvePreferencesPath(env);
  try {
    if (!existsSync(filePath)) {
      return sanitizePreferences({});
    }
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return sanitizePreferences(raw);
  } catch {
    return sanitizePreferences({});
  }
}

/**
 * Apply a patch: `{ locale }` and/or `{ capacityOverride: { modelKey, preset } }`
 * (`preset: 'auto'` removes the override for that model).
 */
export function writePreferences(patch, env = process.env) {
  const current = readPreferences(env);
  const body = patch && typeof patch === 'object' ? patch : {};
  const next = {
    locale: body.locale ?? current.locale,
    capacityOverrides: { ...current.capacityOverrides },
  };

  const override = body.capacityOverride;
  if (override && typeof override === 'object' && isValidModelKey(override.modelKey) && isValidPresetId(override.preset)) {
    if (override.preset === 'auto') {
      delete next.capacityOverrides[override.modelKey];
    } else {
      next.capacityOverrides[override.modelKey] = override.preset;
    }
  }

  const sanitized = sanitizePreferences(next);
  const filePath = resolvePreferencesPath(env);
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(sanitized, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, filePath);
  return sanitized;
}
