(() => {
  const I18N = {
    'zh-CN': {
      title: '上下文与速率',
      refresh: '刷新',
      followCurrent: '回到当前',
      jumpConv: '↗ 跳转',
      tabLive: '实时',
      tabSteps: '步骤',
      tabHistory: '30天统计',
      cached: '缓存',
      cachedHint: '本次调用中命中缓存的输入（来自之前的对话）',
      uncached: '新增',
      uncachedHint: '本次调用中未命中缓存的输入（新消息、工具结果等）',
      stepOut: '本步输出',
      stepOutHint: '最近一次模型调用的输出，下一次调用会计入上下文',
      capacity: '上限',
      specLabel: '标称',
      autoFollow: '⚡ 自动跟随最新会话',
      groupMine: '我的会话',
      groupAgents: '子代理 / 后台任务',
      agentPrefix: '↳ 子代理',
      inferredSuffix: '（推断）',
      inferredTitle: '本会话没有记录模型切换，按会话开始时的全局模型选择推断',
      agentModel: '子代理（模型未记录）',
      contextUsed: '上下文已用',
      remaining: '距离压缩',
      cacheHitRate: '本步缓存命中',
      windowAuto: '窗口上限 · 自动',
      windowManual: '窗口上限 · 手动',
      windowNote: '只对 {model} 生效；选“自动”恢复按宿主窗口和压缩实测判断。',
      windowNoteUnknown: '模型未识别：设置会对所有未识别模型生效。',
      autoPreset: '自动',
      chatHintsLabel: '会话内提示（0 模型 Token）：',
      pillToggleOn: '💬 新会话入口 · 开',
      pillToggleOff: '💬 新会话入口 · 关',
      alertToggleOn: '🔔 85% 预警 · 开',
      alertToggleOff: '🔔 85% 预警 · 关',
      observedTps: '生成速率',
      recentHint: '近 5 个有效步的加权平均',
      latestTps: '最新一步',
      sessionTps: '会话平均',
      measuredSteps: '有效采样',
      sessionTotals: '本会话用量',
      freshUnit: '新输入+输出',
      freshHint: '不含缓存读取（缓存通常按折扣计费）',
      outputTokens: '输出',
      cacheReads: '缓存读取',
      plannerSteps: '模型调用',
      subagentsTotal: '子代理汇总',
      estApiCost: '等效 API',
      tpsTrend: '速率趋势（最近有效步）',
      stepBreakdown: '每次模型调用',
      stepsHint: '一次模型调用 = 模型生成一次回复（含一轮工具调用）。🔧 表示调用了工具，⚡ 表示缓存失效重算。',
      colContext: '上下文',
      colCache: '缓存',
      colOutput: '输出',
      colTime: '耗时',
      colFresh: '新输入+输出',
      colCost: '估算',
      colWorkspace: '项目',
      colConvs: '会话',
      noSteps: '暂无模型响应步骤',
      todayUtc8: '今日',
      last7d: '近 7 天',
      last30d: '近 30 天',
      historyHint: '主数字 = 新输入 + 输出；金额为按公开 API 单价折算的等效参考值。日期按 UTC+8 划分。',
      dailyChart: '近 30 天 新输入+输出',
      byModel: '按模型汇总',
      byWorkspace: '按项目汇总',
      colModel: '模型',
      colSteps: '调用',
      noteHooksActive: '计时说明：带工具的步骤按 transcript 时间戳计时，纯文本回复按 Hook 精确计时；速率是端到端观测值。',
      noteHooksInactive: '计时说明：本会话没有 Hook 计时记录（插件安装后的新回合才有），目前只统计带工具的步骤。',
      noData: '暂无有效耗时样本',
      sourceCheckpoint: '压缩实测',
      sourceEffectiveModel: '宿主窗口',
      sourceObservedGrowth: '动态扩容',
      sourcePreset: '手动覆盖',
      sourceDefault: '默认',
      sourceTitleCheckpoint: '根据本模型历史上的自动压缩点校准',
      sourceTitleEffectiveModel: 'Antigravity 对该模型的实际会话窗口（不是厂商标称值）',
      sourceTitleObservedGrowth: '实际用量超过了已知窗口，已自动上调',
      sourceTitlePreset: '你为该模型手动指定的窗口上限',
      sourceTitleDefault: '未识别模型，按 256K 估算',
      reasons: {
        'no-hook-timing': '无计时',
        'no-end-timestamp': '无结束时间',
        'too-short': '过短',
        'too-long': '过长',
        'low-output': '输出过少',
        outlier: '异常值',
      },
      cacheBustReasons: {
        'ttl-expired': '闲置超时（>5分钟），提示词缓存过期重算',
        'model-switch': '切换模型导致缓存重算',
        'prefix-invalidated': '上下文前缀变更，缓存未命中重算',
      },
      timingSources: { transcript: '按 transcript 时间戳', hook: '按 Hook 计时', unavailable: '无计时' },
      days: '天',
      convs: '个会话',
      activeDaysFmt: '活跃 {n} 天\n≈ {cost}',
      todaySubFmt: '输出 {out} · 缓存 {cache}\n≈ {cost}',
      convCountFmt: '{n} 个会话\n≈ {cost}{saved}',
      inferredModelsNote: '* 部分调用按全局模型选择或子代理继承关系推断；↳ 数字表示其中来自子代理 / Swarm 的调用数。',
      agentsNote: '仅父会话已删除且无 Hook 记录的孤立子代理会归入“模型未记录”。',
    },
    en: {
      title: 'Context & TPS',
      refresh: 'Refresh',
      followCurrent: 'Current',
      jumpConv: '↗ Open',
      tabLive: 'Live',
      tabSteps: 'Steps',
      tabHistory: '30d Usage',
      cached: 'Cached',
      cachedHint: 'Input served from cache in the latest call (earlier conversation)',
      uncached: 'Fresh',
      uncachedHint: 'Input not served from cache (new messages, tool results, ...)',
      stepOut: 'Step out',
      stepOutHint: 'Output of the latest call; it joins the context on the next call',
      capacity: 'Cap',
      specLabel: 'spec',
      autoFollow: '⚡ Follow newest conversation',
      groupMine: 'My conversations',
      groupAgents: 'Subagents / background',
      agentPrefix: '↳ Subagent',
      inferredSuffix: ' (inferred)',
      inferredTitle: 'No model switch recorded here; inferred from the global model selection when the conversation started',
      agentModel: 'Subagent (model not recorded)',
      contextUsed: 'Context used',
      remaining: 'Until compaction',
      cacheHitRate: 'Step cache hit',
      windowAuto: 'Window · Auto',
      windowManual: 'Window · Manual',
      windowNote: 'Applies to {model} only. Pick "Auto" to go back to host window + compaction calibration.',
      windowNoteUnknown: 'Model not recognized: this applies to all unrecognized models.',
      autoPreset: 'Auto',
      chatHintsLabel: 'In-chat hints (0 model tokens):',
      pillToggleOn: '💬 Session pill · On',
      pillToggleOff: '💬 Session pill · Off',
      alertToggleOn: '🔔 85% alert · On',
      alertToggleOff: '🔔 85% alert · Off',
      observedTps: 'Output speed',
      recentHint: 'Weighted over the last 5 valid steps',
      latestTps: 'Latest step',
      sessionTps: 'Session avg',
      measuredSteps: 'Measured',
      sessionTotals: 'This conversation',
      freshUnit: 'fresh in+out',
      freshHint: 'Excludes cache reads (usually billed at a discount)',
      outputTokens: 'Output',
      cacheReads: 'Cache reads',
      plannerSteps: 'Model calls',
      subagentsTotal: 'Subagents',
      estApiCost: 'Est. API',
      tpsTrend: 'Speed trend (recent valid steps)',
      stepBreakdown: 'Model calls',
      stepsHint: 'One model call = one model response (incl. one round of tool calls). 🔧 marks tool calls, ⚡ marks cache busts.',
      colContext: 'Context',
      colCache: 'Cache',
      colOutput: 'Out',
      colTime: 'Time',
      colFresh: 'Fresh in+out',
      colCost: 'Est.',
      colWorkspace: 'Workspace',
      colConvs: 'Convs',
      noSteps: 'No model response steps yet',
      todayUtc8: 'Today',
      last7d: 'Last 7d',
      last30d: 'Last 30d',
      historyHint: 'Main numbers = fresh input + output; USD values are reference API estimates. Days in UTC+8.',
      dailyChart: '30-day fresh input + output',
      byModel: 'By model',
      byWorkspace: 'By workspace',
      colModel: 'Model',
      colSteps: 'Calls',
      noteHooksActive: 'Timing: tool steps use transcript timestamps, text-only replies use hook timings; speeds are end-to-end observations.',
      noteHooksInactive: 'Timing: no hook log for this conversation yet (only new turns after install), so only tool steps are measured.',
      noData: 'No measured samples yet',
      sourceCheckpoint: 'Calibrated',
      sourceEffectiveModel: 'Host window',
      sourceObservedGrowth: 'Expanded',
      sourcePreset: 'Manual',
      sourceDefault: 'Default',
      sourceTitleCheckpoint: 'Calibrated from past automatic compactions of this model',
      sourceTitleEffectiveModel: 'Actual Antigravity session window for this model (not the provider spec)',
      sourceTitleObservedGrowth: 'Usage exceeded the known window, so it was raised',
      sourceTitlePreset: 'Window you pinned manually for this model',
      sourceTitleDefault: 'Unrecognized model, assuming 256K',
      reasons: {
        'no-hook-timing': 'no timing',
        'no-end-timestamp': 'no end time',
        'too-short': 'too short',
        'too-long': 'too long',
        'low-output': 'low output',
        outlier: 'outlier',
      },
      cacheBustReasons: {
        'ttl-expired': 'Idle >5m: prompt cache TTL expired and recomputed',
        'model-switch': 'Model switch caused prompt cache recomputation',
        'prefix-invalidated': 'Prompt prefix changed; cache miss recomputation',
      },
      timingSources: { transcript: 'transcript timestamps', hook: 'hook timing', unavailable: 'no timing' },
      days: 'days',
      convs: 'convs',
      activeDaysFmt: '{n} active days\n≈ {cost}',
      todaySubFmt: 'out {out} · cache {cache}\n≈ {cost}',
      convCountFmt: '{n} convs\n≈ {cost}{saved}',
      inferredModelsNote: '* Some calls are inferred from global selection or subagent inheritance; ↳ marks subagent / swarm calls.',
      agentsNote: 'Only orphan subagents without parent spawn records or hook logs remain unattributed.',
    },
  };

  const AGENT_MODEL_LABEL = '__agents__';
  const AUTO_FOLLOW_VAL = '__auto__';
  const hostConvId = window.sidecar?.conversationId || '';

  const state = {
    locale: 'zh-CN',
    activeTab: 'live',
    selectedConvId: hostConvId || AUTO_FOLLOW_VAL,
    userPinnedConv: false,
    hostConvId,
    latestMetrics: null,
    pollTimer: null,
    convRefreshCounter: 0,
  };

  const $ = (id) => document.getElementById(id);

  function t(key) {
    return (I18N[state.locale] && I18N[state.locale][key]) ?? I18N.en[key] ?? key;
  }

  function fmt(key, vars) {
    return String(t(key)).replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? ''));
  }

  function isZh() {
    return state.locale === 'zh-CN';
  }

  function applyLocaleTexts() {
    document.documentElement.lang = state.locale;
    for (const el of document.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n);
    }
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle);
    }
    $('btn-locale').textContent = isZh() ? 'EN' : '中文';
  }

  function formatTokens(num) {
    if (!Number.isFinite(num)) return '0';
    const abs = Math.abs(num);
    if (abs >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${(num / 1_000).toFixed(1)}K`;
    if (abs >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
    return String(Math.round(num));
  }

  function formatUsd(amount) {
    const val = Number(amount) || 0;
    if (val <= 0) return '$0.00';
    if (val < 0.01) return '<$0.01';
    if (val < 10) return `$${val.toFixed(2)}`;
    return `$${val.toFixed(1)}`;
  }

  function formatRelative(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const diffSec = Math.max(0, (Date.now() - ms) / 1000);
    if (diffSec < 60) return isZh() ? '刚刚' : 'just now';
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return isZh() ? `${mins} 分钟前` : `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return isZh() ? `${hours} 小时前` : `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return isZh() ? `${days} 天前` : `${days}d ago`;
  }

  function displayModel(name) {
    if (!name || name === 'Unknown') return isZh() ? '未知模型' : 'Unknown';
    if (name === AGENT_MODEL_LABEL) return t('agentModel');
    return name;
  }

  function syncThemePolarity() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, var(--bg, #f6f8fb))';
    document.documentElement.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();

    const nums = (computed.match(/[\d.]+/g) || []).map(Number);
    if (nums.length < 3) return;
    const scale = computed.startsWith('color(') ? 1 : 255;
    const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    document.documentElement.dataset.theme = lum < 0.5 ? 'dark' : 'light';
  }

  const themeObserver = new MutationObserver(() => syncThemePolarity());
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  window.addEventListener('message', (event) => {
    if (event?.data?.type === 'theme-change') {
      requestAnimationFrame(syncThemePolarity);
    }
  });

  async function apiFetch(url, options) {
    if (window.sidecar?.fetch) {
      return window.sidecar.fetch(url, options);
    }
    return fetch(url, options);
  }

  // ---------------------------------------------------------------- charts

  const svgNs = 'http://www.w3.org/2000/svg';

  function renderSparkline(series) {
    const box = $('tps-chart-box');
    box.textContent = '';

    if (!series || series.length === 0) {
      $('tps-range-label').textContent = '--';
      const msg = document.createElement('div');
      msg.className = 'empty-msg';
      msg.textContent = t('noData');
      box.appendChild(msg);
      return;
    }

    const values = series.map((s) => s.tps);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const span = Math.max(1, maxVal - minVal);
    $('tps-range-label').textContent = `${minVal.toFixed(0)}–${maxVal.toFixed(0)} tok/s`;

    const width = 320;
    const height = 72;
    const padX = 8;
    const padY = 10;

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const points = series.map((item, idx) => {
      const x = series.length === 1
        ? width / 2
        : padX + (idx / (series.length - 1)) * (width - padX * 2);
      const norm = series.length === 1 ? 0.5 : (item.tps - minVal) / span;
      const y = height - padY - norm * (height - padY * 2);
      return { x, y, item };
    });

    if (points.length > 1) {
      const area = document.createElementNS(svgNs, 'polygon');
      area.setAttribute('points', [
        `${points[0].x},${height - padY}`,
        ...points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
        `${points[points.length - 1].x},${height - padY}`,
      ].join(' '));
      area.setAttribute('fill', 'var(--accent)');
      area.setAttribute('opacity', '0.12');
      svg.appendChild(area);

      const line = document.createElementNS(svgNs, 'polyline');
      line.setAttribute('points', points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', 'var(--accent)');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    }

    const sources = t('timingSources');
    points.forEach((p, i) => {
      const dot = document.createElementNS(svgNs, 'circle');
      dot.setAttribute('cx', p.x.toFixed(1));
      dot.setAttribute('cy', p.y.toFixed(1));
      dot.setAttribute('r', i === points.length - 1 ? '3.5' : '2');
      dot.setAttribute('fill', i === points.length - 1 ? 'var(--ok)' : 'var(--accent)');
      const title = document.createElementNS(svgNs, 'title');
      title.textContent = `#${p.item.stepIndex}: ${p.item.tps} tok/s (${p.item.outputTokens} tok / ${p.item.elapsedSec}s, ${sources[p.item.timingSource] || p.item.timingSource})`;
      dot.appendChild(title);
      svg.appendChild(dot);
    });

    box.appendChild(svg);
  }

  function renderDailyChart(daily) {
    const box = $('history-chart-box');
    box.textContent = '';
    if (!daily || daily.length === 0) return;

    const maxFresh = Math.max(1, ...daily.map((d) => d.freshTokens || 0));
    const width = 320;
    const height = 88;
    const padX = 4;
    const padY = 6;
    const colW = (width - padX * 2) / daily.length;
    const barW = Math.max(3, colW - 2);

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const describe = (day) => (isZh()
      ? `${day.date}：新输入+输出 ${formatTokens(day.freshTokens)}（输出 ${formatTokens(day.outputTokens)}，缓存读取 ${formatTokens(day.cacheReadTokens)}，${day.steps} 次调用，≈ ${formatUsd(day.estimatedCostUsd)}）`
      : `${day.date}: fresh ${formatTokens(day.freshTokens)} (out ${formatTokens(day.outputTokens)}, cache ${formatTokens(day.cacheReadTokens)}, ${day.steps} calls, ≈ ${formatUsd(day.estimatedCostUsd)})`);

    daily.forEach((day, idx) => {
      const fresh = day.freshTokens || 0;
      const x = padX + idx * colW + (colW - barW) / 2;
      const barH = fresh > 0 ? Math.max(3, (fresh / maxFresh) * (height - padY * 2)) : 2;
      const y = height - padY - barH;

      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('x', x.toFixed(1));
      rect.setAttribute('y', y.toFixed(1));
      rect.setAttribute('width', barW.toFixed(1));
      rect.setAttribute('height', barH.toFixed(1));
      rect.setAttribute('rx', '1.5');
      rect.setAttribute('fill', fresh > 0 ? 'var(--accent)' : 'var(--line)');
      rect.setAttribute('opacity', fresh > 0 ? '0.88' : '0.45');
      rect.addEventListener('mouseenter', () => {
        $('hist-hover-info').textContent = `${day.date}: ${formatTokens(fresh)} · ≈ ${formatUsd(day.estimatedCostUsd)}`;
      });
      const title = document.createElementNS(svgNs, 'title');
      title.textContent = describe(day);
      rect.appendChild(title);
      svg.appendChild(rect);
    });

    const latestDay = daily[daily.length - 1];
    $('hist-hover-info').textContent = `${latestDay.date}: ${formatTokens(latestDay.freshTokens || 0)} · ≈ ${formatUsd(latestDay.estimatedCostUsd)}`;
    box.appendChild(svg);
  }

  // ---------------------------------------------------------------- live tab

  const SOURCE_KEYS = {
    'checkpoint-calibrated': ['sourceCheckpoint', 'sourceTitleCheckpoint'],
    'effective-model': ['sourceEffectiveModel', 'sourceTitleEffectiveModel'],
    'observed-growth': ['sourceObservedGrowth', 'sourceTitleObservedGrowth'],
    preset: ['sourcePreset', 'sourceTitlePreset'],
    default: ['sourceDefault', 'sourceTitleDefault'],
  };

  function renderWindowSettings(data) {
    const model = data.model || {};
    const presets = data.capacityPresets || [];
    const prefs = data.preferences || {};
    const overridden = Boolean(model.overridden);
    const activePreset = overridden ? model.preset : 'auto';
    const capLabel = formatTokens(model.capacityTokens || 0);

    $('window-settings-summary').textContent = overridden
      ? `${t('windowManual')} ${capLabel}`
      : `${t('windowAuto')}（${capLabel}）`;

    const container = $('preset-pills');
    container.textContent = '';
    for (const preset of presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `preset-pill${preset.id === activePreset ? ' active' : ''}`;
      btn.textContent = preset.id === 'auto' ? t('autoPreset') : preset.label;
      btn.addEventListener('click', () => {
        updatePreference({ capacityOverride: { modelKey: model.key || 'unknown', preset: preset.id } });
      });
      container.appendChild(btn);
    }

    $('window-settings-note').textContent = model.key && model.key !== 'unknown'
      ? fmt('windowNote', { model: model.matchedRule || model.name })
      : t('windowNoteUnknown');

    const pillOn = prefs.sessionStartPill !== false;
    const alertOn = prefs.inlineContextAlert !== false;
    const pillBtn = $('toggle-session-pill');
    const alertBtn = $('toggle-context-alert');
    pillBtn.textContent = pillOn ? t('pillToggleOn') : t('pillToggleOff');
    pillBtn.className = `preset-pill${pillOn ? ' active' : ''}`;
    pillBtn.onclick = () => updatePreference({ sessionStartPill: !pillOn });

    alertBtn.textContent = alertOn ? t('alertToggleOn') : t('alertToggleOff');
    alertBtn.className = `preset-pill${alertOn ? ' active' : ''}`;
    alertBtn.onclick = () => updatePreference({ inlineContextAlert: !alertOn });
  }

  function renderAlerts(data) {
    const ctx = data.context || {};
    const alert = $('ctx-alert');
    let text = '';
    let level = 'info';

    if (ctx.switchPending && ctx.overCapacity) {
      level = 'crit';
      text = isZh()
        ? `已切换到 ${displayModel(data.model?.name)}：当前上下文 ${formatTokens(ctx.usedTokens)} 超出其窗口 ${formatTokens(ctx.totalTokens)}，下一次调用会先自动压缩。`
        : `Switched to ${displayModel(data.model?.name)}: current context ${formatTokens(ctx.usedTokens)} exceeds its ${formatTokens(ctx.totalTokens)} window; the next call will compact first.`;
    } else if (ctx.switchPending) {
      text = isZh()
        ? '模型已切换，下一次调用后会按新模型刷新用量。'
        : 'Model switched; usage refreshes for the new model after the next call.';
    } else if (ctx.justCompacted) {
      text = isZh()
        ? '刚完成压缩：当前显示的是摘要大小，下一次调用后刷新为实际用量。'
        : 'Just compacted: showing the summary size until the next call reports real usage.';
    } else if (ctx.lastStepCacheBust) {
      level = 'warn';
      const reasons = t('cacheBustReasons');
      text = `⚡ ${reasons[ctx.lastStepCacheBust] || ctx.lastStepCacheBust}`;
    }

    alert.textContent = text;
    alert.className = `alert ${level}${text ? '' : ' hidden'}`;
  }

  function renderForecast(data) {
    const el = $('forecast-line');
    const f = data.forecast || {};
    const ctx = data.context || {};
    const hide = () => { el.textContent = ''; el.classList.add('hidden'); };

    if (ctx.switchPending || ctx.justCompacted || data.conversationKind === 'agent') return hide();
    const steps = f.stepsRemaining;
    const turns = f.turnsRemaining;
    if (steps === null && turns === null) return hide();

    const cap = (n) => (n > 99 ? '99+' : String(n));
    let text;
    if (isZh()) {
      if (turns !== null && turns >= 1) {
        text = `⏳ 按最近节奏，约还能 ${cap(turns)} 轮对话`;
        if (steps !== null) text += `（≈ ${cap(steps)} 次模型调用）`;
        text += ' 后自动压缩';
      } else if (turns === 0) {
        text = `⏳ 最近每轮约增长 ${formatTokens(f.avgGrowthPerTurn)}，下一轮对话很可能触发自动压缩`;
        if (steps !== null) text += `（≈ ${cap(steps)} 次模型调用后）`;
      } else {
        text = `⏳ 按最近节奏，约 ${cap(steps)} 次模型调用后自动压缩`;
      }
    } else if (turns !== null && turns >= 1) {
      text = `⏳ At the recent pace, ~${cap(turns)} more turns`;
      if (steps !== null) text += ` (≈ ${cap(steps)} model calls)`;
      text += ' before auto-compaction';
    } else if (turns === 0) {
      text = `⏳ Recent turns add ~${formatTokens(f.avgGrowthPerTurn)} each; the next turn will likely compact`;
      if (steps !== null) text += ` (after ≈ ${cap(steps)} model calls)`;
    } else {
      text = `⏳ ~${cap(steps)} more model calls before auto-compaction at the recent pace`;
    }

    el.title = isZh()
      ? `平均每次调用 +${formatTokens(f.avgGrowthPerStep || 0)}，每轮 +${formatTokens(f.avgGrowthPerTurn || 0)}（基于最近 ${f.sampleSteps} 次调用 / ${f.sampleTurns} 轮）`
      : `Avg +${formatTokens(f.avgGrowthPerStep || 0)} per call, +${formatTokens(f.avgGrowthPerTurn || 0)} per turn (last ${f.sampleSteps} calls / ${f.sampleTurns} turns)`;
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function renderCompaction(data) {
    const c = data.compaction || {};
    const banner = $('compaction-banner');
    if (!c.count) {
      banner.classList.add('hidden');
      banner.textContent = '';
      return;
    }
    const parts = [];
    if (isZh()) {
      parts.push(`本会话已压缩 ${c.count} 次（自动 ${c.autoCount} · 手动 ${c.manualCount}）`);
      if (c.lastAutoTriggerTokens) parts.push(`上次自动压缩发生在 ${formatTokens(c.lastAutoTriggerTokens)}`);
    } else {
      parts.push(`Compacted ${c.count}× (auto ${c.autoCount} · manual ${c.manualCount})`);
      if (c.lastAutoTriggerTokens) parts.push(`last auto at ${formatTokens(c.lastAutoTriggerTokens)}`);
    }
    banner.textContent = parts.join(' · ');
    banner.classList.remove('hidden');
  }

  function renderMetrics(data) {
    state.latestMetrics = data;

    if (data.preferences?.locale && data.preferences.locale !== state.locale) {
      state.locale = data.preferences.locale;
      applyLocaleTexts();
      refreshConversations();
    }

    const followVisible = Boolean(
      state.hostConvId && state.selectedConvId && state.selectedConvId !== state.hostConvId
    );
    $('btn-follow-active').classList.toggle('hidden', !followVisible);

    const canJump = Boolean(
      typeof window.sidecar?.ui?.toggleConversation === 'function' &&
      data.conversationId &&
      data.conversationId !== state.hostConvId
    );
    $('btn-jump-conv').classList.toggle('hidden', !canJump);

    // Model + capacity source + workspace badge
    const model = data.model || {};
    const modelEl = $('model-name');
    if (!model.detected && data.conversationKind === 'agent') {
      modelEl.textContent = t('agentModel');
      modelEl.title = '';
    } else {
      modelEl.textContent = `${displayModel(model.name)}${model.inferredFromRecent ? t('inferredSuffix') : ''}`;
      modelEl.title = model.inferredFromRecent ? t('inferredTitle') : '';
    }
    const [srcKey, srcTitleKey] = SOURCE_KEYS[model.capacitySource] || SOURCE_KEYS.default;
    $('capacity-source').textContent = t(srcKey);
    $('capacity-source').title = t(srcTitleKey);

    const wsBadge = $('workspace-badge');
    if (data.workspace) {
      wsBadge.textContent = `📁 ${data.workspace}`;
      wsBadge.classList.remove('hidden');
    } else {
      wsBadge.textContent = '';
      wsBadge.classList.add('hidden');
    }

    // Context card
    const ctx = data.context || {};
    const pctEl = $('ctx-percent');
    pctEl.textContent = `${Number(ctx.usedPercent || 0).toFixed(1)}%`;
    pctEl.className = `pct-readout ${ctx.healthLevel || 'normal'}`;

    const totalCap = Math.max(1, ctx.totalTokens || 1);
    const cachedPct = Math.min(100, ((ctx.cachedTokens || 0) / totalCap) * 100);
    const uncachedPct = Math.min(Math.max(0, 100 - cachedPct), ((ctx.uncachedTokens || 0) / totalCap) * 100);
    const outputPct = Math.min(
      Math.max(0, 100 - cachedPct - uncachedPct),
      ((ctx.outputTokensLastStep || 0) / totalCap) * 100
    );
    $('bar-cached').style.width = `${cachedPct.toFixed(2)}%`;
    $('bar-uncached').style.width = `${uncachedPct.toFixed(2)}%`;
    $('bar-output').style.width = `${outputPct.toFixed(2)}%`;

    $('val-cached').textContent = formatTokens(ctx.cachedTokens || 0);
    $('val-uncached').textContent = formatTokens(ctx.uncachedTokens || 0);
    $('val-step-out').textContent = formatTokens(ctx.outputTokensLastStep || 0);
    $('val-capacity').textContent = formatTokens(ctx.totalTokens || 0);
    $('val-used').textContent = formatTokens(ctx.usedTokens || 0);
    $('val-remaining').textContent = formatTokens(ctx.remainingTokens || 0);
    $('val-cache-hit').textContent = `${Number(ctx.cacheHitRate || 0).toFixed(1)}%`;

    const specEl = $('val-provider-spec');
    const showSpec = Boolean(model.providerCapacityLabel && model.providerCapacityTokens !== ctx.totalTokens);
    specEl.classList.toggle('hidden', !showSpec);
    specEl.textContent = showSpec ? ` (${t('specLabel')} ${model.providerCapacityLabel})` : '';

    renderAlerts(data);
    renderForecast(data);
    renderCompaction(data);
    renderWindowSettings(data);

    // Speed card
    const tps = data.tps || {};
    const fmtTps = (v) => (v !== null && v !== undefined ? `${v.toFixed(1)} tok/s` : '--');
    $('val-recent-tps').textContent = tps.recentTps !== null && tps.recentTps !== undefined
      ? tps.recentTps.toFixed(1)
      : '--';
    $('val-latest-tps').textContent = fmtTps(tps.latestTps);
    $('val-session-tps').textContent = fmtTps(tps.sessionTps);
    $('val-measured-steps').textContent = `${tps.measuredStepCount || 0} / ${data.sessionTotals?.plannerSteps || 0}`;

    // Session usage card + subagent rollup + cost
    const totals = data.sessionTotals || {};
    $('val-session-fresh').textContent = formatTokens((totals.uncachedInputTokens || 0) + (totals.outputTokens || 0));
    $('val-total-output').textContent = formatTokens(totals.outputTokens || 0);
    $('val-session-cache-read').textContent = formatTokens(totals.cacheReadTokens || 0);
    $('val-planner-steps').textContent = String(totals.plannerSteps || 0);

    const sub = data.subagents || {};
    const subRow = $('row-subagents');
    if (sub.count > 0) {
      subRow.classList.remove('hidden');
      const valEl = $('val-subagents');
      valEl.textContent = isZh()
        ? `${sub.count} 个 · +${formatTokens(sub.freshTokens)}`
        : `${sub.count} · +${formatTokens(sub.freshTokens)}`;
      valEl.title = isZh()
        ? `子代理共 ${sub.steps} 次调用，缓存读取 ${formatTokens(sub.cacheReadTokens)}，等效约 ${formatUsd(sub.estimatedCostUsd)}`
        : `${sub.steps} subagent calls, cache ${formatTokens(sub.cacheReadTokens)}, ≈ ${formatUsd(sub.estimatedCostUsd)}`;
    } else {
      subRow.classList.add('hidden');
    }

    const cost = totals.cost || {};
    const costEl = $('val-session-cost');
    const savedUsd = Number(cost.cacheSavedUsd) || 0;
    if (savedUsd >= 0.01) {
      costEl.textContent = isZh()
        ? `${formatUsd(cost.estimatedCostUsd)}（省 ${formatUsd(savedUsd)}）`
        : `${formatUsd(cost.estimatedCostUsd)} (-${formatUsd(savedUsd)})`;
    } else {
      costEl.textContent = formatUsd(cost.estimatedCostUsd);
    }
    costEl.title = isZh()
      ? `若无提示词缓存需约 ${formatUsd(cost.fullCostWithoutCacheUsd)}（节省 ${cost.cacheSavedPercent || 0}%）`
      : `Without prompt caching: ≈ ${formatUsd(cost.fullCostWithoutCacheUsd)} (${cost.cacheSavedPercent || 0}% saved)`;

    $('telemetry-note').textContent = data.hooksActive ? t('noteHooksActive') : t('noteHooksInactive');

    renderSparkline(tps.series || []);
    renderStepsTable(data.steps || []);
  }

  // ---------------------------------------------------------------- steps tab

  function renderStepsTable(steps) {
    const tbody = $('steps-tbody');
    tbody.textContent = '';
    const list = [...(steps || [])].reverse().slice(0, 80);
    $('steps-count-badge').textContent = String(steps?.length ?? 0);
    $('steps-empty').classList.toggle('hidden', list.length > 0);

    const reasons = t('reasons');
    const sources = t('timingSources');
    const bustReasons = t('cacheBustReasons');
    for (const step of list) {
      const tr = document.createElement('tr');
      const tpsCell = step.tpsEligible && step.tps !== null
        ? { text: step.tps.toFixed(1) }
        : { text: reasons[step.tpsExcludedReason] || '--', muted: true };
      const cacheCell = step.cacheBust
        ? {
            text: `${step.cacheHitRate.toFixed(0)}% ⚡`,
            warn: true,
            title: bustReasons[step.cacheBustReason] || step.cacheBustReason || '',
          }
        : { text: `${step.cacheHitRate.toFixed(0)}%` };
      const cells = [
        { text: `#${step.stepIndex}${step.toolCount > 0 ? ` 🔧${step.toolCount > 1 ? step.toolCount : ''}` : ''}` },
        { text: formatTokens(step.contextTokens ?? step.promptTokens) },
        cacheCell,
        { text: formatTokens(step.outputTokens) },
        { text: step.elapsedSec !== null ? `${step.elapsedSec.toFixed(1)}s` : '--', title: sources[step.timingSource] || '' },
        tpsCell,
      ];
      for (const cell of cells) {
        const td = document.createElement('td');
        td.textContent = cell.text;
        if (cell.muted) td.className = 'muted';
        if (cell.warn) td.className = 'warn-cell';
        if (cell.title) td.title = cell.title;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  // ---------------------------------------------------------------- history tab

  function renderHistory(data) {
    const totals = data.totals || {};
    $('hist-today').textContent = formatTokens(totals.todayFreshTokens || 0);
    $('hist-today-sub').textContent = fmt('todaySubFmt', {
      out: formatTokens(totals.todayOutputTokens || 0),
      cache: formatTokens(totals.todayCacheReadTokens || 0),
      cost: formatUsd(totals.todayCostUsd || 0),
    });
    $('hist-7d').textContent = formatTokens(totals.last7dFreshTokens || 0);
    $('hist-7d-sub').textContent = fmt('activeDaysFmt', {
      n: totals.activeDays || 0,
      cost: formatUsd(totals.last7dCostUsd || 0),
    });
    $('hist-30d').textContent = formatTokens(totals.last30dFreshTokens || 0);
    const saved30d = Number(totals.last30dCacheSavedUsd) || 0;
    const savedSuffix = saved30d >= 0.01
      ? (isZh() ? `（省 ${formatUsd(saved30d)}）` : ` (-${formatUsd(saved30d)})`)
      : '';
    $('hist-30d-sub').textContent = fmt('convCountFmt', {
      n: totals.userConversations ?? totals.conversations ?? 0,
      cost: formatUsd(totals.last30dCostUsd || 0),
      saved: savedSuffix,
    });

    const surfaces = data.bySurface || [];
    const surfNote = $('surfaces-note');
    if (surfaces.length > 1 || (surfaces.length === 1 && surfaces[0].surface !== 'desktop')) {
      const labelMap = { desktop: 'Desktop', ide: 'IDE', cli: 'CLI' };
      const summary = surfaces
        .map((s) => `${labelMap[s.surface] || s.surface} ${s.conversations} (${formatTokens(s.freshTokens)})`)
        .join(' · ');
      surfNote.textContent = isZh() ? `多端汇总：${summary}` : `Surfaces: ${summary}`;
      surfNote.classList.remove('hidden');
    } else {
      surfNote.textContent = '';
      surfNote.classList.add('hidden');
    }

    renderDailyChart(data.daily || []);

    const tbody = $('models-tbody');
    tbody.textContent = '';
    let anyInferred = false;
    let anyAgentBreakdown = false;
    let anyUnattributedAgents = false;
    for (const row of data.byModel || []) {
      if (!row.steps) continue;
      const tr = document.createElement('tr');
      const inferred = row.inferredSteps > 0;
      const hasAgentShare = row.model !== AGENT_MODEL_LABEL && (row.agentSteps || 0) > 0;
      anyInferred = anyInferred || inferred;
      anyAgentBreakdown = anyAgentBreakdown || hasAgentShare;
      anyUnattributedAgents = anyUnattributedAgents || row.model === AGENT_MODEL_LABEL;
      const savedTitle = (row.cacheSavedUsd || 0) >= 0.01
        ? (isZh() ? `缓存节省 ≈ ${formatUsd(row.cacheSavedUsd)}` : `Cache saved ≈ ${formatUsd(row.cacheSavedUsd)}`)
        : '';
      const stepsTitle = hasAgentShare
        ? (isZh()
          ? `主会话 ${row.steps - row.agentSteps} 次 + 子代理/Swarm ${row.agentSteps} 次（子代理新输入+输出 ${formatTokens(row.agentFreshTokens || 0)}）`
          : `Main ${row.steps - row.agentSteps} + subagent/swarm ${row.agentSteps} (subagent fresh ${formatTokens(row.agentFreshTokens || 0)})`)
        : '';
      const cells = [
        { text: `${displayModel(row.model)}${inferred ? ' *' : ''}` },
        { text: hasAgentShare ? `${row.steps} (↳${row.agentSteps})` : String(row.steps), title: stepsTitle },
        { text: formatTokens(row.freshTokens ?? (row.inputTokens + row.outputTokens)) },
        { text: formatTokens(row.outputTokens) },
        { text: `${row.cacheHitRate.toFixed(0)}%` },
        { text: formatUsd(row.estimatedCostUsd), title: savedTitle },
      ];
      for (const cell of cells) {
        const td = document.createElement('td');
        td.textContent = cell.text;
        if (cell.title) td.title = cell.title;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    const notes = [];
    if (anyInferred || anyAgentBreakdown) notes.push(t('inferredModelsNote'));
    if (anyUnattributedAgents) notes.push(t('agentsNote'));
    $('models-note').textContent = notes.join(' ');
    $('models-note').classList.toggle('hidden', notes.length === 0);

    // Per-workspace card
    const workspaces = data.byWorkspace || [];
    const wsCard = $('workspace-card');
    const wsTbody = $('workspaces-tbody');
    wsTbody.textContent = '';
    if (workspaces.length > 0) {
      wsCard.classList.remove('hidden');
      for (const ws of workspaces.slice(0, 20)) {
        const tr = document.createElement('tr');
        const cells = [
          `📁 ${ws.workspace}`,
          String(ws.userConversations || ws.conversations),
          formatTokens(ws.freshTokens),
          `${ws.cacheHitRate.toFixed(0)}%`,
          formatUsd(ws.estimatedCostUsd),
        ];
        for (const text of cells) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        }
        wsTbody.appendChild(tr);
      }
    } else {
      wsCard.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------- conversation picker

  function conversationLabel(conv) {
    const isHost = conv.conversationId === state.hostConvId;
    const shortId = conv.conversationId.slice(0, 8);
    const when = formatRelative(conv.updatedAtMs);
    const modelShort = displayModel(conv.model).replace(/\s*\((?:XHigh|High|Medium|Low|Thinking)\)$/i, '');
    if (conv.kind === 'agent') {
      const root = conv.rootTitle ? `「${conv.rootTitle}」` : shortId;
      const agentMod = conv.model && conv.model !== AGENT_MODEL_LABEL ? ` · ${modelShort}` : '';
      return `${t('agentPrefix')} · ${root} · ${when}${agentMod}`;
    }
    const title = conv.title || shortId;
    const subBadge = conv.subagentCount > 0 ? ` · +${conv.subagentCount}↳` : '';
    return `${isHost ? '★ ' : ''}${title} · ${when} · ${modelShort} · ${formatTokens(conv.contextUsedTokens)}${subBadge}`;
  }

  async function refreshConversations() {
    try {
      const res = await apiFetch('/api/conversations');
      if (!res.ok) return;
      const data = await res.json();
      const select = $('conv-select');
      const previous = state.selectedConvId || state.hostConvId || AUTO_FOLLOW_VAL;
      select.textContent = '';

      const autoOpt = document.createElement('option');
      autoOpt.value = AUTO_FOLLOW_VAL;
      autoOpt.textContent = t('autoFollow');
      select.appendChild(autoOpt);

      const list = data.conversations || [];
      const mine = list.filter((c) => c.kind !== 'agent').slice(0, 40);
      const agents = list.filter((c) => c.kind === 'agent').slice(0, 20);
      // Make sure a pinned / host conversation stays selectable even if it is older.
      for (const id of [previous, state.hostConvId]) {
        if (!id || id === AUTO_FOLLOW_VAL) continue;
        const conv = list.find((c) => c.conversationId === id);
        if (conv && !mine.includes(conv) && !agents.includes(conv)) {
          (conv.kind === 'agent' ? agents : mine).push(conv);
        }
      }

      for (const [labelKey, group] of [['groupMine', mine], ['groupAgents', agents]]) {
        if (group.length === 0) continue;
        const og = document.createElement('optgroup');
        og.label = t(labelKey);
        for (const conv of group) {
          const opt = document.createElement('option');
          opt.value = conv.conversationId;
          opt.textContent = conversationLabel(conv);
          opt.title = conv.conversationId;
          og.appendChild(opt);
        }
        select.appendChild(og);
      }

      if (!state.hostConvId && !state.userPinnedConv) {
        state.selectedConvId = AUTO_FOLLOW_VAL;
        select.value = AUTO_FOLLOW_VAL;
      } else if (previous && [...select.options].some((o) => o.value === previous)) {
        select.value = previous;
      } else if (select.options.length > 0) {
        state.selectedConvId = select.options[0].value;
        select.value = state.selectedConvId;
      }
    } catch {
      // Transient fetch errors are retried on the next polling tick.
    }
  }

  // ---------------------------------------------------------------- data flow

  async function refreshMetrics() {
    try {
      let query = '';
      if (state.selectedConvId === AUTO_FOLLOW_VAL) {
        query = '?conversationId=latest';
      } else {
        const targetId = state.selectedConvId || state.hostConvId;
        if (targetId) {
          query = `?conversationId=${encodeURIComponent(targetId)}`;
        }
      }
      const res = await apiFetch(`/api/metrics${query}`);
      if (!res.ok) return;
      renderMetrics(await res.json());
    } catch {
      // Keep last known view on transient errors.
    }
  }

  async function refreshHistory() {
    try {
      const res = await apiFetch('/api/history');
      if (!res.ok) return;
      renderHistory(await res.json());
    } catch {
      // Non-fatal.
    }
  }

  async function updatePreference(patch) {
    try {
      const res = await apiFetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      const prefs = await res.json();
      if (prefs.locale && prefs.locale !== state.locale) {
        state.locale = prefs.locale;
        applyLocaleTexts();
        await refreshConversations();
        if (state.activeTab === 'history') await refreshHistory();
      }
      await refreshMetrics();
    } catch {
      // Non-fatal.
    }
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    for (const btn of document.querySelectorAll('.tab')) {
      const active = btn.dataset.tab === tabId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    for (const panel of document.querySelectorAll('.panel')) {
      panel.classList.toggle('active', panel.id === `panel-${tabId}`);
    }
    if (tabId === 'history') {
      refreshHistory();
    }
  }

  function startPolling() {
    stopPolling();
    if (document.visibilityState !== 'visible') return;
    state.pollTimer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      await refreshMetrics();
      state.convRefreshCounter++;
      if (state.convRefreshCounter % 7 === 0) {
        await refreshConversations();
      }
    }, 2000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('conv-select').addEventListener('change', (e) => {
    state.selectedConvId = e.target.value;
    state.userPinnedConv = e.target.value !== AUTO_FOLLOW_VAL;
    refreshMetrics();
  });

  $('btn-follow-active').addEventListener('click', () => {
    if (!state.hostConvId) return;
    state.userPinnedConv = false;
    state.selectedConvId = state.hostConvId;
    const select = $('conv-select');
    if ([...select.options].some((o) => o.value === state.hostConvId)) {
      select.value = state.hostConvId;
    }
    refreshMetrics();
  });

  $('btn-jump-conv').addEventListener('click', () => {
    const targetId = state.latestMetrics?.conversationId;
    if (targetId && typeof window.sidecar?.ui?.toggleConversation === 'function') {
      window.sidecar.ui.toggleConversation(targetId);
    }
  });

  $('btn-locale').addEventListener('click', () => {
    updatePreference({ locale: isZh() ? 'en' : 'zh-CN' });
  });

  $('btn-refresh').addEventListener('click', async () => {
    await refreshConversations();
    await refreshMetrics();
    if (state.activeTab === 'history') {
      await refreshHistory();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshMetrics();
      startPolling();
    } else {
      stopPolling();
    }
  });

  // Boot
  syncThemePolarity();
  applyLocaleTexts();
  refreshConversations().then(() => refreshMetrics());
  startPolling();
})();
