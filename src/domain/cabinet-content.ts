import type {
  Cabinet,
  CabinetContent,
  ContentLineShare,
  ContentStatus,
  FurnaceRun,
  StockLine,
  StockLinesOnTray,
  Tray,
  TraysInCabinetContent,
} from './entities';
import { furnaceVol, largeBoxCount } from './pool';
import {
  aggregateShares,
  cloneShares,
  makeShare,
  shareVol,
} from './volume-pack';

export function flattenOnTrayIds(trays: TraysInCabinetContent[] | undefined): string[] {
  if (!trays?.length) return [];
  const ids: string[] = [];
  for (const tray of trays) {
    for (const row of tray.onTray || []) {
      if (row.stockLineId && !ids.includes(row.stockLineId)) ids.push(row.stockLineId);
    }
  }
  return ids;
}

export function flattenShareIds(shares: ContentLineShare[] | undefined): string[] {
  if (!shares?.length) return [];
  const ids: string[] = [];
  for (const s of shares) {
    if (s.stockLineId && !ids.includes(s.stockLineId)) ids.push(s.stockLineId);
  }
  return ids;
}

function sharesFromTrays(trays: TraysInCabinetContent[] | undefined, poolById: (id: string) => StockLine | undefined, largeBoxVol: number): ContentLineShare[] {
  const byId = new Map<string, ContentLineShare>();
  for (const tray of trays || []) {
    for (const row of tray.onTray || []) {
      if (!row.stockLineId) continue;
      const line = poolById(row.stockLineId);
      const boxVol = line?.boxVol ?? (row.boxes ? row.vol / row.boxes : 0);
      const add = makeShare({ id: row.stockLineId, boxVol }, row.boxes || 0, largeBoxVol);
      if (row.vol != null && Number.isFinite(row.vol)) add.vol = row.vol;
      const cur = byId.get(row.stockLineId);
      if (!cur) byId.set(row.stockLineId, add);
      else {
        cur.boxes += add.boxes;
        cur.vol = +(cur.vol + add.vol).toFixed(6);
        cur.largeBoxes += add.largeBoxes;
      }
    }
  }
  return [...byId.values()];
}

function sharesFromLineIds(lineIds: string[], poolById: (id: string) => StockLine | undefined, largeBoxVol: number): ContentLineShare[] {
  const shares: ContentLineShare[] = [];
  for (const id of lineIds) {
    const line = poolById(id);
    if (!line) {
      shares.push({ stockLineId: id, boxes: 0, vol: 0, largeBoxes: 0 });
      continue;
    }
    shares.push(makeShare(line, line.boxes, largeBoxVol));
  }
  return shares;
}

export function syncShare(
  raw: ContentLineShare,
  poolById: (id: string) => StockLine | undefined,
  largeBoxVol: number,
): ContentLineShare {
  const line = poolById(raw.stockLineId);
  const boxes = raw.boxes ?? line?.boxes ?? 0;
  const boxVol = line?.boxVol ?? 0;
  const vol = raw.vol != null && Number.isFinite(raw.vol) ? raw.vol : shareVol(boxVol, boxes);
  const largeBoxes =
    raw.largeBoxes != null && Number.isFinite(raw.largeBoxes)
      ? raw.largeBoxes
      : line
        ? makeShare(line, boxes, largeBoxVol).largeBoxes
        : 0;
  return { stockLineId: raw.stockLineId, boxes, vol, largeBoxes };
}

export function sharesOfContent(
  content: CabinetContent,
  poolById: (id: string) => StockLine | undefined,
  largeBoxVol: number,
): ContentLineShare[] {
  if (content.stockShares?.length) {
    return content.stockShares.map((s) => syncShare(s, poolById, largeBoxVol));
  }
  if (content.trays?.some((t) => t.onTray?.length)) {
    return sharesFromTrays(content.trays, poolById, largeBoxVol);
  }
  return sharesFromLineIds(content.lines || [], poolById, largeBoxVol);
}

