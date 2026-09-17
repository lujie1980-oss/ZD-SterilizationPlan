import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { CABINETS, TRAYS, traysForCabinet } from '../../data/seed-cabinets';
import { PROCESSES } from '../../data/seed-processes';
import { applyGanttSchedule } from '../cabinet-task';
import {
  occupiedBoxesOf,
  remainingBoxes,
  syncTrayAggregates,
  trayCapacityM3,
} from '../cabinet-content';
import type { CabinetContent, PlanUnit, StockLine } from '../entities';
import { ISSUE_CODES } from '../entities';
import { autoPackCabinet, listEligiblePlanUnitGroups, manualPackCabinet } from '../grouping';
import {
  PLAN_SCHEMA_VERSION,
  PLAN_UNIT_RULE,
  PU_ERROR_CODES,
  applyPlanUnitCreation,
  createOneBoxOneUnit,
  migratePlanToPlanUnits,
  remainingBoxesFromPlanUnits,
  rerunPlanUnitCreation,
  syncPlacementsFromContents,
  unitsOfLine,
} from '../plan-unit';
import { validateFurnace } from '../rule-engine';

function stock(
  partial: Partial<StockLine> & Pick<StockLine, 'id' | 'boxes'>,
): StockLine {
  const boxes = partial.boxes;
  const boxVol = partial.boxVol ?? 0.1;
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
    process: 'D002',
    allowed: ['柜9', '柜20'],
    urgent: false,
    sterilizationMethod: 'EO',
    vol: +(boxes * boxVol).toFixed(4),
    ...partial,
    boxes,
    boxVol,
  };
}

const cfg = defaultAppConfig();

function poolBy(lines: StockLine[]) {
  const map = new Map(lines.map((l) => [l.id, l]));
  return (id: string) => map.get(id);
}

