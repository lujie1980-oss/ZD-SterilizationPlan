import type {
  AppConfig,
  Cabinet,
  CabinetContent,
  CabinetRuntime,
  EligibleCabinetRow,
  EligibleDemandRow,
  Process,
  RuntimeStatus,
  StockLine,
  Tray,
  ValidationIssue,
} from './entities';
import { ISSUE_CODES } from './entities';
import {
  activeContentsOfCabinet,
  cloneContent,
  findPlacement,
  findReusableContent,
  normalizeCabinetContent,
} from './cabinet-content';
import { canAddFurnace, validateFurnace } from './rule-engine';
import { isEligible } from './pool';

export function hardEligible(cabinetId: string, line: StockLine, cabinets: Cabinet[]): boolean {
  const cab = cabinets.find((c) => c.id === cabinetId);
  if (!cab || cab.status === '报废') return false;
  return line.allowed.includes(cabinetId);
}

export function listEligibleForCabinet(opts: {
  cabinetId: string;
  pool: StockLine[];
  contents: CabinetContent[];
  cabinets: Cabinet[];
  config: AppConfig;
}): EligibleDemandRow[] {
  const { cabinetId, pool, contents, cabinets, config } = opts;
  const rows: EligibleDemandRow[] = [];
  for (const line of pool) {
    if (line.splitOf) continue;
    if (!isEligible(line, config) && line.stockStatus === '限制') continue;
    if (!hardEligible(cabinetId, line, cabinets)) continue;
    const placed = findPlacement(line.id, contents);
    let placement: EligibleDemandRow['placement'] = 'unassigned';
    let otherCabinetId: string | undefined;
    if (placed?.cabinetId === cabinetId) placement = 'inThisCabinet';
    else if (placed) {
      placement = 'inOtherCabinet';
      otherCabinetId = placed.cabinetId;
    }
    rows.push({ lineId: line.id, placement, otherCabinetId, line });
  }
  return rows;
}

export function assertCompleteEligibleList(rows: EligibleDemandRow[], cabinetId: string, pool: StockLine[], cabinets: Cabinet[], config: AppConfig): void {
  const expected = pool.filter((l) => !l.splitOf && hardEligible(cabinetId, l, cabinets) && (isEligible(l, config) || l.stockStatus !== '限制'));
  const got = new Set(rows.map((r) => r.lineId));
  const missing = expected.filter((l) => !got.has(l.id));
  if (missing.length) {
    throw new Error(`完整可进列表漏行: ${missing.map((m) => m.id).join(',')}`);
  }
}

export function inThisCabinetVol(rows: EligibleDemandRow[]): number {
  return rows.filter((r) => r.placement === 'inThisCabinet').reduce((s, r) => s + (r.line.vol || 0), 0);
}

export function listCandidateCabinets(opts: {
  lineIds: string[];
  poolById: (id: string) => StockLine | undefined;
  cabinets: Cabinet[];
  runtimes: CabinetRuntime[];
}): EligibleCabinetRow[] {
  const { lineIds, poolById, cabinets, runtimes } = opts;
  const lines = lineIds.map(poolById).filter((l): l is StockLine => Boolean(l));
  if (!lines.length) return [];
  let allowed = new Set(lines[0]!.allowed);
  for (const line of lines.slice(1)) {
    allowed = new Set([...allowed].filter((id) => line.allowed.includes(id)));
  }
  const runtimeOf = (id: string): RuntimeStatus => {
    const r = runtimes.find((x) => x.cabinetId === id);
    const cab = cabinets.find((c) => c.id === id);
    if (cab?.status === '报废' || cab?.status === '停用' as string) return 'outOfService';
    return r?.status ?? 'idle';
  };
  const rows: EligibleCabinetRow[] = [];
  for (const cab of cabinets) {
    if (!allowed.has(cab.id)) continue;
    const runtime = runtimeOf(cab.id);
    const scrap = cab.status === '报废' || runtime === 'outOfService';
    const sterilizing = runtime === 'sterilizing';
    const selectable = !scrap && !sterilizing;
    const autoPackBlocked = !selectable || runtime === 'loadComplete' || sterilizing;
    let disabledReason: string | undefined;
    if (scrap) disabledReason = '报废/停用，不可组柜';
    else if (sterilizing) disabledReason = '灭菌中，禁用可见';
    else if (runtime === 'loadComplete') disabledReason = '装填完毕待入炉，不当空闲';
    rows.push({
      cabinetId: cab.id,
      runtime,
      selectable,
      disabledReason,
      autoPackBlocked,
      cabinet: cab,
    });
  }
  return rows;
}

