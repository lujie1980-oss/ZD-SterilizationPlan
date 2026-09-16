import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { CABINETS, TRAYS, traysForCabinet } from '../../data/seed-cabinets';
import { createSeedPool } from '../../data/seed-pool';
import { PROCESSES } from '../../data/seed-processes';
import { occupiedBoxesOf, remainingBoxes } from '../cabinet-content';
import { demoRuntimeOverrides, deriveAllRuntimes } from '../cabinet-runtime';
import { decideCommit } from '../commit-gate';
import type { AppConfig, Cabinet, CabinetContent, PackSuggestPolicy, RuleContext, StockLine, Tray } from '../entities';
import { PACK_POLICY_ERROR_CODES } from '../entities';
import { autoPackCabinet, autoPackDemands, listEligibleForCabinet, manualPackCabinet } from '../grouping';
import {
  clonePackSuggestPolicy,
  commitPackSuggestPolicy,
  defaultPackSuggestPolicy,
  policyFromPreset,
  restoreDefaultPackSuggestPolicy,
  validatePackSuggestPolicy,
} from '../pack-suggest-policy';
import { validateFurnace } from '../rule-engine';

function stock(
  partial: Partial<StockLine> & Pick<StockLine, 'id' | 'process' | 'allowed' | 'boxes'>,
): StockLine {
  const boxes = partial.boxes;
  const boxVol = partial.boxVol ?? 0.1;
  const vol = partial.vol ?? +(boxes * boxVol).toFixed(4);
  return {
    factory: '3010',
    workshop: '制造三车间',
    matType: 'N',
    ref: partial.ref ?? partial.id,
    name: partial.name ?? partial.id,
    customer: 'C-A',
    due: '2026-07-26',
    wo: 'WO-1',
    batch: 'B',
    loc: '待灭菌仓·老',
    stockStatus: '非限制',
    urgent: false,
    sterilizationMethod: 'EO',
    ...partial,
    boxes,
    boxVol,
    vol,
  };
}

function fatTrays(cabinets: Cabinet[]): Tray[] {
  return cabinets.map((c) => ({
    id: `${c.id}-fat`,
    cabinetId: c.id,
    level: 1,
    displayName: '整柜托盘',
    capacityM3: 500,
    ratedLoadM3: 500,
    status: '可用' as const,
  }));
}

function cfgWith(policy: PackSuggestPolicy): AppConfig {
  return { ...defaultAppConfig(), packSuggestPolicy: clonePackSuggestPolicy(policy) };
}

function poolBy(lines: StockLine[]) {
  const map = new Map(lines.map((l) => [l.id, l]));
  return (id: string) => map.get(id);
}

function usedCabinets(contents: CabinetContent[]): string[] {
  return [...new Set(contents.filter((c) => !c.hidden && c.lines.length).map((c) => c.cabinetId))].sort();
}

function avgFill(contents: CabinetContent[]): number {
  const loaded = contents.filter((c) => !c.hidden && c.lines.length && (c.fillRate || 0) > 0);
  if (!loaded.length) return 0;
  return loaded.reduce((s, c) => s + (c.fillRate || 0), 0) / loaded.length;
}

function dueSpread(content: CabinetContent | undefined, byId: (id: string) => StockLine | undefined): number {
  const dues = (content?.lines || []).map(byId).map((l) => l?.due).filter((d): d is string => Boolean(d)).sort();
  if (dues.length < 2) return 0;
  const a = new Date(dues[0]!).getTime();
  const b = new Date(dues[dues.length - 1]!).getTime();
  return Math.round((b - a) / 86400000);
}

