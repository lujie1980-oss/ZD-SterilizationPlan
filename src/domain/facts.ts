import { dayOffset } from './dates';
import type { AppConfig, Process, RuleFact, StockLine, StockLineFacts } from './entities';
import { effectiveMinLoadM3 } from './min-load';

const DUE_SOON_DAYS = 3;

function dueDeltaDays(due: string, asOf: string): number {
  if (!due) return Number.POSITIVE_INFINITY;
  return Math.round(dayOffset(asOf, due));
}

function hasProcessMinLoad(processCode: string, cfg: AppConfig, processes: Process[]): boolean {
  if (cfg.minLoadM3ByProcess?.[processCode] != null && Number.isFinite(cfg.minLoadM3ByProcess[processCode])) return true;
  const proc = processes.find((p) => p.code === processCode);
  return proc?.minLoadM3 != null && Number.isFinite(proc.minLoadM3);
}

/** 池行只读事实，不跑 RuleEngine 全量校验。asOf 取工作台日期。 */
export function deriveFacts(line: StockLine, processes: Process[], cfg: AppConfig, asOf: string): StockLineFacts {
  const facts: RuleFact[] = [];
  const days = dueDeltaDays(line.due, asOf);
  let dueTone: StockLineFacts['dueTone'] = 'ok';
  let dueLabel = line.due || '—';

  if (Number.isFinite(days) && days < 0) {
    dueTone = 'overdue';
    dueLabel = `${line.due} · 已逾期`;
    facts.push({
      code: 'DUE_OVERDUE',
      label: '已逾期',
      tone: 'danger',
      detail: `交期 ${line.due} 早于工作台日期 ${asOf}。事实条只读，不代替校验中心。`,
    });
  } else if (Number.isFinite(days) && days <= DUE_SOON_DAYS) {
    dueTone = 'soon';
    dueLabel = `${line.due} · 临近`;
    facts.push({
      code: 'DUE_SOON',
      label: '交期临近',
      tone: 'warn',
      detail: `交期 ${line.due} 距工作台日期 ${asOf} 为 ${days} 天（≤${DUE_SOON_DAYS} 天视为临近）。`,
    });
  }

  const allowedCabinets = Array.isArray(line.allowed) ? line.allowed.slice() : [];
  const hasDesignatedCabinet = allowedCabinets.length > 0;
  if (hasDesignatedCabinet) {
    facts.push({
      code: 'DESIGNATED',
      label: `指定柜：${allowedCabinets.join(',')}`,
      tone: 'neutral',
      detail: `本行工艺允许柜：${allowedCabinets.join('、')}。与主数据「工艺与指定柜」一致。`,
    });
  } else {
    facts.push({
      code: 'NO_DESIGNATED',
      label: '未指定柜',
      tone: 'warn',
      detail: '允许柜列表为空。分配前请核对工艺指定柜主数据。',
    });
  }

  if (line.boxVol >= cfg.box.largeBoxVol) {
    facts.push({
      code: 'BOX_LARGE',
      label: `大箱·计入${cfg.box.maxBoxesWhenLarge}`,
      tone: 'warn',
      detail: `单箱体积 ${line.boxVol}m³ ≥ ${cfg.box.largeBoxVol}m³，箱数计入每炉大箱上限 ${cfg.box.maxBoxesWhenLarge}（口径2，炉总箱数不触发 BOX_LIMIT）。`,
    });
  }

  if (hasProcessMinLoad(line.process, cfg, processes)) {
    const min = effectiveMinLoadM3(line.process, cfg, processes);
    facts.push({
      code: 'LOAD_TARGET',
      label: `${line.process}目标≥${min}`,
      tone: 'neutral',
      detail: `工艺 ${line.process} 最低拼载 ${min}m³（config.minLoadM3ByProcess / 工艺主数据）。低于目标为 warning，不阻断自动落盘。`,
    });
  }

  if (line.pendingAllow) {
    facts.push({
      code: 'PENDING_ALLOW',
      label: '允许柜待确认',
      tone: 'pending',
      detail: '本行允许柜规则待确认（pendingAllow）。可排但需人工核对。',
    });
  }

  if (line.urgent) {
    facts.push({
      code: 'URGENT',
      label: '加急',
      tone: 'danger',
      detail: '加急行，建议优先安排进炉。',
    });
  }

  return {
    dueLabel,
    dueTone,
    hasDesignatedCabinet,
    allowedCabinets,
    facts,
  };
}
