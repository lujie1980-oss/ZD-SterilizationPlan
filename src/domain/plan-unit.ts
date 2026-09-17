import type {
  CabinetContent,
  PlanUnit,
  PlanUnitCreation,
  PlanUnitsOnTray,
  StockLine,
  TraysInCabinetContent,
} from './entities';
import { ISSUE_CODES } from './entities';

export const PLAN_UNIT_RULE = 'oneBoxOneUnit' as const;
export const PLAN_SCHEMA_VERSION = 3;

export const PU_ERROR_CODES = {
  PU_RECREATE_BLOCKED: ISSUE_CODES.PU_RECREATE_BLOCKED,
  PU_MIGRATE_FAIL: ISSUE_CODES.PU_MIGRATE_FAIL,
  PU_NO_UNITS: ISSUE_CODES.PU_NO_UNITS,
} as const;

export type PuErrorCode = (typeof PU_ERROR_CODES)[keyof typeof PU_ERROR_CODES];

export interface PlanUnitState {
  creations: PlanUnitCreation[];
  planUnits: PlanUnit[];
}

export type PlanUnitOpResult =
  | { ok: true; creations: PlanUnitCreation[]; planUnits: PlanUnit[]; creation: PlanUnitCreation }
  | { ok: false; code: PuErrorCode; message: string; creations: PlanUnitCreation[]; planUnits: PlanUnit[] };

function nowIso(now?: string): string {
  return now || new Date().toISOString();
}

export function unitVolOf(line: StockLine): number {
  if (Number.isFinite(line.boxVol) && line.boxVol > 0) return line.boxVol;
  if (line.boxes > 0 && Number.isFinite(line.vol)) return line.vol / line.boxes;
  return line.vol || 0;
}

export function planUnitIdOf(stockLineId: string, version: number, boxSeq: number): string {
  return `${stockLineId}-v${version}-U${String(boxSeq).padStart(3, '0')}`;
}

export function creationIdOf(stockLineId: string): string {
  return `PUC-${stockLineId}`;
}

export function createOneBoxOneUnit(line: StockLine, creationId: string, version: number): PlanUnit[] {
  const n = Math.floor(line.boxes);
  if (n < 1) return [];
  const vol = unitVolOf(line);
  return Array.from({ length: n }, (_, i) => {
    const boxSeq = i + 1;
    return {
      id: planUnitIdOf(line.id, version, boxSeq),
      stockLineId: line.id,
      creationId,
      boxSeq,
      vol,
      dimL: line.dimL,
      dimW: line.dimW,
      dimH: line.dimH,
      salesOrderNo: line.salesOrderNo,
      salesOrderLine: line.salesOrderLine,
      placement: null,
      status: 'unassigned' as const,
    };
  });
}

export function assertPlanUnitInvariant(unit: PlanUnit): void {
  const placed = unit.status === 'placed';
  const hasPlacement = unit.placement != null;
  if (placed !== hasPlacement) {
    throw new Error(`PlanUnit 不变式失败：${unit.id} status=${unit.status} placement=${JSON.stringify(unit.placement)}`);
  }
}

export function creationOfLine(creations: PlanUnitCreation[], stockLineId: string): PlanUnitCreation | undefined {
  return creations.find((c) => c.stockLineId === stockLineId);
}

export function unitsOfLine(units: PlanUnit[], stockLineId: string): PlanUnit[] {
  return units.filter((u) => u.stockLineId === stockLineId).sort((a, b) => a.boxSeq - b.boxSeq);
}

export function isPlacedUnit(unit: PlanUnit): boolean {
  return unit.status === 'placed' && unit.placement != null;
}

export function lineHasPlacedUnit(units: PlanUnit[], stockLineId: string): boolean {
  return units.some((u) => u.stockLineId === stockLineId && isPlacedUnit(u));
}

export function syncCreationFreshness(creation: PlanUnitCreation, line: StockLine): PlanUnitCreation {
  if (creation.status === 'applied' && creation.sourceBoxCount !== line.boxes) {
    return { ...creation, status: 'stale' };
  }
  return creation;
}

function replaceLineState(
  state: PlanUnitState,
  stockLineId: string,
  creation: PlanUnitCreation,
  units: PlanUnit[],
): PlanUnitState {
  return {
    creations: [...state.creations.filter((c) => c.stockLineId !== stockLineId), creation],
    planUnits: [...state.planUnits.filter((u) => u.stockLineId !== stockLineId), ...units],
  };
}

