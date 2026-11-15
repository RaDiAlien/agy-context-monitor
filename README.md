# AGY Context Monitor

Clean, zero-dependency, maintainable context-window and observed TPS monitor plugin for Google Antigravity 2.x.

## Design Philosophy (Official Contract Only)

Unlike DOM-injection or internal Language Server RPC probing tools (`app.asar` patching / `DevToolsActivePort` / undocumented gRPC endpoints), **AGY Context Monitor** uses exclusively documented Antigravity 2.x plugin interfaces:

1. **Plugin & Auxiliary Sidecar UI** (`plugin.json` + `sidecars/dashboard/sidecar.json` + `sidecar_sdk`):
   Renders cleanly inside Antigravity's native auxiliary side pane (`SIDECAR_UI_ENTRYPOINT_AUX_PANE`) and syncs automatically with Antigravity light/dark theme CSS variables.
2. **Session Transcript Telemetry** (`~/.gemini/antigravity/brain/<conversationId>/.system_generated/logs/transcript.jsonl`):
   Reads documented token accounting (`input_tokens`, `cache_read_tokens`, `output_tokens`), step status, `CHECKPOINT` compaction summaries, tool call counts, and `<USER_SETTINGS_CHANGE>` model switches.
   - `contextUsedTokens = input_tokens + cache_read_tokens + output_tokens` (uncached input + cached prompt prefix + retained step output)
   - `cacheHitRate = cache_read_tokens / (input_tokens + cache_read_tokens)`
   - **Effective Window Calibration vs. Nominal Spec**: Official model specs (e.g., `1M` for Gemini 4 / Claude 5.5) exceed Antigravity's host compaction ceilings (`256K` = `262,144` for Gemini 4 Hydrogen/Carbon/Flash, `128K` = `131,072` for Gemini 4 Argon/GPT-OSS 120B, `200K` for Claude). Because `contextWindowMetadata` is only exposed on undocumented Language Server RPCs (intentionally avoided here), `Auto` mode calibrates against Antigravity host effective windows and learns from real `CHECKPOINT` compaction triggers in `transcript.jsonl` while displaying the upstream nominal spec separately.
3. **Lifecycle Hooks for No-Tool Timing** (`hooks.json` -> `hooks/run-hook.sh` -> `hooks/record-timing.mjs`):
   Records lightweight invocation timestamps (`PreInvocation`, `PostInvocation`, `Stop`) into `~/.gemini/antigravity/plugin_data/agy-context-monitor/timings/<conversationId>.jsonl` so final text responses without tool calls get millisecond latency measurements without ever subtracting human idle time before the next `USER_INPUT`.

> **Note on Timing & Quota Scope**
> - Observed TPS reflects end-to-end step generation speed (`output_tokens / elapsedSec`), including model reasoning/TTFT when included in the invocation step duration, rather than split raw network chunk decode speed.
> - Account-level 5h/weekly quota bars are intentionally omitted because Antigravity does not expose a documented plugin API for billing quotas.
> - No raw prompt, user message, or thinking text is ever cached, logged by hooks, or served via HTTP APIs. The only exception is the conversation picker title: the first line of the first user request (max 28 chars) is read from the transcript head into process memory for display and is never written to the usage cache or any file.

## What the dashboard shows (and how it decides)

| Feature | Behaviour |
|---|---|
| **Model name** | Transcript `Model Selection` switches first (exact display names). Hook model ids are only a fallback, are prettified (`claude-opus-5-5-high` → `Claude Opus 5.5 (High)`), and internal worker ids (`*-worker-*`, `*-agy`) are ignored. Conversations that never switched inherit the global selection at their start time (marked "inferred"). |
| **Compaction** | `CHECKPOINT` steps preceded by a `/compact` user request are **manual**: shown separately and never used to calibrate the window. Only automatic compactions calibrate `Auto` capacity. |
| **Window override** | Stored **per model family** (`capacityOverrides[modelKey]`), so pinning Claude to 200K never affects Gemini conversations. Collapsed under "⚙ Window" in the context card. |
| **Model switch** | If the model changes after the latest measured call and the context exceeds the new window, the dashboard warns that the next call will compact instead of silently "expanding" the window. |
| **Forecast** | "~N more turns (≈ M model calls) before auto-compaction", from the mean growth per call (last 12) and the median growth per completed user turn (last 5); deltas never span a compaction. |
| **Usage numbers** | Headline numbers are **fresh input + output**; cache reads are listed separately because they re-count the whole context on every call. |
| **Conversation picker** | Grouped into "My conversations" and "Subagents / background" (transcripts that start with a `SYSTEM_MESSAGE`); subagents show the title of the user conversation that spawned them. |

## Directory Layout

```text
agy-context-monitor/
├── plugin.json                      # Antigravity plugin manifest
├── hooks.json                       # PreInvocation, PostInvocation, Stop hooks
├── assets/logo.svg                  # Transparent light/dark adaptive plugin icon
├── hooks/
│   ├── run-hook.sh                  # Portable macOS/Unix Node locator with fail-safe JSON output
│   └── record-timing.mjs            # Fail-safe lifecycle timestamp recorder
├── sidecars/dashboard/
│   ├── sidecar.json                 # Aux-pane sidecar registration
│   ├── main.mjs                     # SidecarApp / 127.0.0.1 standalone server
│   ├── lib/
│   │   ├── paths.mjs                # AppData / sidecar_data / UUID validation
│   │   ├── models.mjs               # Model capacity rules, presets, switch parser
│   │   ├── transcript.mjs           # Mtime/size cached JSONL parser & hook pairing
│   │   ├── metrics.mjs              # Context, cache hit, MAD outlier filter & TPS metrics
│   │   ├── usage-rollup.mjs         # Incremental UTC+8 30-day & per-model rollup
│   │   └── preferences.mjs          # Persisted per-model window overrides & locale
│   └── public/                      # CSP-strict zero-dependency web dashboard
├── scripts/install.mjs              # Install / uninstall / status utility
└── tests/                           # Node native test runner suite
```

## Commands

```bash
# Clone & install into Antigravity (~/.gemini/config/plugins/agy-context-monitor)
git clone https://github.com/RaDiAlien/agy-context-monitor.git
cd agy-context-monitor
npm run install-plugin

# Run unit & integration tests
npm test

# Check install status
npm run status

# Uninstall plugin (add -- --purge-data to also delete plugin_data)
npm run uninstall-plugin

# Run standalone dashboard preview in a browser (http://127.0.0.1:4789)
npm start
```
