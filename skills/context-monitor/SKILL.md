---
name: context-monitor
description: Inspects real-time context window usage, calibrated compaction capacity, prompt cache hit rate and cache busts, observed output TPS, subagent token rollup, and 30-day usage/cost telemetry across models and workspaces via AGY Context Monitor. Use when the user asks about context usage, remaining turns before compaction, cache hit rate, step latency/TPS, token consumption, or estimated API cost.
---

# AGY Context Monitor (`context-monitor`)

Query calibrated session and 30-day token telemetry directly from the `agy-context-monitor` engine instead of manually summing raw `transcript.jsonl` lines.

## Running Telemetry Queries

Run `scripts/query.mjs` located next to this `SKILL.md` file (replace `<SKILL_DIR>` with the folder containing this `SKILL.md`, and `<CONVERSATION_ID>` with the active `Conversation ID` from `<user_information>`):

```bash
# Current conversation context window, cache hit/busts, TPS, subagent tree, and cost:
node "<SKILL_DIR>/scripts/query.mjs" --conversation "<CONVERSATION_ID>"

# Include 30-day UTC+8 usage, cost & cache savings across models, workspaces, and surfaces (Desktop / IDE / CLI):
node "<SKILL_DIR>/scripts/query.mjs" --conversation "<CONVERSATION_ID>" --history

# Inspect more step-by-step latency & cache rows (up to 80):
node "<SKILL_DIR>/scripts/query.mjs" --conversation "<CONVERSATION_ID>" --steps 25
```

## Interpreting Key Fields

- **`session.model` & `session.context`**:
  - `capacityTokens` (`capacitySource`) reflects Antigravity's **actual host compaction window** (or checkpoint-calibrated ceiling), while `providerCapacityLabel` shows the nominal upstream spec when different.
  - `usedTokens = uncachedTokens + cachedTokens + outputTokensLastStep`.
  - `lastStepCacheBust` (`ttl-expired` | `model-switch` | `prefix-invalidated`) indicates why the latest call missed the prompt cache.
- **`session.forecast`**: Estimated remaining `turnsRemaining` and `stepsRemaining` before auto-compaction based on recent context growth.
- **`session.tps`**: End-to-end observed output speed (`recentTps`, `latestTps`, `sessionTps`) combining multi-tool transcript timestamps and no-tool hook timings, with MAD spike filtering.
- **`session.subagents`**: Aggregated token and cost usage from child subagents / swarm workers spawned by the root conversation.
- **`session.sessionTotals.cost` & `history.totals`**: Reference USD equivalents and prompt-cache savings (`estimatedCostUsd`, `cacheSavedUsd`).

## Presenting Results

1. Present headline metrics concisely (**Context used / Cap**, **Cache hit rate**, **Forecast**, **Observed TPS**, and **Fresh tokens = uncached input + output**).
2. Include a one-click side-pane pill so the user can open the live dashboard inside Antigravity:
   `[Context & TPS](sidecar://agy-context-monitor/dashboard/)`
