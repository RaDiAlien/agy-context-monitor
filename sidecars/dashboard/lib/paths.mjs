import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const PLUGIN_ID = 'agy-context-monitor';
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KNOWN_SURFACE_DIRS = [
  { dirName: 'antigravity', surface: 'desktop' },
  { dirName: 'antigravity-ide', surface: 'ide' },
  { dirName: 'antigravity-cli', surface: 'cli' },
];

/**
 * Validate whether a string is a UUID conversation identifier.
 * Rejecting non-UUID values protects transcript and timing file lookups from path traversal.
 */
export function isValidConversationId(value) {
  return typeof value === 'string' && GUID_RE.test(value.trim());
}

/**
 * Infer the Antigravity product surface (`desktop` | `ide` | `cli`) from a path.
 */
export function resolveSurfaceFromPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return 'desktop';
  const normalized = filePath.replace(/\\/g, '/');
  if (/(?:^|\/)antigravity-cli(?:\/|$)/.test(normalized)) return 'cli';
  if (/(?:^|\/)antigravity-ide(?:\/|$)/.test(normalized)) return 'ide';
  return 'desktop';
}

/**
 * Extract a privacy-safe workspace folder basename from a path or `file://` URI.
 * Never retains parent user directories or query strings.
 */
export function sanitizeWorkspaceName(raw) {
  if (typeof raw !== 'string') return null;
  let cleaned = raw.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith('file://')) {
    try {
      cleaned = decodeURIComponent(new URL(cleaned).pathname);
    } catch {
      cleaned = cleaned.replace(/^file:\/\/+/, '/');
    }
  }
  cleaned = cleaned.replace(/[\\/]+$/, '');
  if (!cleaned) return null;
  const base = basename(cleaned)
    .replace(/[\u0000-\u001f\u007f/\\]/g, '')
    .trim();
  if (!base || base === '.' || base === '..') return null;
  return Array.from(base).slice(0, 48).join('');
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
 * Discover all Antigravity product appData directories (`antigravity`, `antigravity-ide`, `antigravity-cli`).
 * When `ANTIGRAVITY_APP_DATA_DIR` is explicitly set (e.g. isolated unit tests), only that directory
 * is returned unless `ANTIGRAVITY_GEMINI_ROOT` is also set.
 */
export function resolveAllAppDataRoots(env = process.env) {
  const primary = resolveAppDataDir(env);
  const seen = new Set([primary]);
  const roots = [{ surface: resolveSurfaceFromPath(primary), appDataDir: primary }];

  if (env.ANTIGRAVITY_APP_DATA_DIR && !env.ANTIGRAVITY_GEMINI_ROOT) {
    return roots;
  }

  const geminiRoot = env.ANTIGRAVITY_GEMINI_ROOT
    ? resolve(env.ANTIGRAVITY_GEMINI_ROOT)
    : dirname(primary);

  for (const { dirName, surface } of KNOWN_SURFACE_DIRS) {
    const candidate = join(geminiRoot, dirName);
    if (seen.has(candidate)) continue;
    if (existsSync(join(candidate, 'brain'))) {
      seen.add(candidate);
      roots.push({ surface, appDataDir: candidate });
    }
  }

  return roots;
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
  const id = conversationId.trim();
  const primaryPath = join(resolveBrainDir(env), id, '.system_generated', 'logs', 'transcript.jsonl');
  if (existsSync(primaryPath)) {
    return primaryPath;
  }
  for (const root of resolveAllAppDataRoots(env)) {
    const candidate = join(root.appDataDir, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return primaryPath;
}

export function resolveTimingsPath(conversationId, env = process.env) {
  if (!isValidConversationId(conversationId)) {
    throw new RangeError(`Invalid conversationId: ${String(conversationId)}`);
  }
  const id = conversationId.trim();
  const primaryPath = join(resolvePluginDataDir(env), 'timings', `${id}.jsonl`);
  if (existsSync(primaryPath)) {
    return primaryPath;
  }
  for (const root of resolveAllAppDataRoots(env)) {
    const candidate = join(root.appDataDir, 'plugin_data', PLUGIN_ID, 'timings', `${id}.jsonl`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return primaryPath;
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