export function contentTotals(
  content: CabinetContent,
  poolById: (id: string) => StockLine | undefined,
  largeBoxVol: number,
): { totalVol: number; largeBoxCount: number; lineIds: string[]; shares: ContentLineShare[] } {
  const shares = sharesOfContent(content, poolById, largeBoxVol);
  const agg = aggregateShares(shares);
  return { ...agg, shares };
}

export function contentVol(content: CabinetContent, poolById: (id: string) => StockLine | undefined): number {
  if (content.stockShares?.length) {
    return aggregateShares(content.stockShares).totalVol;
  }
  if (content.totalVol != null && Number.isFinite(content.totalVol) && content.totalVol > 0) {
    return content.totalVol;
  }
  if (content.trays?.length) {
    const fromTrays = content.trays.reduce((s, t) => s + (t.vol || 0), 0);
    if (fromTrays > 0) return fromTrays;
  }
  return furnaceVol(content, poolById);
}

export function fillRateOf(content: CabinetContent, cabinet: Cabinet | undefined, poolById: (id: string) => StockLine | undefined): number {
  const denom = cabinet?.ratedLoadM3 || cabinet?.capacity || 0;
  if (denom <= 0) return 0;
  return contentVol(content, poolById) / denom;
}

export function syncTrayAggregates(
  tray: TraysInCabinetContent,
  poolById: (id: string) => StockLine | undefined,
  largeBoxVol: number,
): TraysInCabinetContent {
  const onTray = (tray.onTray || []).map((row) => ({ ...row }));
  let vol = 0;
  let boxes = 0;
  const lineSnaps: Array<Pick<StockLine, 'boxVol' | 'boxes'>> = [];
  for (const row of onTray) {
    const line = poolById(row.stockLineId);
    if (row.vol == null || !Number.isFinite(row.vol)) row.vol = line?.vol ?? 0;
    if (row.boxes == null || !Number.isFinite(row.boxes)) row.boxes = line?.boxes ?? 0;
    vol += row.vol;
    boxes += row.boxes;
    lineSnaps.push({ boxVol: line?.boxVol ?? 0, boxes: row.boxes });
  }
  return {
    ...tray,
    onTray,
    vol,
    boxes,
    largeBoxes: largeBoxCount(lineSnaps, largeBoxVol),
  };
}

export function traysForCabinet(cabinetId: string, trayMaster: Tray[]): Tray[] {
  return trayMaster
    .filter((t) => t.cabinetId === cabinetId && t.status !== '停用')
    .slice()
    .sort((a, b) => a.level - b.level);
}

export function hydrateTraysFromLines(opts: {
  contentId: string;
  cabinetId: string;
  lineIds: string[];
  trayMaster: Tray[];
  poolById: (id: string) => StockLine | undefined;
  largeBoxVol: number;
}): TraysInCabinetContent[] {
  const { contentId, cabinetId, lineIds, trayMaster, poolById, largeBoxVol } = opts;
  const master = traysForCabinet(cabinetId, trayMaster);
  const trays: TraysInCabinetContent[] = [];
  if (!lineIds.length) return trays;

  const pickTray = (index: number): Tray => {
    if (master.length) return master[Math.min(index, master.length - 1)]!;
    return {
      id: `${cabinetId}-tray-${String(index + 1).padStart(2, '0')}`,
      cabinetId,
      level: index + 1,
      displayName: `第${index + 1}层托盘`,
      status: '可用',
    };
  };

  lineIds.forEach((lineId, i) => {
    const trayMd = pickTray(i);
    const line = poolById(lineId);
    const trayInId = `${contentId}::${trayMd.id}`;
    const on: StockLinesOnTray = {
      id: `${trayInId}::${lineId}`,
      trayInContentId: trayInId,
      stockLineId: lineId,
      boxes: line?.boxes ?? 0,
      vol: line?.vol ?? 0,
      splitOf: line?.splitOf ?? null,
    };
    const existing = trays.find((t) => t.trayId === trayMd.id);
    if (existing) {
      existing.onTray.push(on);
    } else {
      trays.push({
        id: trayInId,
        contentId,
        trayId: trayMd.id,
        level: trayMd.level,
        vol: 0,
        boxes: 0,
        largeBoxes: 0,
        onTray: [on],
      });
    }
  });
  return trays.map((t) => syncTrayAggregates(t, poolById, largeBoxVol));
}