describe('C3-01 非法配置拒存', () => {
  const previous = defaultPackSuggestPolicy();

  it('目标装柜率越界 → PACK_POLICY_BAD_FILL_RATE，旧策略不变', () => {
    const draft = { ...clonePackSuggestPolicy(previous), targetFillRate: 0.5 };
    const result = commitPackSuggestPolicy(previous, draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PACK_POLICY_ERROR_CODES.PACK_POLICY_BAD_FILL_RATE);
    expect(validatePackSuggestPolicy(draft).code).toBe(PACK_POLICY_ERROR_CODES.PACK_POLICY_BAD_FILL_RATE);
    expect(previous.targetFillRate).toBe(0.8);
  });

  it('空 dimensions 或全部关闭 → PACK_POLICY_EMPTY_DIM', () => {
    const empty = { ...clonePackSuggestPolicy(previous), dimensions: [] };
    expect(validatePackSuggestPolicy(empty).code).toBe(PACK_POLICY_ERROR_CODES.PACK_POLICY_EMPTY_DIM);
    const allOff = {
      ...clonePackSuggestPolicy(previous),
      dimensions: [
        { code: 'gapMin' as const, enabled: false },
        { code: 'targetFill' as const, enabled: false },
        { code: 'dueCluster' as const, enabled: false },
      ],
    };
    expect(validatePackSuggestPolicy(allOff).code).toBe(PACK_POLICY_ERROR_CODES.PACK_POLICY_EMPTY_DIM);
    expect(commitPackSuggestPolicy(previous, empty).ok).toBe(false);
  });

  it('未知维度 / 重复维度 / 非法填满模式 / 交期窗口越界', () => {
    const unknown = {
      ...clonePackSuggestPolicy(previous),
      dimensions: [{ code: 'customerAffinity' as never, enabled: true }],
    };
    expect(validatePackSuggestPolicy(unknown).code).toBe(PACK_POLICY_ERROR_CODES.PACK_POLICY_UNKNOWN_DIM);
    const dup = {
      ...clonePackSuggestPolicy(previous),
      dimensions: [
        { code: 'gapMin' as const, enabled: true },
        { code: 'gapMin' as const, enabled: true },
      ],
    };
    expect(validatePackSuggestPolicy(dup).code).toBe(PACK_POLICY_ERROR_CODES.PACK_POLICY_DUP_DIM);
    const badMode = { ...clonePackSuggestPolicy(previous), fillMode: 'roundRobin' as never };
    expect(validatePackSuggestPolicy(badMode).code).toBe(PACK_POLICY_ERROR_CODES.PACK_POLICY_BAD_FILL_MODE);
    const badWin = { ...clonePackSuggestPolicy(previous), dueWindowDays: 0 };
    expect(validatePackSuggestPolicy(badWin).code).toBe(PACK_POLICY_ERROR_CODES.PACK_POLICY_BAD_DUE_WINDOW);
    expect(commitPackSuggestPolicy(previous, unknown).ok).toBe(false);
    expect(previous.fillMode).toBe('fillOneFirst');
  });
});

