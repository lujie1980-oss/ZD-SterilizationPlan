import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, STORAGE_KEY_LEGACY } from '../../data/config-defaults';
import { loadPlan, savePlan, serializePlan } from '../../persistence/plan-store-v2';
import { defaultAppConfig } from '../../data/config-defaults';
import { mergeVirtualLinesIntoPool } from '../pool';
import { isEligible } from '../pool';
import { createSeedPool } from '../../data/seed-pool';

describe('plan-store-v2', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('round-trips virtualLines so split children survive reload', () => {
    const virtualLines = [
      {
        id: 'P004-A',
        splitOf: 'P004',
        boxes: 140,
        vol: 25.2,
        process: 'Z181',
        customer: 'C-美敦力',
        allowed: ['柜5', '柜7', '柜15'],
        date: '2026-07-24',
        shift: '白班' as const,
        factory: '3010',
        workshop: '制造七车间',
        matType: 'K' as const,
        ref: 'REF-Z181-01',
        name: 'Z181 护理套装（拆A）',
        due: '2026-07-25',
        wo: 'WO',
        boxVol: 0.18,
        batch: 'B',
        loc: '待灭菌仓·新',
        stockStatus: '非限制',
        urgent: true,
        sterilizationMethod: 'EO' as const,
      },
    ];
    savePlan({
      date: '2026-07-24',
      shift: '白班',
      furnaces: [
        { id: 'F1', cabinetId: '柜5', date: '2026-07-24', shift: '白班', lines: ['P004-A'] },
        { id: 'F2', cabinetId: '柜5', date: '2026-07-24', shift: '白班', lines: ['P004-B'] },
        { id: 'F3', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P001'] },
        { id: 'F4', cabinetId: '柜8', date: '2026-07-24', shift: '白班', lines: ['P013'] },
        { id: 'F5', cabinetId: '柜12', date: '2026-07-25', shift: '白班', lines: ['P006'] },
        { id: 'F6', cabinetId: '柜3', date: '2026-07-24', shift: '夜班', lines: ['P007'] },
      ],
      nextFurnaceSeq: 7,
      virtualLines,
      config: defaultAppConfig(),
      planSeedVersion: 2,
      sparseWiped: false,
    });
    const loaded = loadPlan();
    expect(loaded.virtualLines.some((v) => v.id === 'P004-A' && v.splitOf === 'P004')).toBe(true);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toContain('"virtualLines"');
    const merged = mergeVirtualLinesIntoPool(createSeedPool(), loaded.virtualLines);
    expect(merged.find((p) => p.id === 'P004-A')?.boxes).toBe(140);
  });

  it('keeps virtualLines when wiping a sparse snapshot for demo reseed', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        date: '2026-07-24',
        shift: '白班',
        furnaces: [{ id: 'F1', cabinetId: '柜3', date: '2026-07-24', shift: '白班', lines: ['P007'] }],
        nextFurnaceSeq: 2,
        virtualLines: [{ id: 'P004-A', splitOf: 'P004', boxes: 140, vol: 25.2, process: 'Z181' }],
        config: { allowFiller: false, mixCustomerWarn: true },
        planSeedVersion: 2,
      }),
    );
    const loaded = loadPlan();
    expect(loaded.sparseWiped).toBe(true);
    expect(loaded.furnaces).toEqual([]);
    expect(loaded.virtualLines[0]?.id).toBe('P004-A');
  });

  it('migrates a rich v1 plan and drops the legacy key', () => {
    const rich = {
      date: '2026-07-24',
      shift: '白班',
      furnaces: [
        { id: 'F1', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P001'] },
        { id: 'F2', cabinetId: '柜8', date: '2026-07-24', shift: '白班', lines: ['P013'] },
        { id: 'F3', cabinetId: '柜12', date: '2026-07-25', shift: '白班', lines: ['P006'] },
        { id: 'F4', cabinetId: '柜3', date: '2026-07-24', shift: '夜班', lines: ['P007'] },
        { id: 'F5', cabinetId: '柜5', date: '2026-07-24', shift: '白班', lines: ['P004'] },
      ],
      nextFurnaceSeq: 6,
      config: {},
    };
    localStorage.setItem(STORAGE_KEY_LEGACY, JSON.stringify(rich));
    const loaded = loadPlan();
    expect(loaded.furnaces.length).toBe(5);
    expect(localStorage.getItem(STORAGE_KEY_LEGACY)).toBeNull();
  });

  it('does not wipe a sparse plan when demo seed is disabled', () => {
    const cfg = defaultAppConfig();
    cfg.demo.enableSeed = false;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        date: '2026-07-24',
        shift: '白班',
        furnaces: [{ id: 'F1', cabinetId: '柜3', date: '2026-07-24', shift: '白班', lines: ['P007'] }],
        nextFurnaceSeq: 2,
        virtualLines: [],
        config: cfg,
        planSeedVersion: 2,
      }),
    );
    const loaded = loadPlan();
    expect(loaded.sparseWiped).toBe(false);
    expect(loaded.furnaces).toHaveLength(1);
  });

  it('serializes virtualLines as a first-class plan v2 field', () => {
    const snap = serializePlan({
      date: '2026-07-24',
      shift: '白班',
      furnaces: [],
      nextFurnaceSeq: 1,
      virtualLines: [{ id: 'P004-A', splitOf: 'P004' } as never],
      config: defaultAppConfig(),
      planSeedVersion: 2,
      sparseWiped: false,
    });
    expect(Array.isArray(snap.virtualLines)).toBe(true);
    expect(snap.virtualLines[0]?.id).toBe('P004-A');
  });
});

describe('eligibility', () => {
  it('keeps unrestricted EO lines in 待灭菌仓 and drops restricted stock', () => {
    const cfg = defaultAppConfig();
    const pool = createSeedPool();
    expect(isEligible(pool.find((p) => p.id === 'P001')!, cfg)).toBe(true);
    expect(isEligible(pool.find((p) => p.id === 'P015')!, cfg)).toBe(false);
  });
});
