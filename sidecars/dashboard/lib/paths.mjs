import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const PLUGIN_ID = 'agy-context-monitor';
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate whether a string is a UUID conversation identifier.
 * Rejecting non-UUID values protects transcript and timing file lookups from path traversal.
 */
export function isValidConversationId(value) {
  return typeof value === 'string' && GUID_RE.test(value.trim());
}

/**
 * Resolve Antigravity's root appData directory (e.g. `~/.gemini/antigravity`).
 * Checks explicit overrides first, then walks up from `ANTIGRAVITY_EXECUTABLE_DATA_DIR`
 * matching the official pattern (`<appData>/sidecar_data/<plugin>/<sidecar>/data`).
 */
export function resolveAppDataDir(env = process.env) {
  if (env.ANTIGRAVITY_APP_DATA_DIR) {
    return resolve(env.ANTIGRAVITY_APP_DATA_DIR);
  }

  const sidecarData = env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (sidecarData) {
    let cursor = resolve(sidecarData);
    for (let depth = 0; depth < 8; depth++) {
      if (basename(cursor) === 'sidecar_data') {
        return dirname(cursor);
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }

  return join(homedir(), '.gemini', 'antigravity');
}

/**
 * Resolve persistent plugin data storage directory (`<appData>/plugin_data/<plugin>`).
 */
export function resolvePluginDataDir(env = process.env, pluginId = PLUGIN_ID) {
  if (env.PLUGIN_DATA) {
    return resolve(env.PLUGIN_DATA);
  }
  return join(resolveAppDataDir(env), 'plugin_data', pluginId);
}

export function resolveBrainDir(env = process.env) {
  return join(resolveAppDataDir(env), 'brain');
}

export function resolveTranscriptPath(conversationId, env = process.env) {
  if (!isValidConversationId(conversationId)) {
    throw new RangeError(`Invalid conversationId: ${String(conversationId)}`);
  }
  return join(resolveBrainDir(env), conversationId.trim(), '.system_generated', 'logs', 'transcript.jsonl');
}

export function resolveTimingsPath(conversationId, env = process.env) {
  if (!isValidConversationId(conversationId)) {
    throw new RangeError(`Invalid conversationId: ${String(conversationId)}`);
  }
  return join(resolvePluginDataDir(env), 'timings', `${conversationId.trim()}.jsonl`);
}

export function resolvePreferencesPath(env = process.env) {
  return join(resolvePluginDataDir(env), 'preferences.json');
}

export function resolveUsageCachePath(env = process.env) {
  return join(resolvePluginDataDir(env), 'usage-cache.json');
}

/**
 * Locate the official Antigravity `sidecar_sdk` entrypoint if available.
 */
export function resolveSidecarSdkUrl(env = process.env) {
  const candidates = [
    env.SIDECAR_SDK_PATH,
    join(resolveAppDataDir(env), 'lib', 'node_modules', 'sidecar_sdk', 'index.mjs'),
    join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'index.mjs'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
