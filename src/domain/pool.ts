import type { AppConfig, FurnaceRun, StockLine } from './entities';

export function isEligible(line: StockLine, cfg: AppConfig): boolean {
  return (
    cfg.eligibility.locations.includes(line.loc) &&
    cfg.eligibility.stockStatuses.includes(line.stockStatus) &&
    line.sterilizationMethod === 'EO'
  );
}

export function furnaceVol(f: FurnaceRun, poolById: (id: string) => StockLine | undefined): number {
  return f.lines.reduce((s, id) => s + (poolById(id)?.vol || 0), 0);
}

export function furnaceBoxes(f: FurnaceRun, poolById: (id: string) => StockLine | undefined): number {
  return f.lines.reduce((s, id) => s + (poolById(id)?.boxes || 0), 0);
}

export function furnaceCustomers(f: FurnaceRun, poolById: (id: string) => StockLine | undefined): string[] {
  return [...new Set(f.lines.map((id) => poolById(id)?.customer).filter((c): c is string => Boolean(c)))];
}

export function assignedIds(furnaces: FurnaceRun[]): Set<string> {
  const s = new Set<string>();
  furnaces.forEach((f) => f.lines.forEach((id) => s.add(id)));
  return s;
}

export function currentFurnaces(furnaces: FurnaceRun[], date: string, shift: string): FurnaceRun[] {
  return furnaces.filter((f) => f.date === date && f.shift === shift && !f.hidden);
}

export function needsSplit(line: StockLine, cfg: AppConfig): boolean {
  return Boolean(
    line.oversized ||
      line.vol > cfg.load.defaultMinM3 ||
      (line.boxVol >= cfg.box.largeBoxVol && line.boxes > cfg.box.maxBoxesWhenLarge),
  );
}

export function mergeVirtualLinesIntoPool(pool: StockLine[], virtualLines: StockLine[]): StockLine[] {
  const next = pool.slice();
  for (const vl of virtualLines) {
    if (!vl?.id) continue;
    const i = next.findIndex((p) => p.id === vl.id);
    if (i >= 0) next[i] = { ...next[i]!, ...vl };
    else next.push({ ...vl });
  }
  return next;
}

export function upsertVirtualLine(virtualLines: StockLine[], pool: StockLine[], row: StockLine): {
  virtualLines: StockLine[];
  pool: StockLine[];
} {
  const vls = virtualLines.slice();
  const vi = vls.findIndex((v) => v.id === row.id);
  if (vi >= 0) vls[vi] = row;
  else vls.push(row);
  const p = pool.slice();
  const pi = p.findIndex((x) => x.id === row.id);
  if (pi >= 0) p[pi] = { ...p[pi]!, ...row };
  else p.push(row);
  return { virtualLines: vls, pool: p };
}

export function visibleUnassignedPool(
  pool: StockLine[],
  furnaces: FurnaceRun[],
  cfg: AppConfig,
): StockLine[] {
  const assigned = assignedIds(furnaces);
  const splitParents = new Set(pool.filter((p) => p.splitOf).map((p) => p.splitOf!));
  return pool.filter(
    (p) =>
      isEligible(p, cfg) &&
      !assigned.has(p.id) &&
      !p.splitOf &&
      !splitParents.has(p.id),
  );
}

export function planRichness(furnaces: FurnaceRun[]): { loads: number; cabinets: number } {
  const visible = furnaces.filter((f) => !f.hidden && f.lines && f.lines.length);
  const cabs = new Set(visible.map((f) => f.cabinetId));
  return { loads: visible.length, cabinets: cabs.size };
}

export function isPlanSparse(furnaces: FurnaceRun[], minLoads: number, minCabs: number): boolean {
  const { loads, cabinets } = planRichness(furnaces);
  return loads < minLoads || cabinets < minCabs;
}

export function lookupPool(
  pool: StockLine[],
  virtualLines: StockLine[],
  id: string,
): StockLine | undefined {
  return pool.find((p) => p.id === id) || virtualLines.find((p) => p.id === id);
}