export interface DemandSelection {
  focusedId: string | null;
  checkedIds: string[];
}

export function focusDemand(state: DemandSelection, lineId: string): DemandSelection {
  return { focusedId: lineId, checkedIds: [...state.checkedIds] };
}

export function toggleDemandCheck(state: DemandSelection, lineId: string, checked: boolean): DemandSelection {
  const set = new Set(state.checkedIds);
  if (checked) set.add(lineId);
  else set.delete(lineId);
  return { focusedId: state.focusedId, checkedIds: [...set] };
}

export function groupingCandidateLineIds(
  rows: EligibleDemandRow[],
  skipInOther: boolean,
): string[] {
  return rows
    .filter((r) => r.placement === 'unassigned' || (!skipInOther && r.placement === 'inOtherCabinet'))
    .map((r) => r.lineId);
}

export function sortPackCandidates(lines: StockLine[]): StockLine[] {
  return lines.slice().sort((a, b) => {
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (Boolean(b.urgent) !== Boolean(a.urgent)) return Number(b.urgent) - Number(a.urgent);
    if (b.vol !== a.vol) return b.vol - a.vol;
    return a.id.localeCompare(b.id);
  });
}

export interface AutoPackResult {
  ok: boolean;
  message: string;
  content?: CabinetContent;
  skippedOther: string[];
  issues: ValidationIssue[];
}