export function trayCapacityM3(tray: Pick<Tray, 'capacityM3' | 'ratedLoadM3'> | undefined): number {
  return tray?.capacityM3 ?? tray?.ratedLoadM3 ?? 0;
}

export function isTrayOver(vol: number, capacityM3: number): boolean {
  return capacityM3 > 0 && vol > capacityM3 + 1e-9;
}

function occupiedQty(line: StockLine, contents: CabinetContent[], kind: 'boxes' | 'vol', excludeContentId?: string): number {
  let n = 0;
  for (const c of contents) {
    if (c.hidden || c.id === excludeContentId) continue;
    let hit = false;
    if (c.stockShares?.length) {
      for (const share of c.stockShares) {
        if (share.stockLineId !== line.id) continue;
        n += kind === 'boxes' ? share.boxes || 0 : share.vol || 0;
        hit = true;
      }
      if (hit) continue;
    }
    for (const tray of c.trays || []) {
      for (const row of tray.onTray || []) {
        if (row.stockLineId !== line.id) continue;
        n += kind === 'boxes' ? row.boxes || 0 : row.vol || 0;
        hit = true;
      }
    }
    if (!hit && c.lines.includes(line.id)) {
      n += kind === 'boxes' ? line.boxes : line.vol;
    }
  }
  return n;
}

/** 各柜 OnTray 已占用箱数；无 trays 的扁平行视为整行占用 */
export function occupiedBoxesOf(line: StockLine, contents: CabinetContent[], excludeContentId?: string): number {
  return occupiedQty(line, contents, 'boxes', excludeContentId);
}

export function occupiedVolOf(line: StockLine, contents: CabinetContent[], excludeContentId?: string): number {
  return occupiedQty(line, contents, 'vol', excludeContentId);
}

export function remainingBoxes(line: StockLine, contents: CabinetContent[], excludeContentId?: string): number {
  return Math.max(0, line.boxes - occupiedBoxesOf(line, contents, excludeContentId));
}

export function remainingVol(line: StockLine, contents: CabinetContent[], excludeContentId?: string): number {
  return Math.max(0, line.vol - occupiedVolOf(line, contents, excludeContentId));
}

export function onTrayShareOf(content: CabinetContent, stockLineId: string): { boxes: number; vol: number } {
  if (content.stockShares?.length) {
    let boxes = 0;
    let vol = 0;
    for (const share of content.stockShares) {
      if (share.stockLineId !== stockLineId) continue;
      boxes += share.boxes || 0;
      vol += share.vol || 0;
    }
    if (boxes || vol) return { boxes, vol };
  }
  let boxes = 0;
  let vol = 0;
  for (const tray of content.trays || []) {
    for (const row of tray.onTray || []) {
      if (row.stockLineId !== stockLineId) continue;
      boxes += row.boxes || 0;
      vol += row.vol || 0;
    }
  }
  return { boxes, vol };
}

export function cloneContent(f: CabinetContent): CabinetContent {
  return {
    ...f,
    lines: [...(f.lines || [])],
    stockShares: cloneShares(f.stockShares),
    trays: (f.trays || []).map((t) => ({
      ...t,
      onTray: (t.onTray || []).map((o) => ({ ...o })),
    })),
  };
}

export function inferStatus(partial: Partial<CabinetContent>): ContentStatus {
  if (partial.status) return partial.status;
  if (partial.hidden) return 'closed';
  if (partial.date) return 'scheduled';
  if (partial.loadComplete) return 'active';
  if (
    (partial.lines && partial.lines.length) ||
    (partial.stockShares && partial.stockShares.length) ||
    (partial.trays && partial.trays.length)
  ) {
    return 'active';
  }
  return 'draft';
}