describe('C3-02 恢复默认 = §5.1', () => {
  it('恢复默认后字段对齐填满优先 80% + 交期窗 3 天 + 交期簇关', () => {
    const custom = policyFromPreset('balanced');
    custom.targetFillRate = 0.95;
    custom.dueWindowDays = 14;
    const restored = restoreDefaultPackSuggestPolicy(custom);
    expect(restored.id).toBe('default');
    expect(restored.preset).toBe('fillFirst');
    expect(restored.fillMode).toBe('fillOneFirst');
    expect(restored.targetFillRate).toBe(0.8);
    expect(restored.dueWindowDays).toBe(3);
    expect(restored.applyMode).toBe('nextAutoPackOnly');
    expect(restored.dimensions.map((d) => d.code)).toEqual(['gapMin', 'targetFill', 'dueCluster']);
    expect(restored.dimensions.find((d) => d.code === 'dueCluster')?.enabled).toBe(false);
    expect(restored.version).toBe((custom.version || 0) + 1);
  });

  it('恢复默认后自动组柜与显式 §5.1 策略一致', () => {
    const cabinets = CABINETS.filter((c) => c.id === '柜9' || c.id === '柜20');
    const trays = fatTrays(cabinets);
    const lines = [0, 1, 2, 3].map((i) =>
      stock({
        id: `S${i}`,
        process: 'D002',
        allowed: ['柜9', '柜20'],
        boxes: 22,
        boxVol: 1,
        vol: 22,
        due: `2026-07-2${4 + i}`,
      }),
    );
    const byId = poolBy(lines);
    const restored = restoreDefaultPackSuggestPolicy();
    const explicit = defaultPackSuggestPolicy();
    const a = autoPackDemands({
      lineIds: lines.map((l) => l.id),
      pool: lines,
      contents: [],
      cabinets,
      processes: PROCESSES,
      trayMaster: trays,
      runtimes: [],
      config: cfgWith(restored),
      nextSeq: 1,
      poolById: byId,
    });
    const b = autoPackDemands({
      lineIds: lines.map((l) => l.id),
      pool: lines,
      contents: [],
      cabinets,
      processes: PROCESSES,
      trayMaster: trays,
      runtimes: [],
      config: cfgWith(explicit),
      nextSeq: 1,
      poolById: byId,
      policy: explicit,
    });
    expect(a.ok).toBe(true);
    expect(usedCabinets(a.contents)).toEqual(usedCabinets(b.contents));
    expect(a.contents.map((c) => [...c.lines].sort())).toEqual(b.contents.map((c) => [...c.lines].sort()));
  });
});

describe('C3-03 fillOneFirst vs balanced 可区分', () => {
  it('同池切换后柜数或平均装柜率不同', () => {
    const cabinets = CABINETS.filter((c) => c.id === '柜9' || c.id === '柜20');
    const trays = fatTrays(cabinets);
    const lines = [0, 1, 2, 3].map((i) =>
      stock({
        id: `B${i}`,
        process: 'D002',
        allowed: ['柜9', '柜20'],
        boxes: 22,
        boxVol: 1,
        vol: 22,
        due: `2026-07-2${4 + i}`,
      }),
    );
    const byId = poolBy(lines);
    const pack = (policy: PackSuggestPolicy) =>
      autoPackDemands({
        lineIds: lines.map((l) => l.id),
        pool: lines,
        contents: [],
        cabinets,
        processes: PROCESSES,
        trayMaster: trays,
        runtimes: [],
        config: cfgWith(policy),
        nextSeq: 1,
        poolById: byId,
        policy,
      });
    const fillFirst = pack(policyFromPreset('fillFirst'));
    const balanced = pack(policyFromPreset('balanced'));
    expect(fillFirst.ok).toBe(true);
    expect(balanced.ok).toBe(true);
    const fillCabs = usedCabinets(fillFirst.contents).length;
    const balCabs = usedCabinets(balanced.contents).length;
    const fillAvg = avgFill(fillFirst.contents);
    const balAvg = avgFill(balanced.contents);
    expect(fillCabs !== balCabs || Math.abs(fillAvg - balAvg) > 1e-6).toBe(true);
    expect(fillCabs).toBeLessThanOrEqual(balCabs);
    expect(fillAvg).toBeGreaterThan(balAvg);
  });
});

