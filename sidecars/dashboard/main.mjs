import { createServer } from 'node:http';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CAPACITY_PRESETS } from './lib/models.mjs';
import { computeConversationMetrics } from './lib/metrics.mjs';
import {
  isValidConversationId,
  resolveSidecarSdkUrl,
  resolveTimingsPath,
  resolveTranscriptPath,
} from './lib/paths.mjs';
import { readPreferences, writePreferences } from './lib/preferences.mjs';
import { readConversationTranscript, readHookTimings } from './lib/transcript.mjs';
import { computeUsageRollup } from './lib/usage-rollup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const ASSETS_DIR = join(__dirname, '..', '..', 'assets');

const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const STANDALONE_PRELOAD_JS = `(() => {
  const params = new URLSearchParams(window.location.search);
  window.sidecar = window.sidecar || {
    conversationId: params.get('conversationId') || '',
    projectId: '',
    fetch(url, opts = {}) {
      const headers = new Headers(opts.headers || {});
      if (opts.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      return fetch(url, { ...opts, headers });
    },
    getWorkspaceUris() { return []; },
    onWorkspaceChange() {},
  };
})();\n`;

function loadStaticFile(baseDir, filename, contentType, extraHeaders = {}) {
  const fullPath = join(baseDir, filename);
  if (!existsSync(fullPath)) {
    return {
      status: 404,
      contentType: 'text/plain; charset=utf-8',
      headers: SECURITY_HEADERS,
      body: 'Not Found',
    };
  }
  return {
    status: 200,
    contentType,
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
    body: readFileSync(fullPath, 'utf8'),
  };
}

function jsonReply(status, payload) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    headers: SECURITY_HEADERS,
    body: JSON.stringify(payload),
  };
}

/**
 * Pure request handler factory decoupled from HTTP/Sidecar transport for clean testing.
 */
export function createDashboardService({ env = process.env } = {}) {
  return {
    getPage(pathname) {
      switch (pathname) {
        case '/':
          return loadStaticFile(PUBLIC_DIR, 'index.html', 'text/html; charset=utf-8', {
            'Content-Security-Policy': CSP_HEADER,
          });
        case '/styles.css':
          return loadStaticFile(PUBLIC_DIR, 'styles.css', 'text/css; charset=utf-8');
        case '/app.js':
          return loadStaticFile(PUBLIC_DIR, 'app.js', 'application/javascript; charset=utf-8');
        case '/logo.svg':
          return loadStaticFile(ASSETS_DIR, 'logo.svg', 'image/svg+xml');
        default:
          return {
            status: 404,
            contentType: 'text/plain; charset=utf-8',
            headers: SECURITY_HEADERS,
            body: 'Not Found',
          };
      }
    },

    getMetrics(query = {}) {
      let explicitConv = null;
      if (query.conversationId !== undefined && query.conversationId !== '') {
        if (!isValidConversationId(query.conversationId)) {
          return jsonReply(400, { error: 'invalid_conversation_id' });
        }
        explicitConv = query.conversationId.trim();
      }

      const prefs = readPreferences(env);
      const rollup = computeUsageRollup({ env, persistCache: true });
      const envConv = isValidConversationId(env.ANTIGRAVITY_CONVERSATION_ID)
        ? env.ANTIGRAVITY_CONVERSATION_ID.trim()
        : null;
      // Auto-follow prefers the newest user-started conversation over background subagents.
      const newestUserConv = rollup.conversations.find((c) => c.kind === 'user') ?? rollup.conversations[0];
      const convId = explicitConv ?? envConv ?? newestUserConv?.conversationId ?? null;

      if (!convId) {
        const empty = computeConversationMetrics({
          conversationId: null,
          transcript: { exists: false, steps: [], transitions: [], checkpoints: [] },
          timings: { exists: false, windows: [] },
          capacityOverrides: prefs.capacityOverrides,
          calibration: rollup.calibration,
        });
        return jsonReply(200, {
          ...empty,
          preferences: prefs,
          capacityPresets: CAPACITY_PRESETS,
        });
      }

      const transcript = readConversationTranscript(resolveTranscriptPath(convId, env));
      const timings = readHookTimings(resolveTimingsPath(convId, env));
      const metrics = computeConversationMetrics({
        conversationId: convId,
        transcript,
        timings,
        capacityOverrides: prefs.capacityOverrides,
        calibration: rollup.calibration,
      });

      return jsonReply(200, {
        ...metrics,
        preferences: prefs,
        capacityPresets: CAPACITY_PRESETS,
      });
    },

    getConversations() {
      const rollup = computeUsageRollup({ env, persistCache: true, withHeaders: true });
      return jsonReply(200, {
        conversations: rollup.conversations,
      });
    },

    getHistory() {
      const { conversations, calibration, ...rest } = computeUsageRollup({ env, persistCache: true });
      return jsonReply(200, { ...rest, conversationCount: conversations.length });
    },

    getPreferences() {
      return jsonReply(200, readPreferences(env));
    },

    updatePreferences(body = {}) {
      const next = writePreferences(body, env);
      return jsonReply(200, next);
    },
  };
}

