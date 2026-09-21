import type { BoxConfig, Cabinet, ContentLineShare, StockLine, ValidationIssue } from './entities';
import { ISSUE_CODES } from './entities';

export type VolumePackReject = typeof ISSUE_CODES.VOL_OVERFLOW | typeof ISSUE_CODES.BOX_LIMIT;

const EPS = 1e-9;

export function isLargeBox(boxVol: number, largeBoxVol: number): boolean {
  return boxVol >= largeBoxVol - EPS;
}

export function largeBoxesOf(boxVol: number, boxes: number, largeBoxVol: number): number {
  return isLargeBox(boxVol, largeBoxVol) ? boxes : 0;
}

export function shareVol(boxVol: number, boxes: number): number {
  return +(boxes * boxVol).toFixed(6);
}

export function makeShare(line: Pick<StockLine, 'id' | 'boxVol'>, boxes: number, largeBoxVol: number): ContentLineShare {
  const qty = Math.max(0, boxes);
  return {
    stockLineId: line.id,
    boxes: qty,
    vol: shareVol(line.boxVol, qty),
    largeBoxes: largeBoxesOf(line.boxVol, qty, largeBoxVol),
  };
}

export function volFitBoxes(totalVol: number, ratedLoadM3: number, boxVol: number): number {
  if (boxVol <= EPS) return 0;
  if (ratedLoadM3 <= 0) return 0;
  const room = ratedLoadM3 - totalVol;
  if (room <= EPS) return 0;
  return Math.floor((room + EPS) / boxVol);
}

export function evaluateAppend(opts: {
  totalVol: number;
  largeBoxCount: number;
  ratedLoadM3: number;
  addBoxes: number;
  boxVol: number;
  box: BoxConfig;
}): { ok: true } | { ok: false; code: VolumePackReject } {
  const addVol = shareVol(opts.boxVol, opts.addBoxes);
  const addLarge = largeBoxesOf(opts.boxVol, opts.addBoxes, opts.box.largeBoxVol);
  if (opts.ratedLoadM3 > 0 && opts.totalVol + addVol > opts.ratedLoadM3 + EPS) {
    return { ok: false, code: ISSUE_CODES.VOL_OVERFLOW };
  }
  if (opts.largeBoxCount + addLarge > opts.box.maxBoxesWhenLarge) {
    return { ok: false, code: ISSUE_CODES.BOX_LIMIT };
  }
  return { ok: true };
}

/** 余量 B：大箱满 280 后本炉不再追加大箱，小箱仍可（体积允许时）。不改写箱规。 */
export function takeBoxesRemainderB(opts: {
  totalVol: number;
  largeBoxCount: number;
  ratedLoadM3: number;
  remainingBoxes: number;
  boxVol: number;
  box: BoxConfig;
}): number {
  const remaining = Math.max(0, Math.floor(opts.remainingBoxes));
  if (remaining <= 0) return 0;
  const volFit = volFitBoxes(opts.totalVol, opts.ratedLoadM3, opts.boxVol);
  if (isLargeBox(opts.boxVol, opts.box.largeBoxVol)) {
    const roomLarge = opts.box.maxBoxesWhenLarge - opts.largeBoxCount;
    if (roomLarge <= 0) return 0;
    return Math.max(0, Math.min(remaining, roomLarge, volFit));
  }
  return Math.max(0, Math.min(remaining, volFit));
}

export function mergeShare(shares: ContentLineShare[], add: ContentLineShare): ContentLineShare[] {
  const next = shares.map((s) => ({ ...s }));
  const i = next.findIndex((s) => s.stockLineId === add.stockLineId);
  if (i < 0) {
    next.push({ ...add });
    return next;
  }
  const cur = next[i]!;
  next[i] = {
    stockLineId: cur.stockLineId,
    boxes: cur.boxes + add.boxes,
    vol: +(cur.vol + add.vol).toFixed(6),
    largeBoxes: cur.largeBoxes + add.largeBoxes,
  };
  return next;
}

export function remainingView(line: StockLine, remainingBoxes: number): StockLine {
  const boxes = Math.max(0, remainingBoxes);
  return { ...line, boxes, vol: shareVol(line.boxVol, boxes) };
}

export function ratedLoadOf(cabinet: Cabinet | undefined): number {
  return cabinet?.ratedLoadM3 || cabinet?.capacity || 0;
}

export function volOverflowIssue(opts: {
  furnaceId: string;
  cabinetId: string;
  totalVol: number;
  ratedLoadM3: number;
}): ValidationIssue {
  return {
    sev: 'error',
    code: ISSUE_CODES.VOL_OVERFLOW,
    msg: `体积超柜容：已装 ${opts.totalVol.toFixed(1)}m³ > 额定 ${opts.ratedLoadM3}m³（VOL_OVERFLOW）`,
    furnaceId: opts.furnaceId,
    cabinetId: opts.cabinetId,
  };
}

export function boxLimitIssue(opts: {
  furnaceId: string;
  largeBoxes: number;
  largeBoxVol: number;
  maxBoxesWhenLarge: number;
}): ValidationIssue {
  return {
    sev: 'error',
    code: ISSUE_CODES.BOX_LIMIT,
    msg: `大箱（单箱≥${opts.largeBoxVol}m³）合计 ${opts.largeBoxes} 箱，超过每炉上限 ${opts.maxBoxesWhenLarge}（BOX_LIMIT）`,
    furnaceId: opts.furnaceId,
  };
}

export function cloneShares(shares: ContentLineShare[] | undefined): ContentLineShare[] {
  return (shares || []).map((s) => ({ ...s }));
}

export function aggregateShares(shares: ContentLineShare[]): { totalVol: number; largeBoxCount: number; lineIds: string[] } {
  let totalVol = 0;
  let largeBoxCount = 0;
  const lineIds: string[] = [];
  for (const s of shares) {
    totalVol += s.vol || 0;
    largeBoxCount += s.largeBoxes || 0;
    if (s.stockLineId && !lineIds.includes(s.stockLineId)) lineIds.push(s.stockLineId);
  }
  return { totalVol: +totalVol.toFixed(6), largeBoxCount, lineIds };
}