/** 确认通过：尚无 applied 或已 stale 时自动一箱一单元；已 applied 且箱数一致则幂等。 */
export function applyPlanUnitCreation(opts: {
  line: StockLine;
  creations: PlanUnitCreation[];
  planUnits: PlanUnit[];
  now?: string;
}): PlanUnitOpResult {
  const line = opts.line;
  const n = Math.floor(line.boxes);
  if (n < 1) {
    return {
      ok: false,
      code: PU_ERROR_CODES.PU_MIGRATE_FAIL,
      message: `${line.id} 箱数无效，无法分拆计划单元`,
      creations: opts.creations,
      planUnits: opts.planUnits,
    };
  }
  const existing = creationOfLine(opts.creations, line.id);
  const current = existing ? syncCreationFreshness(existing, line) : undefined;
  const units = unitsOfLine(opts.planUnits, line.id);
  if (current?.status === 'applied' && current.sourceBoxCount === n && current.createdCount === units.length) {
    return { ok: true, creations: opts.creations, planUnits: opts.planUnits, creation: current };
  }
  if (lineHasPlacedUnit(opts.planUnits, line.id)) {
    return {
      ok: false,
      code: PU_ERROR_CODES.PU_RECREATE_BLOCKED,
      message: `${line.id} 已有计划单元入柜，请先从组柜卸下后再重跑分拆`,
      creations: current && existing ? opts.creations.map((c) => (c.id === current.id ? current : c)) : opts.creations,
      planUnits: opts.planUnits,
    };
  }
  const version = (current?.version || 0) + 1;
  const creation: PlanUnitCreation = {
    id: current?.id || creationIdOf(line.id),
    stockLineId: line.id,
    ruleCode: PLAN_UNIT_RULE,
    sourceBoxCount: n,
    createdCount: n,
    status: 'applied',
    executedAt: nowIso(opts.now),
    version,
  };
  const nextUnits = createOneBoxOneUnit(line, creation.id, version);
  const next = replaceLineState({ creations: opts.creations, planUnits: opts.planUnits }, line.id, creation, nextUnits);
  return { ok: true, ...next, creation };
}

/** 重跑分拆：未放置可重建；任一 placed 则硬阻断。 */
export function rerunPlanUnitCreation(opts: {
  line: StockLine;
  creations: PlanUnitCreation[];
  planUnits: PlanUnit[];
  now?: string;
}): PlanUnitOpResult {
  if (lineHasPlacedUnit(opts.planUnits, opts.line.id)) {
    return {
      ok: false,
      code: PU_ERROR_CODES.PU_RECREATE_BLOCKED,
      message: `${opts.line.id} 已有计划单元入柜，请先从组柜卸下后再重跑分拆`,
      creations: opts.creations,
      planUnits: opts.planUnits,
    };
  }
  const existing = creationOfLine(opts.creations, opts.line.id);
  const without = {
    creations: opts.creations.filter((c) => c.stockLineId !== opts.line.id),
    planUnits: opts.planUnits.filter((u) => u.stockLineId !== opts.line.id),
  };
  const seeded = existing
    ? { ...without, creations: [...without.creations, { ...existing, status: 'stale' as const }] }
    : without;
  return applyPlanUnitCreation({
    line: opts.line,
    creations: seeded.creations,
    planUnits: seeded.planUnits,
    now: opts.now,
  });
}

export function remainingBoxesFromPlanUnits(line: StockLine, planUnits: PlanUnit[]): number {
  const mine = planUnits.filter((u) => u.stockLineId === line.id);
  if (!mine.length) return line.boxes;
  return Math.max(0, line.boxes - mine.filter(isPlacedUnit).length);
}

export function planUnitAsStockLine(unit: PlanUnit, parent: StockLine): StockLine {
  return {
    ...parent,
    id: unit.id,
    boxes: 1,
    boxVol: unit.vol,
    vol: unit.vol,
    dimL: unit.dimL ?? parent.dimL,
    dimW: unit.dimW ?? parent.dimW,
    dimH: unit.dimH ?? parent.dimH,
    salesOrderNo: unit.salesOrderNo ?? parent.salesOrderNo,
    salesOrderLine: unit.salesOrderLine ?? parent.salesOrderLine,
  };
}