export function normalizeCabinetContent(
  raw: Partial<CabinetContent> & Pick<CabinetContent, 'id' | 'cabinetId'>,
  opts: {
    trayMaster: Tray[];
    poolById: (id: string) => StockLine | undefined;
    largeBoxVol: number;
    cabinet?: Cabinet;
    /** 变更-8 主路径默认不强制托盘层；旧 lines 字面量仍可分层以兼容 C1 */
    hydrateTrays?: boolean;
  },
): CabinetContent {
  const providedShares = (raw.stockShares || []).map((s) => syncShare(s, opts.poolById, opts.largeBoxVol));
  const lineIdsFromRaw = (raw.lines && raw.lines.length ? raw.lines : flattenOnTrayIds(raw.trays)).slice();
  const hydrateTrays = opts.hydrateTrays ?? providedShares.length === 0;

  let trays = (raw.trays || []).map((t) => syncTrayAggregates(t, opts.poolById, opts.largeBoxVol));
  const missingTrayId = trays.some((t) => !t.trayId);
  if (hydrateTrays) {
    if (!trays.length && lineIdsFromRaw.length) {
      trays = hydrateTraysFromLines({
        contentId: raw.id,
        cabinetId: raw.cabinetId,
        lineIds: lineIdsFromRaw,
        trayMaster: opts.trayMaster,
        poolById: opts.poolById,
        largeBoxVol: opts.largeBoxVol,
      });
    } else if (missingTrayId) {
      trays = hydrateTraysFromLines({
        contentId: raw.id,
        cabinetId: raw.cabinetId,
        lineIds: lineIdsFromRaw,
        trayMaster: opts.trayMaster,
        poolById: opts.poolById,
        largeBoxVol: opts.largeBoxVol,
      });
    }
  } else if (!raw.trays?.length) {
    trays = [];
  }

  let stockShares = providedShares;
  if (!stockShares.length) {
    stockShares = trays.some((t) => t.onTray?.length)
      ? sharesFromTrays(trays, opts.poolById, opts.largeBoxVol)
      : sharesFromLineIds(lineIdsFromRaw, opts.poolById, opts.largeBoxVol);
  }

  const agg = aggregateShares(stockShares);
  const syncedLines = agg.lineIds.length ? agg.lineIds : flattenOnTrayIds(trays).length ? flattenOnTrayIds(trays) : lineIdsFromRaw;
  const date = raw.date ?? null;
  const shift = raw.shift ?? null;
  const status = inferStatus({ ...raw, lines: syncedLines, stockShares, date });
  const scheduleStatus = raw.scheduleStatus ?? (date ? 'scheduled' : 'unscheduled');
  const content: CabinetContent = {
    id: raw.id,
    cabinetId: raw.cabinetId,
    date,
    shift,
    seq: raw.seq ?? null,
    lines: syncedLines,
    stockShares,
    totalVol: agg.totalVol,
    largeBoxCount: agg.largeBoxCount,
    trays,
    status,
    scheduleStatus,
    fillRate: 0,
    loadComplete: Boolean(raw.loadComplete),
    editSource: raw.editSource,
    taskId: raw.taskId ?? null,
    hidden: raw.hidden,
    demoSeed: raw.demoSeed,
    manualViolation: raw.manualViolation,
    overrideNote: raw.overrideNote,
  };
  content.fillRate = fillRateOf(content, opts.cabinet, opts.poolById);
  return content;
}