async function loadSidecarSdk(env) {
  try {
    return await import('sidecar_sdk');
  } catch {
    const fallbackPath = resolveSidecarSdkUrl(env);
    if (!fallbackPath) {
      throw new Error('Unable to resolve sidecar_sdk module.');
    }
    return await import(pathToFileURL(fallbackPath).href);
  }
}

function toSdkResponse(ResponseClass, result) {
  return new ResponseClass(result.body, {
    status: result.status,
    contentType: result.contentType,
    headers: result.headers,
  });
}

/**
 * Start either the official `SidecarApp` server (when managed by Antigravity)
 * or a localhost-only standalone HTTP server for local preview and testing.
 */
export async function startServer({ env = process.env, port } = {}) {
  const service = createDashboardService({ env });

  if (env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
    const { SidecarApp, Response: SdkResponse } = await loadSidecarSdk(env);
    const app = new SidecarApp();

    for (const path of ['/', '/styles.css', '/app.js', '/logo.svg']) {
      app.page(path, () => toSdkResponse(SdkResponse, service.getPage(path)));
    }

    app.api('/api/metrics', (data) => toSdkResponse(SdkResponse, service.getMetrics(data)), 'GET');
    app.api('/api/conversations', () => toSdkResponse(SdkResponse, service.getConversations()), 'GET');
    app.api('/api/history', () => toSdkResponse(SdkResponse, service.getHistory()), 'GET');
    app.api('/api/preferences', () => toSdkResponse(SdkResponse, service.getPreferences()), 'GET');
    app.api('/api/preferences', (data) => toSdkResponse(SdkResponse, service.updatePreferences(data)), 'POST');

    const server = app.run();
    return { mode: 'sidecar', app, server };
  }

  const listenPort = port !== undefined ? port : Number(env.PORT || 4789);
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/preload.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        ...SECURITY_HEADERS,
      });
      res.end(STANDALONE_PRELOAD_JS);
      return;
    }

    if (req.method === 'GET' && ['/', '/styles.css', '/app.js', '/logo.svg'].includes(url.pathname)) {
      const page = service.getPage(url.pathname);
      res.writeHead(page.status, { 'Content-Type': page.contentType, ...page.headers });
      res.end(page.body);
      return;
    }

    const sendReply = (reply) => {
      res.writeHead(reply.status, { 'Content-Type': reply.contentType, ...reply.headers });
      res.end(reply.body);
    };

    if (req.method === 'GET') {
      const query = Object.fromEntries(url.searchParams.entries());
      if (url.pathname === '/api/metrics') return sendReply(service.getMetrics(query));
      if (url.pathname === '/api/conversations') return sendReply(service.getConversations());
      if (url.pathname === '/api/history') return sendReply(service.getHistory());
      if (url.pathname === '/api/preferences') return sendReply(service.getPreferences());
    }

    if (req.method === 'POST' && url.pathname === '/api/preferences') {
      let body = '';
      let aborted = false;
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 16384) {
          aborted = true;
          sendReply(jsonReply(413, { error: 'payload_too_large' }));
          req.destroy();
        }
      });
      req.on('end', () => {
        if (aborted) return;
        try {
          const parsed = body.trim() ? JSON.parse(body) : {};
          sendReply(service.updatePreferences(parsed));
        } catch {
          sendReply(jsonReply(400, { error: 'invalid_json' }));
        }
      });
      return;
    }

    sendReply(jsonReply(404, { error: 'not_found' }));
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(listenPort, '127.0.0.1', () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort;
  return { mode: 'standalone', server, port: actualPort };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  startServer()
    .then((started) => {
      if (started.mode === 'standalone') {
        console.log(`AGY Context Monitor standalone dashboard: http://127.0.0.1:${started.port}`);
      }
    })
    .catch((err) => {
      console.error('Failed to start AGY Context Monitor sidecar:', err);
      process.exit(1);
    });
}