describe('C3-04 交期簇开/关可区分', () => {
  it('默认关 vs 打开后同柜 due 分布更聚簇', () => {
    const cab = CABINETS.find((c) => c.id === '柜9')!;
    const trays = fatTrays([cab]);
    const seed = stock({
      id: 'SEED',
      process: 'D002',
      allowed: ['柜9'],
      boxes: 20,
      boxVol: 1,
      vol: 20,
      due: '2026-07-24',
    });
    const near = stock({
      id: 'NEAR',
      process: 'D002',
      allowed: ['柜9'],
      boxes: 38,
      boxVol: 1,
      vol: 38,
      due: '2026-07-25',
    });
    const far = stock({
      id: 'FAR',
      process: 'D002',
      allowed: ['柜9'],
      boxes: 50,
      boxVol: 1,
      vol: 50,
      due: '2026-08-30',
    });
    const lines = [seed, near, far];
    const byId = poolBy(lines);
    const seedContent: CabinetContent = {
      id: 'CC-SEED',
      cabinetId: '柜9',
      date: null,
      shift: null,
      lines: ['SEED'],
      status: 'active',
      scheduleStatus: 'unscheduled',
      fillRate: 0.2,
      loadComplete: false,
      taskId: null,
    };
    const pack = (policy: PackSuggestPolicy) =>
      autoPackCabinet({
        cabinetId: '柜9',
        pool: lines,
        contents: [seedContent],
        cabinets: [cab],
        processes: PROCESSES,
        trayMaster: trays,
        runtimes: [],
        config: cfgWith(policy),
        nextId: 'CC-SEED',
        poolById: byId,
        policy,
      });
    const off = pack(defaultPackSuggestPolicy());
    const on = pack(policyFromPreset('dueCluster'));
    expect(off.ok).toBe(true);
    expect(on.ok).toBe(true);
    expect(off.content!.lines).toContain('FAR');
    expect(off.content!.lines).not.toContain('NEAR');
    expect(on.content!.lines).toContain('NEAR');
    expect(on.content!.lines).not.toContain('FAR');
    expect(dueSpread(on.content, byId)).toBeLessThan(dueSpread(off.content, byId));
  });
});

describe('C3-05 targetFillRate 达目标即停', () => {
  it('fillOneFirst 下调目标后该柜更早停填', () => {
    const cab = CABINETS.find((c) => c.id === '柜9')!;
    const trays = fatTrays([cab]);
    const lines = [
      stock({ id: 'T1', process: 'D002', allowed: ['柜9'], boxes: 30, boxVol: 1, vol: 30, due: '2026-07-24' }),
      stock({ id: 'T2', process: 'D002', allowed: ['柜9'], boxes: 30, boxVol: 1, vol: 30, due: '2026-07-25' }),
      stock({ id: 'T3', process: 'D002', allowed: ['柜9'], boxes: 25, boxVol: 1, vol: 25, due: '2026-07-26' }),
    ];
    const byId = poolBy(lines);
    const pack = (rate: number) => {
      const policy = defaultPackSuggestPolicy();
      policy.targetFillRate = rate;
      policy.preset = 'custom';
      return autoPackCabinet({
        cabinetId: '柜9',
        pool: lines,
        contents: [],
        cabinets: [cab],
        processes: PROCESSES,
        trayMaster: trays,
        runtimes: [],
        config: cfgWith(policy),
        nextId: 'CC-T',
        poolById: byId,
        policy,
      });
    };
    const low = pack(0.5);
    const high = pack(0.8);
    expect(low.ok && high.ok).toBe(true);
    expect(low.content!.lines.length).toBe(2);
    expect(high.content!.lines.length).toBe(3);
    expect(low.content!.fillRate).toBeCloseTo(0.6);
    expect(high.content!.fillRate).toBeCloseTo(0.85);
    expect(low.content!.fillRate!).toBeLessThan(high.content!.fillRate!);
  });
});