/** 兼容测试/旧代码的炉次字面量（date/shift 可缺省） */
export function asContent(
  partial: Partial<CabinetContent> & Pick<CabinetContent, 'cabinetId'> & { lines?: string[]; id?: string },
): CabinetContent {
  const lines = partial.lines
    ? [...partial.lines]
    : flattenShareIds(partial.stockShares).length
      ? flattenShareIds(partial.stockShares)
      : flattenOnTrayIds(partial.trays);
  const date = partial.date === undefined ? null : partial.date;
  const shift = partial.shift === undefined ? null : partial.shift;
  return {
    id: partial.id || 'F1',
    cabinetId: partial.cabinetId,
    date,
    shift,
    seq: partial.seq ?? null,
    lines,
    stockShares: cloneShares(partial.stockShares),
    totalVol: partial.totalVol,
    largeBoxCount: partial.largeBoxCount,
    trays: partial.trays ? partial.trays.map((t) => ({ ...t, onTray: [...(t.onTray || [])] })) : [],
    status: inferStatus({ ...partial, lines, date }),
    scheduleStatus: partial.scheduleStatus ?? (date ? 'scheduled' : 'unscheduled'),
    fillRate: partial.fillRate ?? 0,
    loadComplete: Boolean(partial.loadComplete),
    editSource: partial.editSource,
    taskId: partial.taskId ?? null,
    hidden: partial.hidden,
    demoSeed: partial.demoSeed,
    manualViolation: partial.manualViolation,
    overrideNote: partial.overrideNote,
  };
}

export function createUnscheduledContent(opts: {
  id: string;
  cabinetId: string;
  lineIds?: string[];
  trayMaster: Tray[];
  poolById: (id: string) => StockLine | undefined;
  largeBoxVol: number;
  cabinet?: Cabinet;
  editSource?: CabinetContent['editSource'];
}): CabinetContent {
  return normalizeCabinetContent(
    {
      id: opts.id,
      cabinetId: opts.cabinetId,
      date: null,
      shift: null,
      seq: null,
      lines: opts.lineIds || [],
      status: opts.lineIds?.length ? 'active' : 'draft',
      scheduleStatus: 'unscheduled',
      fillRate: 0,
      loadComplete: false,
      editSource: opts.editSource,
      taskId: null,
    },
    opts,
  );
}

export function findPlacement(
  lineId: string,
  contents: CabinetContent[],
): { content: CabinetContent; cabinetId: string } | undefined {
  for (const c of contents) {
    if (c.hidden) continue;
    const onShare = (c.stockShares || []).some((s) => s.stockLineId === lineId && (s.boxes > 0 || s.vol > 0));
    const on = onShare || c.lines.includes(lineId) || (c.trays || []).some((t) => t.onTray.some((o) => o.stockLineId === lineId));
    if (on) return { content: c, cabinetId: c.cabinetId };
  }
  return undefined;
}

export function activeContentsOfCabinet(contents: CabinetContent[], cabinetId: string): CabinetContent[] {
  return contents.filter(
    (c) =>
      c.cabinetId === cabinetId &&
      !c.hidden &&
      (c.status === 'draft' || c.status === 'active' || (c.loadComplete && c.status !== 'closed' && c.status !== 'inSterilization' && c.status !== 'scheduled')),
  );
}

export function findReusableContent(contents: CabinetContent[], cabinetId: string): CabinetContent | undefined {
  const actives = contents.filter(
    (c) =>
      c.cabinetId === cabinetId &&
      !c.hidden &&
      (c.status === 'draft' || c.status === 'active' || (c.loadComplete && c.scheduleStatus === 'unscheduled')),
  );
  return actives[0];
}

export function isUnscheduled(c: CabinetContent): boolean {
  return !c.date && !c.shift && c.scheduleStatus !== 'scheduled';
}

export type LegacyFurnaceInput = Partial<FurnaceRun> & {
  id?: string;
  cabinetId: string;
  date?: string | null;
  shift?: FurnaceRun['shift'] | null;
  lines?: string[];
};

/** 将旧 FurnaceRun 字面量（必填 date/shift）抬升为可空组柜结构 */
export function liftLegacyFurnace(raw: LegacyFurnaceInput): CabinetContent {
  return asContent({
    ...raw,
    id: raw.id || 'F1',
    cabinetId: raw.cabinetId,
    date: raw.date ?? null,
    shift: raw.shift ?? null,
    lines: raw.lines || [],
  });
}