export function autoPackCabinet(opts: {
  cabinetId: string;
  pool: StockLine[];
  contents: CabinetContent[];
  cabinets: Cabinet[];
  processes: Process[];
  trayMaster: Tray[];
  runtimes: CabinetRuntime[];
  config: AppConfig;
  nextId: string;
  poolById: (id: string) => StockLine | undefined;
  selectedLineIds?: string[];
}): AutoPackResult {
  const runtime = opts.runtimes.find((r) => r.cabinetId === opts.cabinetId);
  if (runtime?.status === 'sterilizing') {
    return {
      ok: false,
      message: `${opts.cabinetId} 灭菌中，不可组柜`,
      skippedOther: [],
      issues: [
        {
          sev: 'error',
          code: ISSUE_CODES.STERILIZING_LOCKED,
          msg: `${opts.cabinetId} 灭菌中，不可组柜`,
          cabinetId: opts.cabinetId,
        },
      ],
    };
  }
  const existingComplete = opts.contents.find(
    (c) => c.cabinetId === opts.cabinetId && !c.hidden && c.loadComplete,
  );
  if (runtime?.status === 'loadComplete' || existingComplete) {
    return {
      ok: false,
      message: `${opts.cabinetId} 装填完毕待入炉，自动禁再拼`,
      skippedOther: [],
      issues: [
        {
          sev: 'error',
          code: ISSUE_CODES.LOAD_COMPLETE_BLOCK,
          msg: `${opts.cabinetId} 装填完毕待入炉，自动禁再拼`,
          cabinetId: opts.cabinetId,
        },
      ],
    };
  }

  const addCheck = canAddFurnace(opts.cabinetId, {
    cabinets: opts.cabinets,
    processes: opts.processes,
    poolById: opts.poolById,
    config: opts.config,
    sameShiftFurnaces: opts.contents,
  });
  if (!addCheck.ok) {
    return { ok: false, message: addCheck.issue.msg, skippedOther: [], issues: [addCheck.issue] };
  }

  const eligible = listEligibleForCabinet({
    cabinetId: opts.cabinetId,
    pool: opts.pool,
    contents: opts.contents,
    cabinets: opts.cabinets,
    config: opts.config,
  });
  const skipInOther = opts.config.grouping?.skipInOtherCabinet !== false;
  const skippedOther = eligible.filter((r) => r.placement === 'inOtherCabinet').map((r) => r.lineId);
  let candidateIds = groupingCandidateLineIds(eligible, skipInOther);
  if (opts.selectedLineIds?.length) {
    const allow = new Set(opts.selectedLineIds);
    candidateIds = candidateIds.filter((id) => allow.has(id));
  }
  const already = eligible.filter((r) => r.placement === 'inThisCabinet').map((r) => r.lineId);
  const fresh = sortPackCandidates(candidateIds.map(opts.poolById).filter((l): l is StockLine => Boolean(l)));

  const existing = findReusableContent(opts.contents, opts.cabinetId);
  const contentId = existing?.id || opts.nextId;
  const accepted: string[] = [...already];
  const ctxBase = {
    cabinets: opts.cabinets,
    processes: opts.processes,
    poolById: opts.poolById,
    config: opts.config,
    sameShiftFurnaces: opts.contents,
    trayMaster: opts.trayMaster,
    allContents: opts.contents,
    runtimes: opts.runtimes,
  };

  for (const line of fresh) {
    const trialLines = [...accepted, line.id];
    const trial = normalizeCabinetContent(
      {
        id: contentId,
        cabinetId: opts.cabinetId,
        date: null,
        shift: null,
        seq: null,
        lines: trialLines,
        status: 'active',
        scheduleStatus: 'unscheduled',
        fillRate: 0,
        loadComplete: false,
        editSource: 'auto',
        taskId: null,
      },
      {
        trayMaster: opts.trayMaster,
        poolById: opts.poolById,
        largeBoxVol: opts.config.box.largeBoxVol,
        cabinet: opts.cabinets.find((c) => c.id === opts.cabinetId),
      },
    );
    const issues = validateFurnace(trial, ctxBase);
    if (issues.some((i) => i.sev === 'error')) continue;
    accepted.push(line.id);
  }

  if (!accepted.length) {
    return { ok: false, message: '自动组柜无可用行', skippedOther, issues: [] };
  }

  const content = normalizeCabinetContent(
    {
      id: contentId,
      cabinetId: opts.cabinetId,
      date: null,
      shift: null,
      seq: null,
      lines: accepted,
      status: 'active',
      scheduleStatus: 'unscheduled',
      fillRate: 0,
      loadComplete: false,
      editSource: 'auto',
      taskId: null,
    },
    {
      trayMaster: opts.trayMaster,
      poolById: opts.poolById,
      largeBoxVol: opts.config.box.largeBoxVol,
      cabinet: opts.cabinets.find((c) => c.id === opts.cabinetId),
    },
  );
  const issues = validateFurnace(content, ctxBase);
  if (issues.some((i) => i.sev === 'error')) {
    return { ok: false, message: '自动组柜存在硬错误，未落盘', skippedOther, issues };
  }
  return { ok: true, message: `已自动组入 ${content.lines.length} 行 → ${opts.cabinetId}（未排）`, content, skippedOther, issues };
}