describe('C3-06 硬约束铁律不可配掉', () => {
  const policy = policyFromPreset('balanced');
  policy.dimensions = [
    { code: 'dueCluster', enabled: true },
    { code: 'gapMin', enabled: true },
    { code: 'targetFill', enabled: true },
  ];
  const cfg = cfgWith(policy);
  const seed = createSeedPool();
  const seedById = (id: string) => seed.find((p) => p.id === id);

  it('指定柜：不允许的柜不会被策略推荐', () => {
    const packed = autoPackCabinet({
      cabinetId: '柜8',
      pool: seed,
      contents: [],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes: [],
      config: cfg,
      nextId: 'CC-MIS',
      poolById: seedById,
      policy,
    });
    if (packed.ok && packed.content) {
      for (const id of packed.content.lines) {
        expect(seedById(id)!.allowed).toContain('柜8');
      }
    }
    const rows = listEligibleForCabinet({
      cabinetId: '柜8',
      pool: seed,
      contents: [],
      cabinets: CABINETS,
      config: cfg,
    });
    expect(rows.every((r) => r.line.allowed.includes('柜8'))).toBe(true);
    expect(rows.some((r) => r.lineId === 'P001')).toBe(false);
  });

  it('BOX_LIMIT 口径2：大箱合计超 280 的行不会被 auto 落盘', () => {
    const huge = stock({
      id: 'HUGE',
      process: '手术衣',
      allowed: ['柜8'],
      boxes: 300,
      boxVol: 0.15,
      vol: 45,
    });
    const packed = autoPackCabinet({
      cabinetId: '柜8',
      pool: [huge],
      contents: [],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: fatTrays(CABINETS),
      runtimes: [],
      config: cfg,
      nextId: 'CC-BOX',
      poolById: poolBy([huge]),
      policy,
    });
    expect(packed.ok).toBe(false);
  });

  it('TRAY_OVERFLOW：超托盘行被跳过，auto 结果零 error', () => {
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool: seed,
      contents: [],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes: [],
      config: cfg,
      nextId: 'CC-TRAY',
      poolById: seedById,
      policy,
    });
    if (packed.ok && packed.content) {
      const ctx: RuleContext = {
        cabinets: CABINETS,
        processes: PROCESSES,
        poolById: seedById,
        config: cfg,
        sameShiftFurnaces: [packed.content],
        trayMaster: TRAYS,
        allContents: [packed.content],
      };
      expect(validateFurnace(packed.content, ctx).some((i) => i.sev === 'error')).toBe(false);
      expect(packed.content.lines.includes('P001')).toBe(false);
    }
  });

  it('REPACK_AFTER_LOAD_COMPLETE：装填完毕自动禁再拼', () => {
    const loaded: CabinetContent = {
      id: 'CC1',
      cabinetId: '柜9',
      date: null,
      shift: null,
      lines: ['P003'],
      status: 'active',
      scheduleStatus: 'unscheduled',
      loadComplete: true,
    };
    const runtimes = deriveAllRuntimes(CABINETS, [loaded], []);
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool: seed,
      contents: [loaded],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes,
      config: cfg,
      nextId: 'CC-X',
      poolById: seedById,
      policy,
    });
    expect(packed.ok).toBe(false);
    expect(packed.issues.some((i) => i.code === 'REPACK_AFTER_LOAD_COMPLETE')).toBe(true);
  });

  it('ON_TRAY_QTY_OVERFLOW：auto 闸门仍拒绝超量落盘', () => {
    const p001 = seedById('P001')!;
    const tray = traysForCabinet('柜9')[0]!;
    const over: CabinetContent = {
      id: 'CC1',
      cabinetId: '柜9',
      date: null,
      shift: null,
      lines: ['P001'],
      trays: [
        {
          id: `CC1::${tray.id}`,
          contentId: 'CC1',
          trayId: tray.id,
          level: tray.level,
          vol: p001.vol + 1,
          boxes: p001.boxes + 10,
          largeBoxes: 0,
          onTray: [
            {
              id: `CC1::${tray.id}::P001`,
              trayInContentId: `CC1::${tray.id}`,
              stockLineId: 'P001',
              boxes: p001.boxes + 10,
              vol: p001.vol + 1,
            },
          ],
        },
      ],
    };
    const empty: CabinetContent = { id: 'CC1', cabinetId: '柜9', date: null, shift: null, lines: [] };
    const decision = decideCommit({
      previous: [empty],
      next: [over],
      config: cfg,
      ctx: {
        cabinets: CABINETS,
        processes: PROCESSES,
        poolById: seedById,
        config: cfg,
        sameShiftFurnaces: [over],
        trayMaster: TRAYS,
        allContents: [over],
      },
      editSource: 'auto',
    });
    expect(decision.aborted).toBe(true);
    expect(decision.issues.some((i) => i.code === 'ON_TRAY_QTY_OVERFLOW')).toBe(true);
    expect(occupiedBoxesOf(p001, [over])).toBeGreaterThan(p001.boxes);
    expect(remainingBoxes(p001, [over])).toBe(0);
  });

  it('auto 零 error：策略建议若有 error 不落盘', () => {
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool: seed,
      contents: [],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes: demoRuntimeOverrides(),
      config: cfg,
      nextId: 'CC-AUTO',
      poolById: seedById,
      policy,
    });
    if (packed.ok && packed.content) {
      const issues = validateFurnace(packed.content, {
        cabinets: CABINETS,
        processes: PROCESSES,
        poolById: seedById,
        config: cfg,
        sameShiftFurnaces: [packed.content],
        trayMaster: TRAYS,
        allContents: [packed.content],
        runtimes: demoRuntimeOverrides(),
      });
      expect(issues.some((i) => i.sev === 'error')).toBe(false);
    }
  });
});

