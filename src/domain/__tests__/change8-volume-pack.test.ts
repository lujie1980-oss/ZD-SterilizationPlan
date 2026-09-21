import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { CABINETS } from '../../data/seed-cabinets';
import { PROCESSES } from '../../data/seed-processes';
import { remainingBoxes } from '../cabinet-content';
import { decideCommit } from '../commit-gate';
import type { Cabinet, CabinetContent, RuleContext, StockLine } from '../entities';
import { autoPackCabinet, autoPackDemands, isLargeDemand, manualPackCabinet, packSummaryOf } from '../grouping';
import { validateFurnace } from '../rule-engine';
import { evaluateAppend, takeBoxesRemainderB } from '../volume-pack';

function line(partial: Partial<StockLine> & Pick<StockLine, 'id' | 'process' | 'allowed' | 'boxes' | 'boxVol'>): StockLine {
  const boxes = partial.boxes;
  const boxVol = partial.boxVol;
  return {
    factory: '3010',
    workshop: '制造三车间',
    matType: 'N',
    ref: 'REF',
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
    vol: +(boxes * boxVol).toFixed(6),
  };
}

function cab(partial: Partial<Cabinet> & Pick<Cabinet, 'id' | 'ratedLoadM3'>): Cabinet {
  return {
    canonicalId: partial.id,
    displayCode: partial.id,
    base: '老',
    capacity: partial.ratedLoadM3,
    status: '可用',
    tags: [],
    ...partial,
  };
}

function ctxFor(pool: StockLine[], contents: CabinetContent[], cabinets: Cabinet[]): RuleContext {
  const map = new Map(pool.map((p) => [p.id, p]));
  return {
    cabinets,
    processes: PROCESSES,
    poolById: (id) => map.get(id),
    config: defaultAppConfig(),
    sameShiftFurnaces: contents,
    allContents: contents,
  };
}

