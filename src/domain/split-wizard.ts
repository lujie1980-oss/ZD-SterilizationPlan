import type { FurnaceRun, Shift, StockLine } from './entities';
import { needsSplit } from './pool';
import type { AppConfig } from './entities';

export interface SplitPlan {
  parent: StockLine;
  boxesA: number;
  boxesB: number;
  cabinetId: string;
  rowA: StockLine;
  rowB: StockLine;
}

export function findSplitTarget(
  pool: StockLine[],
  selectedIds: Iterable<string>,
  assigned: Set<string>,
  cfg: AppConfig,
  poolById: (id: string) => StockLine | undefined,
): StockLine | undefined {
  for (const id of selectedIds) {
    const p = poolById(id);
    if (p && !assigned.has(id) && needsSplit(p, cfg)) return p;
  }
  return pool.find((p) => !assigned.has(p.id) && !p.splitOf && needsSplit(p, cfg));
}

export function buildSplitRows(
  line: StockLine,
  boxesA: number,
  date: string,
  shift: Shift,
): { rowA: StockLine; rowB: StockLine } {
  let a = boxesA;
  if (a < 1) a = 1;
  if (a > line.boxes - 1) a = line.boxes - 1;
  const b = line.boxes - a;
  const rowA: StockLine = {
    ...line,
    id: `${line.id}-A`,
    boxes: a,
    vol: +(a * line.boxVol).toFixed(2),
    name: `${line.name}（拆A）`,
    suggest: `拆炉自 ${line.id}`,
    splitOf: line.id,
    oversized: false,
    date,
    shift,
  };
  const rowB: StockLine = {
    ...line,
    id: `${line.id}-B`,
    boxes: b,
    vol: +(b * line.boxVol).toFixed(2),
    name: `${line.name}（拆B）`,
    suggest: `拆炉自 ${line.id}`,
    splitOf: line.id,
    oversized: false,
    date,
    shift,
  };
  return { rowA, rowB };
}

export function applySplit(opts: {
  parent: StockLine;
  boxesA: number;
  cabinetId: string;
  date: string;
  shift: Shift;
  nextSeq: number;
}): { rowA: StockLine; rowB: StockLine; furnaces: FurnaceRun[]; nextSeq: number } {
  const { rowA, rowB } = buildSplitRows(opts.parent, opts.boxesA, opts.date, opts.shift);
  let seq = opts.nextSeq;
  const fA: FurnaceRun = {
    id: `F${seq++}`,
    cabinetId: opts.cabinetId,
    shift: opts.shift,
    date: opts.date,
    lines: [rowA.id],
  };
  const fB: FurnaceRun = {
    id: `F${seq++}`,
    cabinetId: opts.cabinetId,
    shift: opts.shift,
    date: opts.date,
    lines: [rowB.id],
  };
  const hidden: FurnaceRun = {
    id: `F${seq++}`,
    cabinetId: opts.cabinetId,
    shift: opts.shift,
    date: opts.date,
    lines: [opts.parent.id],
    hidden: true,
  };
  return { rowA, rowB, furnaces: [fA, fB, hidden], nextSeq: seq };
}