describe('C7-01 确认后自动一箱一单元', () => {
  it('boxes=N 生成 N 个 PlanUnit，boxSeq=1..N，Creation applied 且幂等', () => {
    const line = stock({ id: 'L3', boxes: 3, boxVol: 0.08, dimL: 400, dimW: 300, dimH: 300, salesOrderNo: 'SO-1' });
    const first = applyPlanUnitCreation({ line, creations: [], planUnits: [], now: '2026-09-17T00:00:00.000Z' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.creation.ruleCode).toBe(PLAN_UNIT_RULE);
    expect(first.creation.sourceBoxCount).toBe(3);
    expect(first.creation.createdCount).toBe(3);
    expect(first.creation.status).toBe('applied');
    expect(first.creation.version).toBe(1);
    const units = unitsOfLine(first.planUnits, line.id);
    expect(units).toHaveLength(3);
    expect(units.map((u) => u.boxSeq)).toEqual([1, 2, 3]);
    expect(new Set(units.map((u) => u.id)).size).toBe(3);
    expect(units.every((u) => u.status === 'unassigned' && u.placement === null)).toBe(true);
    expect(units.every((u) => u.vol === 0.08)).toBe(true);
    expect(units.every((u) => u.salesOrderNo === 'SO-1')).toBe(true);
    const again = applyPlanUnitCreation({
      line,
      creations: first.creations,
      planUnits: first.planUnits,
      now: '2026-09-17T01:00:00.000Z',
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.creation.id).toBe(first.creation.id);
    expect(again.creation.version).toBe(1);
    expect(again.planUnits.map((u) => u.id)).toEqual(first.planUnits.map((u) => u.id));
  });

  it('createOneBoxOneUnit 箱数 N→N 且 vol 继承单箱体积', () => {
    const line = stock({ id: 'L2', boxes: 2, boxVol: 0.12, vol: 0.24 });
    const units = createOneBoxOneUnit(line, 'PUC-L2', 1);
    expect(units).toHaveLength(2);
    expect(units[0]!.vol).toBe(0.12);
  });
});

describe('C7-02 重跑分拆', () => {
  it('未放置时可按当前箱数重建，version+1', () => {
    const line = stock({ id: 'L3', boxes: 3, boxVol: 0.08 });
    const first = applyPlanUnitCreation({ line, creations: [], planUnits: [] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const grown = { ...line, boxes: 4, vol: 0.32 };
    const rerun = rerunPlanUnitCreation({
      line: grown,
      creations: first.creations,
      planUnits: first.planUnits,
    });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) return;
    expect(rerun.creation.version).toBe(2);
    expect(rerun.creation.sourceBoxCount).toBe(4);
    expect(unitsOfLine(rerun.planUnits, line.id)).toHaveLength(4);
    expect(rerun.planUnits.some((u) => first.planUnits.some((o) => o.id === u.id))).toBe(false);
  });

  it('任一单元 placed → PU_RECREATE_BLOCKED，不改旧装载', () => {
    const line = stock({ id: 'L3', boxes: 3, boxVol: 0.08 });
    const first = applyPlanUnitCreation({ line, creations: [], planUnits: [] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const placed: PlanUnit[] = first.planUnits.map((u, i) =>
      i === 0
        ? { ...u, status: 'placed', placement: { contentId: 'CC1', trayInContentId: 'CC1::t' } }
        : u,
    );
    const blocked = rerunPlanUnitCreation({
      line,
      creations: first.creations,
      planUnits: placed,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe(PU_ERROR_CODES.PU_RECREATE_BLOCKED);
    expect(blocked.planUnits).toEqual(placed);
    expect(blocked.creations).toEqual(first.creations);
  });
});

describe('C7 remainingBoxes / 不变式', () => {
  it('remainingBoxes = boxes - count(placed PlanUnit)；unassigned ↔ placement=null', () => {
    const line = stock({ id: 'L3', boxes: 3, boxVol: 0.08 });
    const first = applyPlanUnitCreation({ line, creations: [], planUnits: [] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(remainingBoxesFromPlanUnits(line, first.planUnits)).toBe(3);
    const onePlaced = first.planUnits.map((u, i) =>
      i === 0 ? { ...u, status: 'placed' as const, placement: { contentId: 'CC1', trayInContentId: 't' } } : u,
    );
    expect(remainingBoxesFromPlanUnits(line, onePlaced)).toBe(2);
    expect(onePlaced.filter((u) => u.status === 'unassigned').every((u) => u.placement === null)).toBe(true);
    expect(onePlaced.filter((u) => u.status === 'placed').every((u) => u.placement != null)).toBe(true);
  });
});

function legacyOnTrayContent(opts: {
  id: string;
  cabinetId: string;
  stockLineId: string;
  boxes: number;
  vol: number;
}): CabinetContent {
  const tray = traysForCabinet(opts.cabinetId)[0]!;
  const trayInId = `${opts.id}::${tray.id}`;
  return {
    id: opts.id,
    cabinetId: opts.cabinetId,
    date: null,
    shift: null,
    lines: [opts.stockLineId],
    trays: [
      {
        id: trayInId,
        contentId: opts.id,
        trayId: tray.id,
        level: tray.level,
        vol: opts.vol,
        boxes: opts.boxes,
        largeBoxes: 0,
        onTray: [
          {
            id: `${trayInId}::${opts.stockLineId}`,
            trayInContentId: trayInId,
            stockLineId: opts.stockLineId,
            boxes: opts.boxes,
            vol: opts.vol,
          },
        ],
      },
    ],
    status: 'active',
    scheduleStatus: 'unscheduled',
    taskId: null,
  };
}

describe('C7-07 / C7-04 旧 StockLinesOnTray 迁移', () => {
  it('boxes=3 拆成 3 个 PlanUnit 与 3 条 PlanUnitsOnTray，boxes 恒 1，重入不重复', () => {
    const line = stock({ id: 'M3', boxes: 3, boxVol: 0.1, vol: 0.3 });
    const old = legacyOnTrayContent({ id: 'CC1', cabinetId: '柜9', stockLineId: 'M3', boxes: 3, vol: 0.3 });
    const first = migratePlanToPlanUnits({
      contents: [old],
      poolById: poolBy([line]),
      now: '2026-09-17T00:00:00.000Z',
    });
    expect(first.ok).toBe(true);
    expect(first.schemaVersion).toBe(PLAN_SCHEMA_VERSION);
    expect(first.planUnits).toHaveLength(3);
    const onTray = first.contents[0]!.trays![0]!.onTray;
    expect(onTray).toHaveLength(3);
    expect(onTray.every((r) => r.boxes === 1 && r.planUnitId && r.vol === 0.1)).toBe(true);
    expect(first.planUnits.every((u) => u.status === 'placed' && u.placement?.contentId === 'CC1')).toBe(true);
    const again = migratePlanToPlanUnits({
      contents: first.contents,
      poolById: poolBy([line]),
      creations: first.creations,
      planUnits: first.planUnits,
      schemaVersion: first.schemaVersion,
    });
    expect(again.ok).toBe(true);
    expect(again.migrated).toBe(false);
    expect(again.contents[0]!.trays![0]!.onTray).toHaveLength(3);
    expect(again.planUnits).toHaveLength(3);
  });

  it('不完整旧快照 → PU_MIGRATE_FAIL 且保留原 OnTray', () => {
    const broken: CabinetContent = {
      id: 'CC-BAD',
      cabinetId: '柜9',
      date: null,
      shift: null,
      lines: ['MISSING'],
      trays: [
        {
          id: 't1',
          contentId: 'CC-BAD',
          trayId: traysForCabinet('柜9')[0]!.id,
          level: 1,
          vol: 0.3,
          boxes: 3,
          largeBoxes: 0,
          onTray: [
            {
              id: 'r1',
              trayInContentId: 't1',
              stockLineId: 'MISSING',
              boxes: 3,
              vol: 0.3,
            },
          ],
        },
      ],
    };
    const result = migratePlanToPlanUnits({
      contents: [broken],
      poolById: () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(PU_ERROR_CODES.PU_MIGRATE_FAIL);
    expect(result.contents[0]!.trays![0]!.onTray[0]!.boxes).toBe(3);
    expect(result.contents[0]!.trays![0]!.onTray[0]!.planUnitId).toBeUndefined();
    expect(result.planUnits).toHaveLength(0);
  });
});

describe('C7-03/04 组柜真源为 PlanUnit', () => {
  it('候选按需求分组；勾选粒度为 PlanUnit；无单元不可装', () => {
    const a = stock({ id: 'A', boxes: 2, boxVol: 0.1, name: '行A' });
    const b = stock({ id: 'B', boxes: 2, boxVol: 0.1, name: '行B' });
    const createdA = applyPlanUnitCreation({ line: a, creations: [], planUnits: [] });
    const createdB = applyPlanUnitCreation({
      line: b,
      creations: createdA.ok ? createdA.creations : [],
      planUnits: createdA.ok ? createdA.planUnits : [],
    });
    expect(createdB.ok).toBe(true);
    if (!createdB.ok) return;
    const groups = listEligiblePlanUnitGroups({
      cabinetId: '柜9',
      pool: [a, b],
      contents: [],
      cabinets: CABINETS,
      config: cfg,
      planUnits: createdB.planUnits,
    });
    expect(groups.map((g) => g.lineId).sort()).toEqual(['A', 'B']);
    expect(groups.every((g) => g.units.length === 2)).toBe(true);
    expect(groups.every((g) => g.units.every((u) => u.planUnitId.startsWith(g.lineId)))).toBe(true);

    const none = manualPackCabinet({
      cabinetId: '柜9',
      lineIds: ['A'],
      planUnitIds: [],
      contents: [],
      cabinets: CABINETS,
      trayMaster: TRAYS,
      runtimes: [],
      config: cfg,
      nextId: 'CC1',
      poolById: poolBy([a, b]),
      allowInOther: false,
      planUnits: [],
    });
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(/计划单元|PlanUnit/);
  });

  it('装入后持久化为 PlanUnitsOnTray boxes=1；重复挂载拒绝；剩余箱=总箱-已放置单元', () => {
    const line = stock({ id: 'P', boxes: 3, boxVol: 0.1, vol: 0.3 });
    const created = applyPlanUnitCreation({ line, creations: [], planUnits: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ids = created.planUnits.slice(0, 2).map((u) => u.id);
    const packed = manualPackCabinet({
      cabinetId: '柜9',
      lineIds: [line.id],
      planUnitIds: ids,
      contents: [],
      cabinets: CABINETS,
      trayMaster: TRAYS,
      runtimes: [],
      config: cfg,
      nextId: 'CC1',
      poolById: poolBy([line]),
      allowInOther: false,
      planUnits: created.planUnits,
    });
    expect(packed.ok).toBe(true);
    const rows = packed.content!.trays!.flatMap((t) => t.onTray);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.boxes === 1 && r.planUnitId && r.vol === 0.1)).toBe(true);
    expect(rows.some((r) => r.boxes > 1)).toBe(false);
    const units = syncPlacementsFromContents(created.planUnits, [packed.content!]);
    expect(remainingBoxesFromPlanUnits(line, units)).toBe(1);
    expect(remainingBoxes(line, [packed.content!], undefined, units)).toBe(1);

    const dup = {
      ...packed.content!,
      trays: packed.content!.trays!.map((t, i) =>
        i === 0
          ? { ...t, onTray: [...t.onTray, { ...t.onTray[0]!, id: 'dup' }] }
          : t,
      ),
    };
    const issues = validateFurnace(dup, {
      cabinets: CABINETS,
      processes: PROCESSES,
      poolById: poolBy([line]),
      config: cfg,
      sameShiftFurnaces: [dup],
      trayMaster: TRAYS,
      allContents: [dup],
      planUnits: units,
    });
    expect(issues.some((i) => i.code === ISSUE_CODES.ON_TRAY_QTY_OVERFLOW && i.msg.includes('计划单元重复装载'))).toBe(
      true,
    );
  });
});

describe('C7-05 BOX_LIMIT / TRAY_OVERFLOW 按单元', () => {
  it('BOX_LIMIT 按 PlanUnit.vol 达阈值计 1 箱，达上限允许、超限阻断', () => {
    const line = stock({
      id: 'BIG',
      boxes: 4,
      boxVol: 0.15,
      vol: 0.6,
      process: '手术衣',
      allowed: ['柜8'],
    });
    const created = applyPlanUnitCreation({ line, creations: [], planUnits: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const tightCfg = {
      ...cfg,
      box: { ...cfg.box, largeBoxVol: 0.12, maxBoxesWhenLarge: 2 },
    };
    const okIds = created.planUnits.slice(0, 2).map((u) => u.id);
    const ok = manualPackCabinet({
      cabinetId: '柜8',
      lineIds: [line.id],
      planUnitIds: okIds,
      contents: [],
      cabinets: CABINETS,
      trayMaster: TRAYS,
      runtimes: [],
      config: tightCfg,
      nextId: 'CC-OK',
      poolById: poolBy([line]),
      allowInOther: false,
      planUnits: created.planUnits,
    });
    expect(ok.ok).toBe(true);
    const okIssues = validateFurnace(ok.content!, {
      cabinets: CABINETS,
      processes: PROCESSES,
      poolById: poolBy([line]),
      config: tightCfg,
      sameShiftFurnaces: [ok.content!],
      trayMaster: TRAYS,
      allContents: [ok.content!],
    });
    expect(okIssues.some((i) => i.code === ISSUE_CODES.BOX_LIMIT)).toBe(false);

    const over = manualPackCabinet({
      cabinetId: '柜8',
      lineIds: [line.id],
      planUnitIds: created.planUnits.map((u) => u.id),
      contents: [],
      cabinets: CABINETS,
      trayMaster: TRAYS,
      runtimes: [],
      config: tightCfg,
      nextId: 'CC-OVER',
      poolById: poolBy([line]),
      allowInOther: false,
      planUnits: created.planUnits,
    });
    expect(over.ok).toBe(true);
    const overIssues = validateFurnace(over.content!, {
      cabinets: CABINETS,
      processes: PROCESSES,
      poolById: poolBy([line]),
      config: tightCfg,
      sameShiftFurnaces: [over.content!],
      trayMaster: TRAYS,
      allContents: [over.content!],
    });
    expect(overIssues.some((i) => i.code === ISSUE_CODES.BOX_LIMIT && i.sev === 'error')).toBe(true);
  });

  it('TRAY_OVERFLOW 按 Σ PlanUnit.vol；达到容量允许、超出阻断', () => {
    const tray = traysForCabinet('柜9')[0]!;
    const cap = trayCapacityM3(tray);
    const unitVol = +(cap / 2).toFixed(4);
    const line = stock({ id: 'TV', boxes: 3, boxVol: unitVol, vol: +(unitVol * 3).toFixed(4) });
    const created = applyPlanUnitCreation({ line, creations: [], planUnits: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const two = created.planUnits.slice(0, 2);
    const trayInId = `CC1::${tray.id}`;
    const make = (units: PlanUnit[]) => {
      const raw = {
        id: 'CC1',
        contentId: 'CC1',
        trayId: tray.id,
        level: tray.level,
        vol: 0,
        boxes: 0,
        largeBoxes: 0,
        onTray: units.map((u) => ({
          id: `${trayInId}::${u.id}`,
          trayInContentId: trayInId,
          stockLineId: line.id,
          planUnitId: u.id,
          boxes: 1,
          vol: u.vol,
        })),
      };
      const synced = syncTrayAggregates(raw, poolBy([line]), cfg.box.largeBoxVol);
      const content: CabinetContent = {
        id: 'CC1',
        cabinetId: '柜9',
        date: null,
        shift: null,
        lines: [line.id],
        trays: [synced],
        status: 'active',
        scheduleStatus: 'unscheduled',
        taskId: null,
      };
      return content;
    };
    const atCap = make(two);
    expect(atCap.trays![0]!.vol).toBeCloseTo(cap, 3);
    expect(
      validateFurnace(atCap, {
        cabinets: CABINETS,
        processes: PROCESSES,
        poolById: poolBy([line]),
        config: cfg,
        sameShiftFurnaces: [atCap],
        trayMaster: TRAYS,
        allContents: [atCap],
      }).some((i) => i.code === ISSUE_CODES.TRAY_OVERFLOW),
    ).toBe(false);
    const overflow = make(created.planUnits);
    expect(
      validateFurnace(overflow, {
        cabinets: CABINETS,
        processes: PROCESSES,
        poolById: poolBy([line]),
        config: cfg,
        sameShiftFurnaces: [overflow],
        trayMaster: TRAYS,
        allContents: [overflow],
      }).some((i) => i.code === ISSUE_CODES.TRAY_OVERFLOW && i.sev === 'error'),
    ).toBe(true);
  });
});

describe('C7-06 组柜不建 Task，甘特才建', () => {
  it('手动/自动组柜无 date/shift/Task；甘特同步后才有 Task', () => {
    const line = stock({ id: 'G1', boxes: 2, boxVol: 0.1, vol: 0.2 });
    const created = applyPlanUnitCreation({ line, creations: [], planUnits: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool: [line],
      contents: [],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes: [],
      config: cfg,
      nextId: 'CC-G',
      poolById: poolBy([line]),
      planUnits: created.planUnits,
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.date).toBeNull();
    expect(packed.content!.shift).toBeNull();
    expect(packed.content!.taskId).toBeNull();
    expect(packed.content!.scheduleStatus).toBe('unscheduled');
    const scheduled = applyGanttSchedule({
      contents: [packed.content!],
      cabinets: CABINETS,
      processes: PROCESSES,
      config: cfg,
      poolById: poolBy([line]),
      trayMaster: TRAYS,
      startDate: '2026-07-24',
      scheduleMode: 'auto',
      epoch: '2026-07-24',
    });
    expect(scheduled.ok).toBe(true);
    expect(scheduled.tasks.length).toBeGreaterThan(0);
    expect(scheduled.contents[0]!.date).toBeTruthy();
    expect(scheduled.contents[0]!.taskId).toBeTruthy();
  });
});

describe('C7 occupied 兼容旧分量', () => {
  it('无 PlanUnit 时 remainingBoxes 仍按旧 OnTray 分量', () => {
    const line = stock({ id: 'P001x', boxes: 10, boxVol: 0.1, vol: 1 });
    const share = legacyOnTrayContent({ id: 'CC1', cabinetId: '柜9', stockLineId: line.id, boxes: 4, vol: 0.4 });
    expect(occupiedBoxesOf(line, [share])).toBe(4);
    expect(remainingBoxes(line, [share])).toBe(6);
  });
});