describe('变更-8 组柜体积口径 (C8-01～06)', () => {
  const cfg = defaultAppConfig();
  const box = cfg.box;

  it('C8-01: 拼柜主路径用 stockShares，不经拆 tray / PlanUnit', () => {
    const cabinet = cab({ id: '柜9', ratedLoadM3: 100 });
    const pool = [
      line({ id: 'S1', process: 'D002', allowed: ['柜9'], boxes: 40, boxVol: 0.1 }),
      line({ id: 'S2', process: 'D002', allowed: ['柜9'], boxes: 30, boxVol: 0.1 }),
    ];
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool,
      contents: [],
      cabinets: [cabinet, ...CABINETS.filter((c) => c.id !== '柜9')],
      processes: PROCESSES,
      trayMaster: [],
      runtimes: [],
      config: cfg,
      nextId: 'CC-V',
      poolById: (id) => pool.find((p) => p.id === id),
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.stockShares!.length).toBeGreaterThan(0);
    expect(packed.content!.stockShares!.every((s) => s.stockLineId && s.boxes > 0 && s.vol > 0)).toBe(true);
    expect(packed.content!.trays?.length || 0).toBe(0);
    expect(JSON.stringify(packed.content)).not.toMatch(/PlanUnit|planUnit/);
    expect(packed.content!.date).toBeNull();
    expect(packed.content!.shift).toBeNull();
    expect(packed.content!.taskId).toBeNull();
  });

  it('C8-02: ∑V>柜容 → VOL_OVERFLOW，auto 拒落盘', () => {
    const cabinet = cab({ id: '柜T', ratedLoadM3: 10 });
    const over = line({ id: 'OV', process: '手术衣', allowed: ['柜T'], boxes: 12, boxVol: 1 });
    const content: CabinetContent = {
      id: 'CC1',
      cabinetId: '柜T',
      date: null,
      shift: null,
      lines: ['OV'],
      stockShares: [{ stockLineId: 'OV', boxes: 12, vol: 12, largeBoxes: 12 }],
      totalVol: 12,
      largeBoxCount: 12,
    };
    const issues = validateFurnace(content, ctxFor([over], [content], [cabinet]));
    const hit = issues.find((i) => i.code === 'VOL_OVERFLOW');
    expect(hit?.sev).toBe('error');
    expect(hit?.msg).toContain('VOL_OVERFLOW');
    const empty: CabinetContent = { id: 'CC1', cabinetId: '柜T', date: null, shift: null, lines: [] };
    const decision = decideCommit({
      previous: [empty],
      next: [content],
      config: cfg,
      ctx: ctxFor([over], [content], [cabinet]),
      editSource: 'auto',
    });
    expect(decision.aborted).toBe(true);
    expect(decision.issues.some((i) => i.code === 'VOL_OVERFLOW')).toBe(true);
  });

  it('C8-03: 大箱件数>280 → BOX_LIMIT，auto 拒落盘', () => {
    const cabinet = cab({ id: '柜8', ratedLoadM3: 90 });
    const over = line({ id: 'LG', process: '手术衣', allowed: ['柜8'], boxes: 281, boxVol: 0.15 });
    const content: CabinetContent = {
      id: 'CC1',
      cabinetId: '柜8',
      date: null,
      shift: null,
      lines: ['LG'],
      stockShares: [{ stockLineId: 'LG', boxes: 281, vol: 42.15, largeBoxes: 281 }],
      totalVol: 42.15,
      largeBoxCount: 281,
    };
    const issues = validateFurnace(content, ctxFor([over], [content], [cabinet]));
    expect(issues.some((i) => i.code === 'BOX_LIMIT' && i.sev === 'error' && i.msg.includes('BOX_LIMIT'))).toBe(true);
    const empty: CabinetContent = { id: 'CC1', cabinetId: '柜8', date: null, shift: null, lines: [] };
    const decision = decideCommit({
      previous: [empty],
      next: [content],
      config: cfg,
      ctx: ctxFor([over], [content], [cabinet]),
      editSource: 'auto',
    });
    expect(decision.aborted).toBe(true);
    expect(decision.issues.some((i) => i.code === 'BOX_LIMIT')).toBe(true);
  });

  it('C8-04: 大箱已 280 时体积允许下仍可加入小箱', () => {
    const large = line({ id: 'L', process: '手术衣', allowed: ['柜8'], boxes: 280, boxVol: 0.15 });
    const small = line({ id: 'S', process: '手术衣', allowed: ['柜8'], boxes: 20, boxVol: 0.08 });
    const content: CabinetContent = {
      id: 'CC1',
      cabinetId: '柜8',
      date: null,
      shift: null,
      status: 'active',
      scheduleStatus: 'unscheduled',
      lines: ['L'],
      stockShares: [{ stockLineId: 'L', boxes: 280, vol: 42, largeBoxes: 280 }],
      totalVol: 42,
      largeBoxCount: 280,
    };
    const take = takeBoxesRemainderB({
      totalVol: 42,
      largeBoxCount: 280,
      ratedLoadM3: 90,
      remainingBoxes: small.boxes,
      boxVol: small.boxVol,
      box,
    });
    expect(isLargeDemand(small, box.largeBoxVol)).toBe(false);
    expect(take).toBe(20);
    expect(evaluateAppend({ totalVol: 42, largeBoxCount: 280, ratedLoadM3: 90, addBoxes: 20, boxVol: 0.08, box }).ok).toBe(true);

    const packed = autoPackCabinet({
      cabinetId: '柜8',
      pool: [large, small],
      contents: [content],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: [],
      runtimes: [],
      config: cfg,
      nextId: 'CC1',
      poolById: (id) => [large, small].find((p) => p.id === id),
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.largeBoxCount).toBe(280);
    expect(packed.content!.stockShares!.some((s) => s.stockLineId === 'S' && s.boxes === 20)).toBe(true);
    expect(packed.content!.totalVol).toBeCloseTo(42 + 1.6, 5);
  });

  it('C8-05: 大箱已 280 时不可再加入大箱（auto）', () => {
    const a = line({ id: 'A', process: '手术衣', allowed: ['柜8'], boxes: 280, boxVol: 0.15 });
    const b = line({ id: 'B', process: '手术衣', allowed: ['柜8'], boxes: 10, boxVol: 0.15 });
    const content: CabinetContent = {
      id: 'CC1',
      cabinetId: '柜8',
      date: null,
      shift: null,
      status: 'active',
      scheduleStatus: 'unscheduled',
      lines: ['A'],
      stockShares: [{ stockLineId: 'A', boxes: 280, vol: 42, largeBoxes: 280 }],
      totalVol: 42,
      largeBoxCount: 280,
    };
    expect(
      takeBoxesRemainderB({
        totalVol: 42,
        largeBoxCount: 280,
        ratedLoadM3: 90,
        remainingBoxes: 10,
        boxVol: 0.15,
        box,
      }),
    ).toBe(0);
    expect(
      evaluateAppend({ totalVol: 42, largeBoxCount: 280, ratedLoadM3: 90, addBoxes: 1, boxVol: 0.15, box }).ok,
    ).toBe(false);
    expect(
      evaluateAppend({ totalVol: 42, largeBoxCount: 280, ratedLoadM3: 90, addBoxes: 1, boxVol: 0.15, box }),
    ).toMatchObject({ code: 'BOX_LIMIT' });

    const packed = autoPackCabinet({
      cabinetId: '柜8',
      pool: [a, b],
      contents: [content],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: [],
      runtimes: [],
      config: cfg,
      nextId: 'CC1',
      poolById: (id) => [a, b].find((p) => p.id === id),
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.largeBoxCount).toBe(280);
    expect(packed.content!.stockShares!.some((s) => s.stockLineId === 'B')).toBe(false);
    expect(remainingBoxes(b, [packed.content!])).toBe(10);
  });

  it('C8-06: 组柜无 date/shift；不建 Task', () => {
    const cabinet = cab({ id: '柜9', ratedLoadM3: 100 });
    const pool = [line({ id: 'N1', process: 'D002', allowed: ['柜9'], boxes: 12, boxVol: 0.1 })];
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool,
      contents: [],
      cabinets: [cabinet],
      processes: PROCESSES,
      trayMaster: [],
      runtimes: [],
      config: cfg,
      nextId: 'CC-N',
      poolById: (id) => pool.find((p) => p.id === id),
    });
    expect(packed.content!.date).toBeNull();
    expect(packed.content!.shift).toBeNull();
    expect(packed.content!.taskId).toBeNull();
    expect(packed.content!.scheduleStatus).toBe('unscheduled');
  });

  it('余量 B：超 280 大箱只装 280，余量留池且不改写成小箱', () => {
    const huge = line({ id: 'H', process: '手术衣', allowed: ['柜8'], boxes: 300, boxVol: 0.15 });
    const packed = autoPackCabinet({
      cabinetId: '柜8',
      pool: [huge],
      contents: [],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: [],
      runtimes: [],
      config: cfg,
      nextId: 'CC-H',
      poolById: (id) => (id === 'H' ? huge : undefined),
    });
    expect(packed.ok).toBe(true);
    const share = packed.content!.stockShares!.find((s) => s.stockLineId === 'H')!;
    expect(share.boxes).toBe(280);
    expect(share.largeBoxes).toBe(280);
    expect(share.vol).toBeCloseTo(42, 5);
    expect(remainingBoxes(huge, [packed.content!])).toBe(20);
    expect(isLargeDemand(huge, box.largeBoxVol)).toBe(true);
  });

  it('autoPackDemands 把 280 后剩余大箱放到另一台柜的新 Content', () => {
    const huge = line({ id: 'HX', process: '手术衣', allowed: ['柜8', '柜11'], boxes: 300, boxVol: 0.15 });
    const cabs = CABINETS.filter((c) => c.id === '柜8' || c.id === '柜11');
    const packed = autoPackDemands({
      lineIds: ['HX'],
      pool: [huge],
      contents: [],
      cabinets: cabs,
      processes: PROCESSES,
      trayMaster: [],
      runtimes: [],
      config: cfg,
      nextSeq: 1,
      poolById: (id) => (id === 'HX' ? huge : undefined),
    });
    expect(packed.ok).toBe(true);
    const largeCounts = packed.contents.map((c) => c.largeBoxCount || 0);
    expect(largeCounts.reduce((s, n) => s + n, 0)).toBe(300);
    expect(Math.max(...largeCounts)).toBe(280);
    expect(packed.contents.length).toBe(2);
  });

  it('packSummary 展示装柜率 / 大箱 x/280 / 剩余体积', () => {
    const cabinet = cab({ id: '柜8', ratedLoadM3: 90 });
    const content: CabinetContent = {
      id: 'CC1',
      cabinetId: '柜8',
      date: null,
      shift: null,
      lines: ['L'],
      stockShares: [{ stockLineId: 'L', boxes: 280, vol: 42, largeBoxes: 280 }],
      totalVol: 42,
      largeBoxCount: 280,
    };
    const summary = packSummaryOf({
      content,
      cabinet,
      poolById: () => undefined,
      largeBoxVol: box.largeBoxVol,
      maxBoxesWhenLarge: box.maxBoxesWhenLarge,
    });
    expect(summary.largeBoxCount).toBe(280);
    expect(summary.maxLarge).toBe(280);
    expect(summary.largeFull).toBe(true);
    expect(summary.remainingVol).toBeCloseTo(48);
    expect(summary.fillRate).toBeCloseTo(42 / 90);
  });

  it('manual 可强行超限并走原有强预警闸门', () => {
    const over = line({ id: 'M1', process: '手术衣', allowed: ['柜8'], boxes: 281, boxVol: 0.15 });
    const packed = manualPackCabinet({
      cabinetId: '柜8',
      lineIds: ['M1'],
      contents: [],
      cabinets: CABINETS,
      trayMaster: [],
      runtimes: [],
      config: { ...cfg, scheduleMode: 'manual' },
      nextId: 'CC-M',
      poolById: (id) => (id === 'M1' ? over : undefined),
      allowInOther: false,
      clampToLimits: false,
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.largeBoxCount).toBe(281);
    const decision = decideCommit({
      previous: [],
      next: [packed.content!],
      config: { ...cfg, scheduleMode: 'manual' },
      ctx: ctxFor([over], [packed.content!], CABINETS),
      editSource: 'manual',
    });
    expect(decision.aborted).toBe(false);
    expect(decision.needsOverridePrompt).toBe(true);
    expect(decision.issues.some((i) => i.code === 'BOX_LIMIT')).toBe(true);
  });
});