describe('C3-07 组柜仍无 date/shift/Task', () => {
  it('自动组柜产物 date/shift/taskId 为空且不建 Task', () => {
    const cab = CABINETS.find((c) => c.id === '柜9')!;
    const lines = [
      stock({ id: 'N1', process: 'D002', allowed: ['柜9'], boxes: 12, boxVol: 1, vol: 12, due: '2026-07-24' }),
    ];
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool: lines,
      contents: [],
      cabinets: [cab],
      processes: PROCESSES,
      trayMaster: fatTrays([cab]),
      runtimes: [],
      config: cfgWith(policyFromPreset('balanced')),
      nextId: 'CC-N',
      poolById: poolBy(lines),
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.date).toBeNull();
    expect(packed.content!.shift).toBeNull();
    expect(packed.content!.taskId).toBeNull();
    expect(packed.content!.scheduleStatus).toBe('unscheduled');
  });
});

describe('C3-08 仅保存策略不改既有载荷', () => {
  it('commitPackSuggestPolicy 不改写已有 Content / 托盘行', () => {
    const cab = CABINETS.find((c) => c.id === '柜9')!;
    const lines = [
      stock({ id: 'K1', process: 'D002', allowed: ['柜9'], boxes: 12, boxVol: 1, vol: 12, due: '2026-07-24' }),
    ];
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool: lines,
      contents: [],
      cabinets: [cab],
      processes: PROCESSES,
      trayMaster: fatTrays([cab]),
      runtimes: [],
      config: cfgWith(defaultPackSuggestPolicy()),
      nextId: 'CC-K',
      poolById: poolBy(lines),
    });
    const before = JSON.stringify(packed.content);
    const saved = commitPackSuggestPolicy(defaultPackSuggestPolicy(), policyFromPreset('balanced'));
    expect(saved.ok).toBe(true);
    expect(JSON.stringify(packed.content)).toBe(before);
    expect(packed.content!.lines).toEqual(['K1']);
  });
});

describe('C3-12 手工路径不受建议策略改写铁律', () => {
  it('manual 违例仍可落盘；策略只作用于自动组柜', () => {
    const seed = createSeedPool();
    const seedById = (id: string) => seed.find((p) => p.id === id);
    const loaded: CabinetContent = {
      id: 'CC1',
      cabinetId: '柜9',
      date: null,
      shift: null,
      lines: ['P003'],
      status: 'active',
      scheduleStatus: 'unscheduled',
      loadComplete: true,
    };
    const packed = manualPackCabinet({
      cabinetId: '柜9',
      lineIds: ['P002'],
      contents: [loaded],
      cabinets: CABINETS,
      trayMaster: TRAYS,
      runtimes: deriveAllRuntimes(CABINETS, [loaded], []),
      config: { ...cfgWith(policyFromPreset('balanced')), scheduleMode: 'manual' },
      nextId: 'CC-M',
      poolById: seedById,
      allowInOther: false,
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.lines).toEqual(expect.arrayContaining(['P003', 'P002']));
  });
});