export function manualPackCabinet(opts: {
  cabinetId: string;
  lineIds: string[];
  contents: CabinetContent[];
  cabinets: Cabinet[];
  trayMaster: Tray[];
  runtimes: CabinetRuntime[];
  config: AppConfig;
  nextId: string;
  poolById: (id: string) => StockLine | undefined;
  allowInOther: boolean;
}): { ok: boolean; message: string; content?: CabinetContent; issues: ValidationIssue[] } {
  const runtime = opts.runtimes.find((r) => r.cabinetId === opts.cabinetId);
  if (runtime?.status === 'sterilizing') {
    return {
      ok: false,
      message: `${opts.cabinetId} 灭菌中，不可组柜`,
      issues: [{ sev: 'error', code: ISSUE_CODES.STERILIZING_LOCKED, msg: `${opts.cabinetId} 灭菌中`, cabinetId: opts.cabinetId }],
    };
  }
  const existing = findReusableContent(opts.contents, opts.cabinetId);
  const contentId = existing?.id || opts.nextId;
  const keep = existing ? [...existing.lines] : [];
  const add: string[] = [];
  for (const id of opts.lineIds) {
    const placed = findPlacement(id, opts.contents);
    if (placed && placed.cabinetId !== opts.cabinetId && !opts.allowInOther) continue;
    if (!keep.includes(id) && !add.includes(id)) add.push(id);
  }
  const lines = [...keep, ...add];
  const content = normalizeCabinetContent(
    {
      id: contentId,
      cabinetId: opts.cabinetId,
      date: null,
      shift: null,
      seq: null,
      lines,
      status: 'active',
      scheduleStatus: 'unscheduled',
      fillRate: 0,
      loadComplete: existing?.loadComplete ?? false,
      editSource: 'manual',
      taskId: null,
    },
    {
      trayMaster: opts.trayMaster,
      poolById: opts.poolById,
      largeBoxVol: opts.config.box.largeBoxVol,
      cabinet: opts.cabinets.find((c) => c.id === opts.cabinetId),
    },
  );
  return { ok: true, message: `已手动组入 ${add.length} 行 → ${opts.cabinetId}（未排）`, content, issues: [] };
}

export function upsertContent(contents: CabinetContent[], next: CabinetContent): CabinetContent[] {
  const cloned = contents.map(cloneContent);
  const i = cloned.findIndex((c) => c.id === next.id);
  if (i >= 0) cloned[i] = cloneContent(next);
  else cloned.push(cloneContent(next));
  return cloned;
}

export function replaceCabinetActive(contents: CabinetContent[], next: CabinetContent): { ok: boolean; contents: CabinetContent[]; issue?: ValidationIssue } {
  const others = contents.filter((c) => c.id !== next.id && !c.hidden);
  const clash = activeContentsOfCabinet(others, next.cabinetId).filter(
    (c) => c.status === 'active' || (c.loadComplete && c.scheduleStatus === 'unscheduled'),
  );
  if (clash.length && next.status === 'active') {
    const reusable = clash[0]!;
    if (reusable.id !== next.id) {
      return {
        ok: false,
        contents,
        issue: {
          sev: 'error',
          code: ISSUE_CODES.ACTIVE_CONTENT,
          msg: `${next.cabinetId} 已有活动组柜计划 ${reusable.id}，不得并行抢柜`,
          cabinetId: next.cabinetId,
          furnaceId: next.id,
        },
      };
    }
  }
  return { ok: true, contents: upsertContent(contents, next) };
}

export function markLoadComplete(opts: {
  content: CabinetContent;
  issues: ValidationIssue[];
  scheduleMode: 'auto' | 'manual';
}): { ok: boolean; content: CabinetContent; message: string } {
  const hasError = opts.issues.some((i) => i.sev === 'error');
  if (opts.scheduleMode !== 'manual' && hasError) {
    return { ok: false, content: opts.content, message: '自动模式下存在硬错误，不得标装填完毕' };
  }
  return {
    ok: true,
    content: {
      ...opts.content,
      loadComplete: true,
      manualViolation: hasError ? true : opts.content.manualViolation,
    },
    message: hasError ? '已标装填完毕（手工违例预警保留）' : '已标装填完毕',
  };
}
