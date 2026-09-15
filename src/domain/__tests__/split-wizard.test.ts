import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { applySplit, ensureSplitFurnaces, findSplitTarget } from '../split-wizard';
import type { StockLine } from '../entities';
import { isPlanSparse, mergeVirtualLinesIntoPool } from '../pool';

function oversizedLine(): StockLine {
  return {
    id: 'P004',
    factory: '3010',
    workshop: '制造七车间',
    matType: 'K',
    ref: 'REF-Z181-01',
    name: 'Z181 护理套装',
    customer: 'C-美敦力',
    due: '2026-07-25',
    wo: 'WO-3010-79101',
    boxes: 350,
    boxVol: 0.18,
    vol: 63,
    batch: 'B',
    loc: '待灭菌仓·新',
    stockStatus: '非限制',
    process: 'Z181',
    allowed: ['柜5', '柜7', '柜15'],
    urgent: true,
    oversized: true,
    sterilizationMethod: 'EO',
  };
}

describe('split-wizard', () => {
  it('finds oversized rows as split targets', () => {
    const p = oversizedLine();
    const found = findSplitTarget([p], [], new Set(), defaultAppConfig(), (id) => (id === p.id ? p : undefined));
    expect(found?.id).toBe('P004');
  });

  it('creates virtual A/B rows and a hidden parent furnace', () => {
    const parent = oversizedLine();
    const result = applySplit({
      parent,
      boxesA: 140,
      cabinetId: '柜5',
      date: '2026-07-24',
      shift: '白班',
      nextSeq: 1,
    });
    expect(result.rowA.id).toBe('P004-A');
    expect(result.rowB.id).toBe('P004-B');
    expect(result.rowA.splitOf).toBe('P004');
    expect(result.rowB.boxes).toBe(210);
    expect(result.rowA.vol).toBe(+(140 * 0.18).toFixed(2));
    expect(result.furnaces.filter((f) => !f.hidden).map((f) => f.lines[0])).toEqual(['P004-A', 'P004-B']);
    expect(result.furnaces.some((f) => f.hidden && f.lines[0] === 'P004')).toBe(true);
  });

  it('rehydrates virtualLines into the pool so poolById can resolve *-A/*-B', () => {
    const parent = oversizedLine();
    const { rowA, rowB } = applySplit({
      parent,
      boxesA: 140,
      cabinetId: '柜5',
      date: '2026-07-24',
      shift: '白班',
      nextSeq: 1,
    });
    const merged = mergeVirtualLinesIntoPool([parent], [rowA, rowB]);
    expect(merged.find((p) => p.id === 'P004-A')?.boxes).toBe(140);
    expect(merged.find((p) => p.id === 'P004-B')?.splitOf).toBe('P004');
  });

  it('does not treat a split session as a sparse demo plan', () => {
    const parent = oversizedLine();
    const result = applySplit({
      parent,
      boxesA: 140,
      cabinetId: '柜5',
      date: '2026-07-24',
      shift: '白班',
      nextSeq: 1,
    });
    expect(isPlanSparse(result.furnaces, 5, 5, [result.rowA, result.rowB])).toBe(false);
  });

  it('restores missing *-A/*-B furnaces from virtualLines', () => {
    const parent = oversizedLine();
    const { rowA, rowB } = applySplit({
      parent,
      boxesA: 140,
      cabinetId: '柜5',
      date: '2026-07-24',
      shift: '白班',
      nextSeq: 1,
    });
    const restored = ensureSplitFurnaces([], [rowA, rowB], 1);
    const lineIds = restored.furnaces.filter((f) => !f.hidden).flatMap((f) => f.lines);
    expect(lineIds).toEqual(expect.arrayContaining(['P004-A', 'P004-B']));
    expect(restored.furnaces.some((f) => f.hidden && f.lines.includes('P004'))).toBe(true);
  });
});