export function groupPlanUnitsByStockLine(units: PlanUnit[]): Map<string, PlanUnit[]> {
  const map = new Map<string, PlanUnit[]>();
  for (const u of units) {
    const list = map.get(u.stockLineId) || [];
    list.push(u);
    map.set(u.stockLineId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.boxSeq - b.boxSeq);
  return map;
}

export function syncPlacementsFromContents(planUnits: PlanUnit[], contents: CabinetContent[]): PlanUnit[] {
  const next: PlanUnit[] = planUnits.map((u) => ({ ...u, placement: null, status: 'unassigned' }));
  const byId = new Map(next.map((u) => [u.id, u]));
  for (const c of contents) {
    if (c.hidden) continue;
    for (const tray of c.trays || []) {
      for (const row of tray.onTray || []) {
        if (!row.planUnitId) continue;
        const u = byId.get(row.planUnitId);
        if (!u) continue;
        u.placement = { contentId: c.id, trayInContentId: tray.id };
        u.status = 'placed';
      }
    }
  }
  return next;
}

/** 旧 Content 仅有 lines / 多箱 OnTray 时，把该行全部单元视为已放入该柜（迁移前占位）。 */
export function markLegacyLinePlacement(planUnits: PlanUnit[], contents: CabinetContent[]): PlanUnit[] {
  const synced = syncPlacementsFromContents(planUnits, contents);
  const byLine = groupPlanUnitsByStockLine(synced);
  for (const c of contents) {
    if (c.hidden) continue;
    const hasUnitRows = (c.trays || []).some((t) => (t.onTray || []).some((o) => o.planUnitId));
    if (hasUnitRows) continue;
    for (const lineId of c.lines || []) {
      const units = byLine.get(lineId);
      if (!units) continue;
      const trayId = c.trays?.[0]?.id || `${c.id}::legacy`;
      for (const u of units) {
        if (u.status === 'placed') continue;
        u.status = 'placed';
        u.placement = { contentId: c.id, trayInContentId: trayId };
      }
    }
  }
  return synced;
}

export function synthesizeUnitsForLines(
  lines: StockLine[],
  state: PlanUnitState,
  now?: string,
): PlanUnitState {
  let creations = state.creations.slice();
  let planUnits = state.planUnits.slice();
  for (const line of lines) {
    if (unitsOfLine(planUnits, line.id).length) continue;
    const applied = applyPlanUnitCreation({ line, creations, planUnits, now });
    if (!applied.ok) continue;
    creations = applied.creations;
    planUnits = applied.planUnits;
  }
  return { creations, planUnits };
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 && Math.floor(n) === n;
}

export interface MigratePlanUnitsResult {
  ok: boolean;
  code?: PuErrorCode;
  message?: string;
  contents: CabinetContent[];
  creations: PlanUnitCreation[];
  planUnits: PlanUnit[];
  schemaVersion: number;
  migrated: boolean;
}

function cloneContents(contents: CabinetContent[]): CabinetContent[] {
  return contents.map((c) => ({
    ...c,
    lines: [...(c.lines || [])],
    trays: (c.trays || []).map((t) => ({
      ...t,
      onTray: (t.onTray || []).map((o) => ({ ...o })),
    })),
  }));
}

function collectLineIds(contents: CabinetContent[]): string[] {
  const ids = new Set<string>();
  for (const c of contents) {
    for (const id of c.lines || []) ids.add(id);
    for (const tray of c.trays || []) {
      for (const row of tray.onTray || []) {
        if (row.stockLineId) ids.add(row.stockLineId);
      }
    }
  }
  return [...ids];
}

function alreadyMigrated(contents: CabinetContent[], schemaVersion?: number): boolean {
  if ((schemaVersion || 0) < PLAN_SCHEMA_VERSION) {
    const rows = contents.flatMap((c) => (c.trays || []).flatMap((t) => t.onTray || []));
    if (!rows.length) return (schemaVersion || 0) >= PLAN_SCHEMA_VERSION;
    return rows.every((r) => Boolean(r.planUnitId) && r.boxes === 1);
  }
  const rows = contents.flatMap((c) => (c.trays || []).flatMap((t) => t.onTray || []));
  if (!rows.length) return true;
  return rows.every((r) => Boolean(r.planUnitId) && r.boxes === 1);
}

/**
 * 旧 StockLinesOnTray → PlanUnitsOnTray。
 * 失败时保留原 contents，返回 PU_MIGRATE_FAIL。
 */
export function migratePlanToPlanUnits(opts: {
  contents: CabinetContent[];
  poolById: (id: string) => StockLine | undefined;
  creations?: PlanUnitCreation[];
  planUnits?: PlanUnit[];
  schemaVersion?: number;
  now?: string;
}): MigratePlanUnitsResult {
  const original = cloneContents(opts.contents);
  const baseState: PlanUnitState = {
    creations: (opts.creations || []).map((c) => ({ ...c })),
    planUnits: (opts.planUnits || []).map((u) => ({ ...u, placement: u.placement ? { ...u.placement } : null })),
  };
  if (alreadyMigrated(original, opts.schemaVersion) && (opts.schemaVersion || 0) >= PLAN_SCHEMA_VERSION) {
    return {
      ok: true,
      contents: original,
      creations: baseState.creations,
      planUnits: syncPlacementsFromContents(baseState.planUnits, original),
      schemaVersion: PLAN_SCHEMA_VERSION,
      migrated: false,
    };
  }

  try {
    const lineIds = collectLineIds(original);
    let state = baseState;
    for (const id of lineIds) {
      const line = opts.poolById(id);
      if (!line) {
        const occupied = original
          .flatMap((c) => (c.trays || []).flatMap((t) => t.onTray || []))
          .filter((r) => r.stockLineId === id)
          .reduce((s, r) => s + (r.boxes || 0), 0);
        if (occupied > 0 && !unitsOfLine(state.planUnits, id).length) {
          throw new Error(`缺少需求行 ${id}，无法迁移 OnTray`);
        }
        continue;
      }
      if (!unitsOfLine(state.planUnits, line.id).length) {
        const applied = applyPlanUnitCreation({
          line,
          creations: state.creations,
          planUnits: state.planUnits,
          now: opts.now,
        });
        if (!applied.ok) throw new Error(applied.message);
        state = { creations: applied.creations, planUnits: applied.planUnits };
      }
    }

    const used = new Map<string, Set<string>>();
    const takeUnits = (stockLineId: string, count: number): PlanUnit[] => {
      const pool = unitsOfLine(state.planUnits, stockLineId);
      const taken = used.get(stockLineId) || new Set<string>();
      const free = pool.filter((u) => !taken.has(u.id) && !isPlacedUnit(u));
      if (free.length < count) {
        throw new Error(`${stockLineId} 需要 ${count} 个计划单元，仅剩 ${free.length}`);
      }
      const picked = free.slice(0, count);
      for (const u of picked) taken.add(u.id);
      used.set(stockLineId, taken);
      return picked;
    };

    const nextContents = cloneContents(original);
    for (const c of nextContents) {
      if (!c.trays?.length) continue;
      for (const tray of c.trays) {
        const nextOn: PlanUnitsOnTray[] = [];
        for (const row of tray.onTray || []) {
          if (row.planUnitId && row.boxes === 1) {
            nextOn.push({ ...row, planUnitId: row.planUnitId, boxes: 1 });
            const taken = used.get(row.stockLineId) || new Set<string>();
            taken.add(row.planUnitId);
            used.set(row.stockLineId, taken);
            continue;
          }
          if (!row.stockLineId) throw new Error('OnTray 缺少 stockLineId');
          if (!isPositiveInt(row.boxes)) throw new Error(`${row.stockLineId} OnTray.boxes 不是正整数`);
          const picked = takeUnits(row.stockLineId, row.boxes);
          const volEach = picked[0]?.vol ?? (row.boxes ? row.vol / row.boxes : 0);
          for (const u of picked) {
            nextOn.push({
              id: `${tray.id}::${u.id}`,
              trayInContentId: tray.id,
              stockLineId: u.stockLineId,
              planUnitId: u.id,
              boxes: 1,
              vol: u.vol || volEach,
              splitOf: row.splitOf ?? null,
            });
          }
        }
        tray.onTray = nextOn;
        tray.boxes = nextOn.reduce((s, r) => s + (r.boxes || 0), 0);
        tray.vol = nextOn.reduce((s, r) => s + (r.vol || 0), 0);
      }
      const lineIdsFromTray = [
        ...new Set((c.trays || []).flatMap((t) => (t.onTray || []).map((o) => o.stockLineId).filter(Boolean))),
      ];
      if (lineIdsFromTray.length) c.lines = lineIdsFromTray;
    }

    const planUnits = syncPlacementsFromContents(state.planUnits, nextContents);
    for (const u of planUnits) assertPlanUnitInvariant(u);
    return {
      ok: true,
      contents: nextContents,
      creations: state.creations,
      planUnits,
      schemaVersion: PLAN_SCHEMA_VERSION,
      migrated: true,
    };
  } catch (err) {
    return {
      ok: false,
      code: PU_ERROR_CODES.PU_MIGRATE_FAIL,
      message: `计划单元迁移失败，已保留原装载：${(err as Error).message || err}`,
      contents: original,
      creations: baseState.creations,
      planUnits: baseState.planUnits,
      schemaVersion: opts.schemaVersion || 0,
      migrated: false,
    };
  }
}

export function onTrayRowForUnit(tray: TraysInCabinetContent, unit: PlanUnit): PlanUnitsOnTray {
  return {
    id: `${tray.id}::${unit.id}`,
    trayInContentId: tray.id,
    stockLineId: unit.stockLineId,
    planUnitId: unit.id,
    boxes: 1,
    vol: unit.vol,
  };
}

export function placedUnitIdsOnContents(contents: CabinetContent[]): Set<string> {
  const ids = new Set<string>();
  for (const c of contents) {
    if (c.hidden) continue;
    for (const tray of c.trays || []) {
      for (const row of tray.onTray || []) {
        if (row.planUnitId) ids.add(row.planUnitId);
      }
    }
  }
  return ids;
}
