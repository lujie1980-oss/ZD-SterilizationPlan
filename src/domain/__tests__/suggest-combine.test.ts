import { describe, expect, it } from 'vitest';
import { createSeedPool } from '../../data/seed-pool';
import { SUGGEST_STRATEGY, suggestCombineD002Cab9 } from '../suggest-combine';
import type { StockLine } from '../entities';

describe('suggest-combine', () => {
  it('uses D002_CAB9_DEMO strategy id', () => {
    expect(SUGGEST_STRATEGY).toBe('D002_CAB9_DEMO');
  });

  it('toasts insufficient D002 when fewer than 2 unassigned rows', () => {
    const pool: StockLine[] = createSeedPool().filter((p) => p.id === 'P001');
    const { result } = suggestCombineD002Cab9({
      pool,
      furnaces: [],
      assigned: new Set(),
      date: '2026-07-24',
      shift: '白班',
      nextSeq: 1,
      minLoad: 56,
      poolById: (id) => pool.find((p) => p.id === id),
    });
    expect(result.ok).toBe(false);
    expect(result.added).toBe(0);
  });

  it('loads unassigned D002 into cabinet 9 toward minLoad 56', () => {
    const pool = createSeedPool();
    const { result, furnaces } = suggestCombineD002Cab9({
      pool,
      furnaces: [],
      assigned: new Set(),
      date: '2026-07-24',
      shift: '白班',
      nextSeq: 1,
      minLoad: 56,
      poolById: (id) => pool.find((p) => p.id === id),
    });
    expect(result.ok).toBe(true);
    expect(result.createdFurnace).toBe(true);
    const f = furnaces.find((x) => x.cabinetId === '柜9');
    expect(f).toBeTruthy();
    expect(f!.lines.length).toBeGreaterThanOrEqual(2);
    expect(f!.lines.every((id) => pool.find((p) => p.id === id)?.process === 'D002')).toBe(true);
  });
});
