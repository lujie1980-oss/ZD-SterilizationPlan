import type {
  AppConfig,
  Cabinet,
  CabinetContent,
  CabinetRuntime,
  ContentLineShare,
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
  contentTotals,
  findPlacement,
  findReusableContent,
  normalizeCabinetContent,
  remainingBoxes as remainingBoxesOf,
  remainingVol as remainingVolOf,
} from './cabinet-content';
import {
  makeShare,
  mergeShare,
  remainingView,
  takeBoxesRemainderB,
} from './volume-pack';
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
    rows.push({
      lineId: line.id,
      placement,
      otherCabinetId,
      line,
      remainingBoxes: remainingBoxesOf(line, contents),
      remainingVol: remainingVolOf(line, contents),
    });
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
  _skipInOther: boolean,
): string[] {
  return rows.filter((r) => (r.remainingBoxes ?? r.line.boxes) > 0).map((r) => r.lineId);
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

function draftFromShares(opts: {
  id: string;
  cabinetId: string;
  shares: ContentLineShare[];
  trayMaster: Tray[];
  poolById: (id: string) => StockLine | undefined;
  largeBoxVol: number;
  cabinet?: Cabinet;
  loadComplete?: boolean;
  editSource?: CabinetContent['editSource'];
}): CabinetContent {
  return normalizeCabinetContent(
    {
      id: opts.id,
      cabinetId: opts.cabinetId,
      date: null,
      shift: null,
      seq: null,
      stockShares: opts.shares.map((s) => ({ ...s })),
      lines: opts.shares.map((s) => s.stockLineId),
      status: opts.shares.length ? 'active' : 'draft',
      scheduleStatus: 'unscheduled',
      fillRate: 0,
      loadComplete: Boolean(opts.loadComplete),
      editSource: opts.editSource ?? 'auto',
      taskId: null,
    },
    {
      trayMaster: opts.trayMaster,
      poolById: opts.poolById,
      largeBoxVol: opts.largeBoxVol,
      cabinet: opts.cabinet,
      hydrateTrays: false,
    },
  );
}

function currentShares(
  content: CabinetContent | undefined,
  poolById: (id: string) => StockLine | undefined,
  largeBoxVol: number,
): ContentLineShare[] {
  if (!content) return [];
  return contentTotals(content, poolById, largeBoxVol).shares.map((s) => ({ ...s }));
}

function tryCommitShares(opts: {
  contentId: string;
  cabinetId: string;
  shares: ContentLineShare[];
  cabinets: Cabinet[];
  processes: Process[];
  trayMaster: Tray[];
  poolById: (id: string) => StockLine | undefined;
  config: AppConfig;
  contents: CabinetContent[];
  runtimes: CabinetRuntime[];
  loadComplete?: boolean;
  editSource?: CabinetContent['editSource'];
}): { ok: boolean; content?: CabinetContent; issues: ValidationIssue[] } {
  const trial = draftFromShares({
    id: opts.contentId,
    cabinetId: opts.cabinetId,
    shares: opts.shares,
    trayMaster: opts.trayMaster,
    poolById: opts.poolById,
    largeBoxVol: opts.config.box.largeBoxVol,
    cabinet: opts.cabinets.find((c) => c.id === opts.cabinetId),
    loadComplete: opts.loadComplete,
    editSource: opts.editSource,
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

function takeOnContent(
  shares: ContentLineShare[],
  cabinet: Cabinet,
  line: StockLine,
  remainingBoxes: number,
  box: AppConfig['box'],
): number {
  const agg = shares.reduce(
    (s, r) => ({ vol: s.vol + (r.vol || 0), large: s.large + (r.largeBoxes || 0) }),
    { vol: 0, large: 0 },
  );
  return takeBoxesRemainderB({
    totalVol: agg.vol,
    largeBoxCount: agg.large,
    ratedLoadM3: cabinet.ratedLoadM3 || cabinet.capacity || 0,
    remainingBoxes,
    boxVol: line.boxVol,
    box,
  });
}

function linesOfContent(content: CabinetContent | undefined, poolById: (id: string) => StockLine | undefined): StockLine[] {
  if (!content) return [];
  return content.lines.map(poolById).filter((l): l is StockLine => Boolean(l));
}

function peersWithout(contents: CabinetContent[], contentId: string): CabinetContent[] {
  return contents.filter((c) => c.id !== contentId);
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
  const skippedOther = eligible.filter((r) => r.placement === 'inOtherCabinet' && (r.remainingBoxes ?? 0) <= 0).map((r) => r.lineId);
  let candidateIds = groupingCandidateLineIds(eligible, skipInOther);
  if (skipInOther) {
    const blocked = new Set(skippedOther);
    candidateIds = candidateIds.filter((id) => !blocked.has(id));
  }
  if (opts.selectedLineIds?.length) {
    const allow = new Set(opts.selectedLineIds);
    candidateIds = candidateIds.filter((id) => allow.has(id));
  }
  let remaining = candidateIds.map(opts.poolById).filter((l): l is StockLine => Boolean(l));

  const existing = findReusableContent(opts.contents, opts.cabinetId);
  const contentId = existing?.id || opts.nextId;
  const box = opts.config.box;
  let shares = currentShares(existing, opts.poolById, box.largeBoxVol);
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
  const peers = peersWithout(opts.contents, contentId);

  while (remaining.length) {
    const probe = draftFromShares({
      id: contentId,
      cabinetId: opts.cabinetId,
      shares,
      trayMaster: opts.trayMaster,
      poolById: opts.poolById,
      largeBoxVol: box.largeBoxVol,
      cabinet,
      loadComplete: existing?.loadComplete,
    });
    const loadedVol = loadedVolumeOf(probe, opts.poolById);
    const fill = rated > 0 ? loadedVol / rated : 0;
    if (policy.fillMode === 'fillOneFirst' && shouldStopFillOneFirst(fill, policy.targetFillRate)) {
      break;
    }
    const loadedLines = linesOfContent(probe, opts.poolById);
    const scored = remaining
      .map((line) => {
        const rem = remainingBoxesOf(line, [...peers, probe]);
        const take = takeOnContent(shares, cabinet, line, rem, box);
        return { line, rem, take, view: remainingView(line, take) };
      })
      .filter((x) => x.take > 0);
    const best = pickBestLineForCabinet({
      cabinet,
      lines: scored.map((x) => x.view),
      loadedVol,
      loadedLines,
      policy,
    });
    if (!best) break;
    const hit = scored.find((x) => x.line.id === best.id);
    const source = remaining.find((l) => l.id === best.id);
    if (!hit || !source) {
      remaining = remaining.filter((l) => l.id !== best.id);
      continue;
    }
    const nextShares = mergeShare(shares, makeShare(source, hit.take, box.largeBoxVol));
    const placed = tryCommitShares({
      contentId,
      cabinetId: opts.cabinetId,
      shares: nextShares,
      cabinets: opts.cabinets,
      processes: opts.processes,
      trayMaster: opts.trayMaster,
      poolById: opts.poolById,
      config: opts.config,
      contents: opts.contents,
      runtimes: opts.runtimes,
      loadComplete: existing?.loadComplete,
    });
    if (!placed.ok) {
      remaining = remaining.filter((l) => l.id !== source.id);
      continue;
    }
    shares = nextShares;
    const leftover = hit.rem - hit.take;
    const more = leftover > 0 ? takeOnContent(shares, cabinet, source, leftover, box) : 0;
    if (more <= 0) remaining = remaining.filter((l) => l.id !== source.id);
  }

  if (!shares.length) {
    return { ok: false, message: '自动组柜无可用行', skippedOther, issues: [] };
  }

  const content = draftFromShares({
    id: contentId,
    cabinetId: opts.cabinetId,
    shares,
    trayMaster: opts.trayMaster,
    poolById: opts.poolById,
    largeBoxVol: box.largeBoxVol,
    cabinet,
    loadComplete: existing?.loadComplete,
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
    let rem = remainingBoxesOf(line, working);
    if (rem <= 0) {
      const placed = findPlacement(line.id, working);
      if (placed && skipInOther) skippedOther.push(line.id);
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
    while (remainingCabs.length && rem > 0) {
      const view = remainingView(line, rem);
      const cabinet = pickBestCabinetForLine({
        line: view,
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
      const shares = currentShares(existing, opts.poolById, opts.config.box.largeBoxVol);
      const take = takeOnContent(shares, cabinet, line, rem, opts.config.box);
      if (take <= 0) continue;
      const nextShares = mergeShare(shares, makeShare(line, take, opts.config.box.largeBoxVol));
      const placedTry = tryCommitShares({
        contentId,
        cabinetId: cabinet.id,
        shares: nextShares,
        cabinets: opts.cabinets,
        processes: opts.processes,
        trayMaster: opts.trayMaster,
        poolById: opts.poolById,
        config: opts.config,
        contents: working,
        runtimes: opts.runtimes,
        loadComplete: existing?.loadComplete,
      });
      if (!placedTry.ok || !placedTry.content) continue;
      if (!existing) nextSeq += 1;
      const upserted = replaceCabinetActive(working, placedTry.content);
      if (!upserted.ok) continue;
      working.splice(0, working.length, ...upserted.contents);
      rem -= take;
    }
    if (rem > 0) unplaced.push(line.id);
  }

  const changed = working.filter((c) => {
    const prev = opts.contents.find((p) => p.id === c.id);
    if (!prev) return (c.stockShares?.length || c.lines.length) > 0;
    return shareKey(prev) !== shareKey(c);
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

function shareKey(c: CabinetContent): string {
  if (c.stockShares?.length) {
    return c.stockShares.map((s) => `${s.stockLineId}:${s.boxes}:${s.vol}`).join('|');
  }
  return (c.lines || []).join(',');
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
  clampToLimits?: boolean;
}): { ok: boolean; message: string; content?: CabinetContent; issues: ValidationIssue[]; rejectedCode?: string } {
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
  const cabinet = opts.cabinets.find((c) => c.id === opts.cabinetId);
  let shares = currentShares(existing, opts.poolById, opts.config.box.largeBoxVol);
  const addIds: string[] = [];
  for (const id of opts.lineIds) {
    const line = opts.poolById(id);
    if (!line) continue;
    const placed = findPlacement(id, opts.contents);
    if (placed && placed.cabinetId !== opts.cabinetId && !opts.allowInOther) continue;
    const rem = remainingBoxesOf(line, opts.contents);
    if (rem <= 0) continue;
    const take = opts.clampToLimits && cabinet ? takeOnContent(shares, cabinet, line, rem, opts.config.box) : rem;
    if (take <= 0) {
      const totals = shares.reduce((s, r) => ({ vol: s.vol + r.vol, large: s.large + r.largeBoxes }), { vol: 0, large: 0 });
      const rated = cabinet?.ratedLoadM3 || 0;
      if (line.boxVol >= opts.config.box.largeBoxVol && totals.large >= opts.config.box.maxBoxesWhenLarge) {
        return { ok: false, message: `大箱已满 ${opts.config.box.maxBoxesWhenLarge}，不可再加入大箱（BOX_LIMIT）`, issues: [], rejectedCode: ISSUE_CODES.BOX_LIMIT };
      }
      if (rated > 0 && totals.vol + line.boxVol > rated) {
        return { ok: false, message: `体积将超过柜容 ${rated}m³（VOL_OVERFLOW）`, issues: [], rejectedCode: ISSUE_CODES.VOL_OVERFLOW };
      }
      continue;
    }
    shares = mergeShare(shares, makeShare(line, take, opts.config.box.largeBoxVol));
    if (!addIds.includes(id)) addIds.push(id);
  }
  const content = draftFromShares({
    id: contentId,
    cabinetId: opts.cabinetId,
    shares,
    trayMaster: opts.trayMaster,
    poolById: opts.poolById,
    largeBoxVol: opts.config.box.largeBoxVol,
    cabinet,
    loadComplete: existing?.loadComplete,
    editSource: 'manual',
  });
  return { ok: true, message: `已手动组入 ${addIds.length} 行 → ${opts.cabinetId}（未排）`, content, issues: [] };
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

export function packSummaryOf(opts: {
  content: CabinetContent | undefined;
  cabinet: Cabinet | undefined;
  poolById: (id: string) => StockLine | undefined;
  largeBoxVol: number;
  maxBoxesWhenLarge: number;
}): {
  totalVol: number;
  largeBoxCount: number;
  fillRate: number;
  remainingVol: number;
  ratedLoadM3: number;
  maxLarge: number;
  shares: ContentLineShare[];
  largeFull: boolean;
} {
  const rated = opts.cabinet?.ratedLoadM3 || opts.cabinet?.capacity || 0;
  const totals = opts.content
    ? contentTotals(opts.content, opts.poolById, opts.largeBoxVol)
    : { totalVol: 0, largeBoxCount: 0, lineIds: [] as string[], shares: [] as ContentLineShare[] };
  const fillRate = rated > 0 ? totals.totalVol / rated : 0;
  return {
    totalVol: totals.totalVol,
    largeBoxCount: totals.largeBoxCount,
    fillRate,
    remainingVol: Math.max(0, rated - totals.totalVol),
    ratedLoadM3: rated,
    maxLarge: opts.maxBoxesWhenLarge,
    shares: totals.shares,
    largeFull: totals.largeBoxCount >= opts.maxBoxesWhenLarge,
  };
}

export function isLargeDemand(line: Pick<StockLine, 'boxVol'>, largeBoxVol: number): boolean {
  return line.boxVol >= largeBoxVol;
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
