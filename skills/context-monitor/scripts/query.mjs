import { createDashboardService } from '../../../sidecars/dashboard/main.mjs';

function parseArgs(argv) {
  const opts = {
    conversationId: '',
    includeHistory: false,
    stepLimit: 10,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--history' || arg === '-H') {
      opts.includeHistory = true;
    } else if ((arg === '--conversation' || arg === '-c') && argv[i + 1]) {
      opts.conversationId = argv[++i];
    } else if (arg.startsWith('--conversation=')) {
      opts.conversationId = arg.slice('--conversation='.length);
    } else if ((arg === '--steps' || arg === '-s') && argv[i + 1] !== undefined) {
      const parsed = Number.parseInt(argv[++i], 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        opts.stepLimit = Math.min(80, parsed);
      }
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const service = createDashboardService({ env: process.env });
  const result = {};

  const query = opts.conversationId ? { conversationId: opts.conversationId } : {};
  const metricsReply = service.getMetrics(query);
  if (metricsReply.status !== 200) {
    process.stderr.write(`${metricsReply.body}\n`);
    process.exit(1);
  }

  const metrics = JSON.parse(metricsReply.body);
  const { preferences, capacityPresets, steps, ...coreMetrics } = metrics;
  result.session = {
    ...coreMetrics,
    recentSteps: (steps || []).slice(-opts.stepLimit),
  };

  if (opts.includeHistory) {
    const histReply = service.getHistory();
    if (histReply.status === 200) {
      const hist = JSON.parse(histReply.body);
      result.history = {
        timezone: hist.timezone,
        conversationCount: hist.conversationCount,
        totals: hist.totals,
        bySurface: hist.bySurface,
        byModel: hist.byModel,
        byWorkspace: hist.byWorkspace,
        recent7d: (hist.daily || []).slice(-7),
      };
    }
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
