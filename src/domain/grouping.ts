import type {
  AppConfig,
  Cabinet,
  CabinetContent,
  CabinetRuntime,
  EligibleCabinetRow,
  EligibleDemandRow,
  PackSuggestPolicy,
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
import {
  loadedVolumeOf,
  pickBestCabinetForLine,
  pickBestLineForCabinet,
  resolvePackSuggestPolicy,
  shouldStopFillOneFirst,
} from './pack-suggest-policy';
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

export interface AutoPackBatchResult {
  ok: boolean;
  message: string;
  contents: CabinetContent[];
  unplaced: string[];
  skippedOther: string[];
  issues: ValidationIssue[];
  nextSeq: number;
}

function hardBlockSterilizingOrComplete(
  cabinetId: string,
  contents: CabinetContent[],
  runtimes: CabinetRuntime[],
): AutoPackResult | null {
  const runtime = runtimes.find((r) => r.cabinetId === cabinetId);
  if (runtime?.status === 'sterilizing') {
    return {
      ok: false,
      message: `${cabinetId} 灭菌中，不可组柜`,
      skippedOther: [],
      issues: [
        {
          sev: 'error',
          code: ISSUE_CODES.STERILIZING_LOCKED,
          msg: `${cabinetId} 灭菌中，不可组柜`,
          cabinetId,
        },
      ],
    };
  }
  const existingComplete = contents.find((c) => c.cabinetId === cabinetId && !c.hidden && c.loadComplete);
  if (runtime?.status === 'loadComplete' || existingComplete) {
    return {
      ok: false,
      message: `${cabinetId} 装填完毕待入炉，自动禁再拼`,
      skippedOther: [],
      issues: [
        {
          sev: 'error',
          code: ISSUE_CODES.REPACK_AFTER_LOAD_COMPLETE,
          msg: `${cabinetId} 装填完毕待入炉，自动禁再拼`,
          cabinetId,
        },
      ],
    };
  }
  return null;
}

function draftContent(opts: {
  id: string;
  cabinetId: string;
  lines: string[];
  trayMaster: Tray[];
  poolById: (id: string) => StockLine | undefined;
  largeBoxVol: number;
  cabinet?: Cabinet;
}): CabinetContent {
  return normalizeCabinetContent(
    {
      id: opts.id,
      cabinetId: opts.cabinetId,
      date: null,
      shift: null,
      seq: null,
      lines: opts.lines,
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
      largeBoxVol: opts.largeBoxVol,
      cabinet: opts.cabinet,
    },
  );
}

function tryPlaceLine(opts: {
  contentId: string;
  cabinetId: string;
  accepted: string[];
  lineId: string;
  cabinets: Cabinet[];
  processes: Process[];
  trayMaster: Tray[];
  poolById: (id: string) => StockLine | undefined;
  config: AppConfig;
  contents: CabinetContent[];
  runtimes: CabinetRuntime[];
}): { ok: boolean; content?: CabinetContent; issues: ValidationIssue[] } {
  const trial = draftContent({
    id: opts.contentId,
    cabinetId: opts.cabinetId,
    lines: [...opts.accepted, opts.lineId],
    trayMaster: opts.trayMaster,
    poolById: opts.poolById,
    largeBoxVol: opts.config.box.largeBoxVol,
    cabinet: opts.cabinets.find((c) => c.id === opts.cabinetId),
  });
  const issues = validateFurnace(trial, {
    cabinets: opts.cabinets,
    processes: opts.processes,
    poolById: opts.poolById,
    config: opts.config,
    sameShiftFurnaces: opts.contents,
    trayMaster: opts.trayMaster,
    allContents: opts.contents,
    runtimes: opts.runtimes,
  });
  if (issues.some((i) => i.sev === 'error')) return { ok: false, issues };
  return { ok: true, content: trial, issues };
}

function linesOfContent(content: CabinetContent | undefined, poolById: (id: string) => StockLine | undefined): StockLine[] {
  if (!content) return [];
  return content.lines.map(poolById).filter((l): l is StockLine => Boolean(l));
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
  policy?: PackSuggestPolicy;
}): AutoPackResult {
  const blocked = hardBlockSterilizingOrComplete(opts.cabinetId, opts.contents, opts.runtimes);
  if (blocked) return blocked;

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

  const policy = opts.policy ?? resolvePackSuggestPolicy(opts.config);
  const cabinet = opts.cabinets.find((c) => c.id === opts.cabinetId);
  if (!cabinet) {
    return { ok: false, message: `${opts.cabinetId} 不存在`, skippedOther: [], issues: [] };
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
  let remaining = candidateIds.map(opts.poolById).filter((l): l is StockLine => Boolean(l));

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

  const rated = cabinet.ratedLoadM3 || cabinet.capacity || 0;

  while (remaining.length) {
    const probe = draftContent({
      id: contentId,
      cabinetId: opts.cabinetId,
      lines: accepted,
      trayMaster: opts.trayMaster,
      poolById: opts.poolById,
      largeBoxVol: opts.config.box.largeBoxVol,
      cabinet,
    });
    const loadedVol = loadedVolumeOf(probe, opts.poolById);
    const fill = rated > 0 ? loadedVol / rated : 0;
    if (policy.fillMode === 'fillOneFirst' && shouldStopFillOneFirst(fill, policy.targetFillRate)) {
      break;
    }
    const loadedLines = linesOfContent(probe, opts.poolById);
    const best = pickBestLineForCabinet({
      cabinet,
      lines: remaining,
      loadedVol,
      loadedLines,
      policy,
    });
    if (!best) break;
    const placed = tryPlaceLine({
      contentId,
      cabinetId: opts.cabinetId,
      accepted,
      lineId: best.id,
      cabinets: opts.cabinets,
      processes: opts.processes,
      trayMaster: opts.trayMaster,
      poolById: opts.poolById,
      config: opts.config,
      contents: opts.contents,
      runtimes: opts.runtimes,
    });
    remaining = remaining.filter((l) => l.id !== best.id);
    if (!placed.ok) continue;
    accepted.push(best.id);
  }

  if (!accepted.length) {
    return { ok: false, message: '自动组柜无可用行', skippedOther, issues: [] };
  }

  const content = draftContent({
    id: contentId,
    cabinetId: opts.cabinetId,
    lines: accepted,
    trayMaster: opts.trayMaster,
    poolById: opts.poolById,
    largeBoxVol: opts.config.box.largeBoxVol,
    cabinet,
  });
  const issues = validateFurnace(content, ctxBase);
  if (issues.some((i) => i.sev === 'error')) {
    return { ok: false, message: '自动组柜存在硬错误，未落盘', skippedOther, issues };
  }
  return { ok: true, message: `已自动组入 ${content.lines.length} 行 → ${opts.cabinetId}（未排）`, content, skippedOther, issues };
}

export function autoPackDemands(opts: {
  lineIds: string[];
  pool: StockLine[];
  contents: CabinetContent[];
  cabinets: Cabinet[];
  processes: Process[];
  trayMaster: Tray[];
  runtimes: CabinetRuntime[];
  config: AppConfig;
  nextSeq: number;
  poolById: (id: string) => StockLine | undefined;
  policy?: PackSuggestPolicy;
}): AutoPackBatchResult {
  const policy = opts.policy ?? resolvePackSuggestPolicy(opts.config);
  const skipInOther = opts.config.grouping?.skipInOtherCabinet !== false;
  const skippedOther: string[] = [];
  const unplaced: string[] = [];
  const working = opts.contents.map(cloneContent);
  let nextSeq = opts.nextSeq;
  const ordered = sortPackCandidates(
    opts.lineIds.map(opts.poolById).filter((l): l is StockLine => Boolean(l)),
  );

  for (const line of ordered) {
    const placed = findPlacement(line.id, working);
    if (placed) {
      if (placed.cabinetId && skipInOther) skippedOther.push(line.id);
      continue;
    }
    const candRows = listCandidateCabinets({
      lineIds: [line.id],
      poolById: opts.poolById,
      cabinets: opts.cabinets,
      runtimes: opts.runtimes,
    }).filter((r) => r.selectable && !r.autoPackBlocked && hardEligible(r.cabinetId, line, opts.cabinets));
    const cabinets = candRows.map((r) => r.cabinet);
    if (!cabinets.length) {
      unplaced.push(line.id);
      continue;
    }
    let remainingCabs = cabinets.slice();
    let done = false;
    while (remainingCabs.length && !done) {
      const cabinet = pickBestCabinetForLine({
        line,
        cabinets: remainingCabs,
        loadedVolOf: (id) => loadedVolumeOf(findReusableContent(working, id), opts.poolById),
        loadedLinesOf: (id) => linesOfContent(findReusableContent(working, id), opts.poolById),
        policy,
      });
      if (!cabinet) break;
      remainingCabs = remainingCabs.filter((c) => c.id !== cabinet.id);
      const addCheck = canAddFurnace(cabinet.id, {
        cabinets: opts.cabinets,
        processes: opts.processes,
        poolById: opts.poolById,
        config: opts.config,
        sameShiftFurnaces: working,
      });
      if (!addCheck.ok) continue;
      const existing = findReusableContent(working, cabinet.id);
      const contentId = existing?.id || `CC${nextSeq}`;
      const accepted = existing ? [...existing.lines] : [];
      const placedTry = tryPlaceLine({
        contentId,
        cabinetId: cabinet.id,
        accepted,
        lineId: line.id,
        cabinets: opts.cabinets,
        processes: opts.processes,
        trayMaster: opts.trayMaster,
        poolById: opts.poolById,
        config: opts.config,
        contents: working,
        runtimes: opts.runtimes,
      });
      if (!placedTry.ok || !placedTry.content) continue;
      if (!existing) nextSeq += 1;
      const upserted = replaceCabinetActive(working, placedTry.content);
      if (!upserted.ok) continue;
      working.splice(0, working.length, ...upserted.contents);
      done = true;
      break;
    }
    if (!done) unplaced.push(line.id);
  }

  const changed = working.filter((c) => {
    const prev = opts.contents.find((p) => p.id === c.id);
    if (!prev) return c.lines.length > 0;
    return prev.lines.length !== c.lines.length || prev.lines.some((id, i) => id !== c.lines[i]);
  });
  if (!changed.length) {
    return {
      ok: false,
      message: '自动组柜无可用行',
      contents: [],
      unplaced,
      skippedOther,
      issues: [],
      nextSeq,
    };
  }
  const cabNote = [...new Set(changed.map((c) => c.cabinetId))].join('、');
  const placedCount = changed.reduce((s, c) => {
    const prev = opts.contents.find((p) => p.id === c.id);
    return s + Math.max(0, c.lines.length - (prev?.lines.length || 0));
  }, 0);
  return {
    ok: true,
    message: `已按建议策略组入 ${placedCount} 行 → ${cabNote}（未排）`,
    contents: working,
    unplaced,
    skippedOther,
    issues: [],
    nextSeq,
  };
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
