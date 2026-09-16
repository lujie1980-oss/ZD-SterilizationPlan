import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { CABINETS, TRAYS, traysForCabinet } from '../../data/seed-cabinets';
import { createSeedPool } from '../../data/seed-pool';
import { PROCESSES } from '../../data/seed-processes';
import { applyGanttSchedule } from '../cabinet-task';
import {
  fillRateOf,
  findPlacement,
  normalizeCabinetContent,
  occupiedBoxesOf,
  remainingBoxes,
  trayCapacityM3,
} from '../cabinet-content';
import { demoRuntimeOverrides, deriveAllRuntimes } from '../cabinet-runtime';
import type { CabinetContent, RuleContext } from '../entities';
import {
  autoPackCabinet,
  focusDemand,
  listCandidateCabinets,
  listEligibleForCabinet,
  markLoadComplete,
  manualPackCabinet,
  replaceCabinetActive,
  toggleDemandCheck,
} from '../grouping';
import { decideCommit } from '../commit-gate';
import { validateFurnace } from '../rule-engine';

const pool = createSeedPool();
const poolById = (id: string) => pool.find((p) => p.id === id);
const cfg = defaultAppConfig();

function content(partial: Partial<CabinetContent> & Pick<CabinetContent, 'id' | 'cabinetId' | 'lines'>): CabinetContent {
  return normalizeCabinetContent(
    {
      date: null,
      shift: null,
      scheduleStatus: 'unscheduled',
      status: 'active',
      fillRate: 0,
      loadComplete: false,
      taskId: null,
      ...partial,
    },
    {
      trayMaster: TRAYS,
      poolById,
      largeBoxVol: cfg.box.largeBoxVol,
      cabinet: CABINETS.find((c) => c.id === partial.cabinetId),
    },
  );
}

function groupingCtx(contents: CabinetContent[]): RuleContext {
  return {
    cabinets: CABINETS,
    processes: PROCESSES,
    poolById,
    config: cfg,
    sameShiftFurnaces: contents,
    trayMaster: TRAYS,
    allContents: contents,
    runtimes: deriveAllRuntimes(CABINETS, contents, []),
  };
}

function onTrayShare(opts: {
  id: string;
  cabinetId: string;
  stockLineId: string;
  boxes: number;
  vol: number;
  loadComplete?: boolean;
}): CabinetContent {
  const tray = traysForCabinet(opts.cabinetId)[0]!;
  return normalizeCabinetContent(
    {
      id: opts.id,
      cabinetId: opts.cabinetId,
      date: null,
      shift: null,
      lines: [opts.stockLineId],
      loadComplete: opts.loadComplete,
      trays: [
        {
          id: `${opts.id}::${tray.id}`,
          contentId: opts.id,
          trayId: tray.id,
          level: tray.level,
          vol: 0,
          boxes: 0,
          largeBoxes: 0,
          onTray: [
            {
              id: `${opts.id}::${tray.id}::${opts.stockLineId}`,
              trayInContentId: `${opts.id}::${tray.id}`,
              stockLineId: opts.stockLineId,
              boxes: opts.boxes,
              vol: opts.vol,
            },
          ],
        },
      ],
    },
    {
      trayMaster: TRAYS,
      poolById,
      largeBoxVol: cfg.box.largeBoxVol,
      cabinet: CABINETS.find((c) => c.id === opts.cabinetId),
    },
  );
}

describe('变更-1 选柜完整列表与排入状态 (C1-18/19/20/21)', () => {
  it('C1-18: 选柜后凡 hardEligible 行都出现，不得漏行', () => {
    const rows = listEligibleForCabinet({
      cabinetId: '柜9',
      pool,
      contents: [],
      cabinets: CABINETS,
      config: cfg,
    });
    const expected = pool.filter((p) => !p.splitOf && p.allowed.includes('柜9') && p.stockStatus !== '限制');
    expect(rows.map((r) => r.lineId).sort()).toEqual(expected.map((p) => p.id).sort());
    expect(rows.some((r) => r.lineId === 'P015')).toBe(false);
    expect(rows.some((r) => r.lineId === 'P004')).toBe(false);
  });

  it('C1-19: 每行必有已进本柜 / 已进其他柜 / 未排', () => {
    const contents = [
      content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'] }),
      content({ id: 'CC2', cabinetId: '柜20', lines: ['P003'] }),
    ];
    const rows = listEligibleForCabinet({
      cabinetId: '柜9',
      pool,
      contents,
      cabinets: CABINETS,
      config: cfg,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.lineId, r]));
    expect(byId.P001?.placement).toBe('inThisCabinet');
    expect(byId.P003?.placement).toBe('inOtherCabinet');
    expect(byId.P003?.otherCabinetId).toBe('柜20');
    expect(byId.P002?.placement).toBe('unassigned');
    expect(rows.every((r) => ['inThisCabinet', 'inOtherCabinet', 'unassigned'].includes(r.placement))).toBe(true);
  });

  it('C1-20: 柜已有载荷时已组入行仍可见，候选 0 不得表现为柜空', () => {
    const loaded = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001', 'P002', 'P014'] });
    const rows = listEligibleForCabinet({
      cabinetId: '柜9',
      pool,
      contents: [loaded],
      cabinets: CABINETS,
      config: cfg,
    });
    const inThis = rows.filter((r) => r.placement === 'inThisCabinet');
    expect(inThis.map((r) => r.lineId).sort()).toEqual(['P001', 'P002', 'P014']);
    const vol = inThis.reduce((s, r) => s + r.line.vol, 0);
    expect(vol).toBeCloseTo(loaded.trays!.reduce((s, t) => s + t.vol, 0));
    expect(loaded.fillRate).toBeGreaterThan(0);
    expect(rows.filter((r) => r.placement === 'unassigned').length).toBeGreaterThanOrEqual(0);
    expect(inThis.length).toBeGreaterThan(0);
  });

  it('C1-21: 自动组柜不重复占用已进其他柜', () => {
    const other = content({ id: 'CC2', cabinetId: '柜20', lines: ['P003'] });
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool,
      contents: [other],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes: [],
      config: cfg,
      nextId: 'CC-NEW',
      poolById,
    });
    expect(packed.ok).toBe(true);
    expect(packed.skippedOther).toContain('P003');
    expect(packed.content!.lines).not.toContain('P003');
  });
});

describe('变更-1 组柜无日期班次 / 甘特才写回 (C1-11/22/23/37/38)', () => {
  it('C1-11/22: 组柜候选函数不接受上线日期或班次；结果 date/shift=null', () => {
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool,
      contents: [],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes: [],
      config: cfg,
      nextId: 'CC-A',
      poolById,
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.date).toBeNull();
    expect(packed.content!.shift).toBeNull();
    expect(packed.content!.taskId).toBeFalsy();
    expect(packed.content!.scheduleStatus).toBe('unscheduled');
  });

  it('C1-37: 组柜完成未进甘特 → 有 Content+Trays+OnTray，无 CabinetTask', () => {
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool,
      contents: [],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes: [],
      config: cfg,
      nextId: 'CC-A',
      poolById,
    });
    const c = packed.content!;
    expect(c.trays!.length).toBeGreaterThan(0);
    expect(c.trays!.every((t) => t.trayId && t.trayId.length)).toBe(true);
    const master = traysForCabinet('柜9');
    expect(c.trays!.every((t) => master.some((m) => m.id === t.trayId))).toBe(true);
    expect(c.trays!.every((t) => t.onTray.length >= 1)).toBe(true);
    expect(c.taskId).toBeNull();
  });

  it('C1-23/38: 进炉甘特首次排入炉才建 Task 链并写回 date/shift/seq', () => {
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool,
      contents: [],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes: [],
      config: cfg,
      nextId: 'CC-A',
      poolById,
    });
    const beforeShift = packed.content!.shift;
    const dueBefore = poolById('P001')!.due;
    const scheduled = applyGanttSchedule({
      contents: [packed.content!],
      cabinets: CABINETS,
      processes: PROCESSES,
      config: cfg,
      poolById,
      trayMaster: TRAYS,
      startDate: '2026-07-24',
      scheduleMode: 'auto',
      epoch: '2026-07-24',
    });
    expect(scheduled.ok).toBe(true);
    const c = scheduled.contents[0]!;
    expect(c.date).toBe('2026-07-24');
    expect(c.shift).toBe('白班');
    expect(c.seq).toBe(1);
    expect(c.taskId).toBeTruthy();
    expect(c.scheduleStatus).toBe('scheduled');
    const task = scheduled.tasks.find((t) => t.contentId === c.id)!;
    expect(task.isFirst).toBe(true);
    expect(task.previousTaskId).toBeNull();
    expect(scheduled.schedules[0]!.firstTaskId).toBe(task.id);
    expect(beforeShift).toBeNull();
    expect(poolById('P001')!.due).toBe(dueBefore);
  });
});

describe('变更-1 入口 B 与运行态 (C1-30/33/42)', () => {
  it('C1-30: sterilizing 柜仍出现在可组柜列表但不可选', () => {
    const runtimes = deriveAllRuntimes(CABINETS, [], demoRuntimeOverrides());
    const rows = listCandidateCabinets({
      lineIds: ['P012'],
      poolById,
      cabinets: CABINETS,
      runtimes,
    });
    const cab14 = rows.find((r) => r.cabinetId === '柜14');
    expect(cab14).toBeTruthy();
    expect(cab14!.runtime).toBe('sterilizing');
    expect(cab14!.selectable).toBe(false);
    expect(cab14!.disabledReason).toMatch(/灭菌中/);
  });

  it('C1-33: 选中一条演示 StockLine 立刻出现非空可组柜列表', () => {
    const runtimes = deriveAllRuntimes(CABINETS, [], demoRuntimeOverrides());
    const rows = listCandidateCabinets({
      lineIds: ['P001'],
      poolById,
      cabinets: CABINETS,
      runtimes,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.cabinetId).sort()).toEqual(['柜20', '柜9']);
  });

  it('C1-42/43: 单击需求行只聚焦，不勾选；只有 checkbox 进入多选', () => {
    let sel = { focusedId: null as string | null, checkedIds: [] as string[] };
    sel = focusDemand(sel, 'P001');
    expect(sel.focusedId).toBe('P001');
    expect(sel.checkedIds).toEqual([]);
    sel = toggleDemandCheck(sel, 'P002', true);
    expect(sel.checkedIds).toEqual(['P002']);
    expect(sel.focusedId).toBe('P001');
  });

  it('loadComplete 不当空闲：自动禁再拼', () => {
    const loaded = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'], loadComplete: true });
    const runtimes = deriveAllRuntimes(CABINETS, [loaded], []);
    expect(runtimes.find((r) => r.cabinetId === '柜9')?.status).toBe('loadComplete');
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool,
      contents: [loaded],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes,
      config: cfg,
      nextId: 'CC-X',
      poolById,
    });
    expect(packed.ok).toBe(false);
    expect(packed.message).toMatch(/装填完毕/);
  });
});

describe('变更-1 结构 / 装柜率 / 闸门 (C1-16/36/39 + A)', () => {
  it('fillRate 分母为 ratedLoadM3', () => {
    const c = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'] });
    const cab = CABINETS.find((x) => x.id === '柜9')!;
    expect(cab.ratedLoadM3).toBe(100);
    expect(c.fillRate).toBeCloseTo(fillRateOf(c, cab, poolById));
    expect(c.fillRate).toBeCloseTo((poolById('P001')!.vol) / 100);
  });

  it('C1-36: 旧 FurnaceRun 别名可读，结构为 Content→Trays→OnTray', () => {
    const c = content({ id: 'F1', cabinetId: '柜9', lines: ['P001'] });
    const furnaceRun: CabinetContent = c;
    expect(furnaceRun.trays![0]!.onTray[0]!.stockLineId).toBe('P001');
  });

  it('C1-16: 自动路径 error 不落盘', () => {
    const empty: CabinetContent = {
      id: 'F1',
      cabinetId: '柜8',
      date: null,
      shift: null,
      lines: [],
    };
    const next: CabinetContent = {
      ...empty,
      lines: ['P001'],
    };
    const ctx = {
      cabinets: CABINETS,
      processes: PROCESSES,
      poolById,
      config: cfg,
      sameShiftFurnaces: [next],
    };
    const decision = decideCommit({
      previous: [empty],
      next: [next],
      config: cfg,
      ctx,
      editSource: 'auto',
    });
    expect(decision.aborted).toBe(true);
    expect(decision.persisted[0]!.lines).toEqual([]);
  });

  it('C1-39: 同柜不得两份活动计划并行', () => {
    const a = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'] });
    const b = content({ id: 'CC2', cabinetId: '柜9', lines: ['P002'] });
    const result = replaceCabinetActive([a], b);
    expect(result.ok).toBe(false);
    expect(result.issue?.code).toBe('ACTIVE_CONTENT');
  });

  it('C1-29: StockLine 含销售订单号与规格长宽高体积', () => {
    const p001 = poolById('P001')!;
    expect(p001.salesOrderNo).toBeTruthy();
    expect(p001.dimL).toBeGreaterThan(0);
    expect(p001.dimW).toBeGreaterThan(0);
    expect(p001.dimH).toBeGreaterThan(0);
    expect(p001.boxVol).toBeGreaterThan(0);
    expect(p001.vol).toBeCloseTo(p001.boxes * p001.boxVol);
  });

  it('C1-32: auto 有 error 不得标 loadComplete', () => {
    const bad: CabinetContent = { id: 'F1', cabinetId: '柜8', date: null, shift: null, lines: ['P001'] };
    const issues = validateFurnace(bad, {
      cabinets: CABINETS,
      processes: PROCESSES,
      poolById,
      config: cfg,
      sameShiftFurnaces: [bad],
    });
    expect(issues.some((i) => i.sev === 'error')).toBe(true);
    const marked = markLoadComplete({ content: bad, issues, scheduleMode: 'auto' });
    expect(marked.ok).toBe(false);
    const manual = markLoadComplete({ content: bad, issues, scheduleMode: 'manual' });
    expect(manual.ok).toBe(true);
    expect(manual.content.loadComplete).toBe(true);
    expect(manual.content.manualViolation).toBe(true);
  });

  it('findPlacement 解释已进本柜体积同源', () => {
    const c = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'] });
    expect(findPlacement('P001', [c])?.cabinetId).toBe('柜9');
    expect(findPlacement('P002', [c])).toBeUndefined();
  });

  it('C1-08: 旧 plan（皆有 date）加载后为 scheduled', () => {
    const old = normalizeCabinetContent(
      { id: 'F1', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P001'] },
      {
        trayMaster: TRAYS,
        poolById,
        largeBoxVol: cfg.box.largeBoxVol,
        cabinet: CABINETS.find((c) => c.id === '柜9'),
      },
    );
    expect(old.scheduleStatus).toBe('scheduled');
    expect(old.status).toBe('scheduled');
    expect(old.date).toBe('2026-07-24');
  });
});

describe('变更-1 入口 B 多行柜交集 / 报废不可选', () => {
  it('C1-14: 多行取允许柜交集；报废柜不在列', () => {
    const rows = listCandidateCabinets({
      lineIds: ['P001', 'P014'],
      poolById,
      cabinets: CABINETS,
      runtimes: [],
    });
    const ids = rows.map((r) => r.cabinetId).sort();
    expect(ids).toEqual(['柜20', '柜9']);
    expect(ids).not.toContain('柜1');
  });
});

describe('C1-28 超托盘（Tray.capacityM3）', () => {
  it('Tray 主数据有 capacityM3；装柜率分母仍为柜 ratedLoadM3', () => {
    const tray = traysForCabinet('柜9')[0]!;
    expect(tray.capacityM3).toBeGreaterThan(0);
    expect(trayCapacityM3(tray)).toBe(tray.capacityM3);
    const c = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'] });
    const cab = CABINETS.find((x) => x.id === '柜9')!;
    expect(c.fillRate).toBeCloseTo(poolById('P001')!.vol / cab.ratedLoadM3);
  });

  it('托盘已装体积超过 capacityM3 时发出 TRAY_OVERFLOW error', () => {
    const c = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'] });
    const tray = traysForCabinet('柜9')[0]!;
    expect(c.trays![0]!.vol).toBeGreaterThan(trayCapacityM3(tray));
    const issues = validateFurnace(c, groupingCtx([c]));
    expect(issues.some((i) => i.code === 'TRAY_OVERFLOW' && i.sev === 'error' && i.msg.includes('超托盘'))).toBe(true);
  });

  it('未超托盘容积不发 TRAY_OVERFLOW', () => {
    const c = content({ id: 'CC1', cabinetId: '柜9', lines: ['P003'] });
    const cap = trayCapacityM3(traysForCabinet('柜9')[0]!);
    expect(c.trays![0]!.vol).toBeLessThanOrEqual(cap);
    const issues = validateFurnace(c, groupingCtx([c]));
    expect(issues.some((i) => i.code === 'TRAY_OVERFLOW')).toBe(false);
  });

  it('auto 闸门对 TRAY_OVERFLOW 拒绝落盘；manual 可落盘并标手工违例', () => {
    const empty = content({ id: 'CC1', cabinetId: '柜9', lines: [] });
    const over = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'] });
    expect(validateFurnace(over, groupingCtx([over])).some((i) => i.code === 'TRAY_OVERFLOW' && i.sev === 'error')).toBe(true);
    const autoDecision = decideCommit({
      previous: [empty],
      next: [over],
      config: cfg,
      ctx: groupingCtx([over]),
      editSource: 'auto',
    });
    expect(autoDecision.aborted).toBe(true);
    expect(autoDecision.issues.some((i) => i.code === 'TRAY_OVERFLOW')).toBe(true);
    expect(autoDecision.persisted[0]!.lines).toEqual([]);
    const manualDecision = decideCommit({
      previous: [empty],
      next: [over],
      config: { ...cfg, scheduleMode: 'manual' },
      ctx: groupingCtx([over]),
      editSource: 'manual',
    });
    expect(manualDecision.aborted).toBe(false);
    expect(manualDecision.persisted[0]!.manualViolation).toBe(true);
    expect(manualDecision.needsOverridePrompt).toBe(true);
  });
});

describe('C1-31 装填完毕后再拼', () => {
  it('loadComplete 不当空闲：可选查看、自动禁再拼、不标 idle', () => {
    const loaded = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'], loadComplete: true });
    const runtimes = deriveAllRuntimes(CABINETS, [loaded], []);
    expect(runtimes.find((r) => r.cabinetId === '柜9')?.status).toBe('loadComplete');
    expect(runtimes.find((r) => r.cabinetId === '柜9')?.status).not.toBe('idle');
    const rows = listCandidateCabinets({
      lineIds: ['P002'],
      poolById,
      cabinets: CABINETS,
      runtimes,
    });
    const cab9 = rows.find((r) => r.cabinetId === '柜9')!;
    expect(cab9.selectable).toBe(true);
    expect(cab9.autoPackBlocked).toBe(true);
    expect(cab9.disabledReason).toMatch(/待入炉|不当空闲/);
  });

  it('auto：装填完毕拒绝再拼落盘', () => {
    const loaded = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'], loadComplete: true });
    const runtimes = deriveAllRuntimes(CABINETS, [loaded], []);
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool,
      contents: [loaded],
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes,
      config: cfg,
      nextId: 'CC-X',
      poolById,
    });
    expect(packed.ok).toBe(false);
    expect(packed.issues.some((i) => i.code === 'REPACK_AFTER_LOAD_COMPLETE' && i.sev === 'error')).toBe(true);

    const attempted = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001', 'P002'], loadComplete: true });
    const decision = decideCommit({
      previous: [loaded],
      next: [attempted],
      config: cfg,
      ctx: groupingCtx([attempted]),
      editSource: 'auto',
    });
    expect(decision.aborted).toBe(true);
    expect(decision.persisted[0]!.lines).toEqual(['P001']);
  });

  it('manual：允许再拼但 REPACK_AFTER_LOAD_COMPLETE 强预警并标手工违例', () => {
    const loaded = content({ id: 'CC1', cabinetId: '柜9', lines: ['P001'], loadComplete: true });
    const runtimes = deriveAllRuntimes(CABINETS, [loaded], []);
    const packed = manualPackCabinet({
      cabinetId: '柜9',
      lineIds: ['P002'],
      contents: [loaded],
      cabinets: CABINETS,
      trayMaster: TRAYS,
      runtimes,
      config: { ...cfg, scheduleMode: 'manual' },
      nextId: 'CC-X',
      poolById,
      allowInOther: false,
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.loadComplete).toBe(true);
    expect(packed.content!.lines).toEqual(expect.arrayContaining(['P001', 'P002']));
    const next = replaceCabinetActive([loaded], packed.content!).contents;
    const decision = decideCommit({
      previous: [loaded],
      next,
      config: { ...cfg, scheduleMode: 'manual' },
      ctx: groupingCtx(next),
      editSource: 'manual',
    });
    expect(decision.aborted).toBe(false);
    expect(decision.issues.some((i) => i.code === 'REPACK_AFTER_LOAD_COMPLETE' && i.sev === 'error')).toBe(true);
    expect(decision.persisted.find((c) => c.id === packed.content!.id)?.manualViolation).toBe(true);
    expect(decision.needsOverridePrompt).toBe(true);
  });
});

describe('C1-40 OnTray 分量不得超过 StockLine 剩余可排量', () => {
  it('occupied / remaining 按 OnTray 分量合计，扁平行视为整行占用', () => {
    const p001 = poolById('P001')!;
    const share = onTrayShare({ id: 'CC1', cabinetId: '柜9', stockLineId: 'P001', boxes: 200, vol: 20 });
    expect(occupiedBoxesOf(p001, [share])).toBe(200);
    expect(remainingBoxes(p001, [share])).toBe(p001.boxes - 200);
    const flat: CabinetContent = { id: 'CC0', cabinetId: '柜20', date: null, shift: null, lines: ['P001'] };
    expect(occupiedBoxesOf(p001, [flat])).toBe(p001.boxes);
    expect(remainingBoxes(p001, [flat])).toBe(0);
  });

  it('单柜 OnTray 箱数/体积超过本行总量 → ON_TRAY_QTY_OVERFLOW error', () => {
    const p001 = poolById('P001')!;
    const over = onTrayShare({
      id: 'CC1',
      cabinetId: '柜9',
      stockLineId: 'P001',
      boxes: p001.boxes + 50,
      vol: p001.vol + 5,
    });
    const issues = validateFurnace(over, groupingCtx([over]));
    expect(issues.some((i) => i.code === 'ON_TRAY_QTY_OVERFLOW' && i.sev === 'error' && i.lineId === 'P001')).toBe(true);
  });

  it('跨柜已占用后剩余不足 → ON_TRAY_QTY_OVERFLOW；未超量不报', () => {
    const p001 = poolById('P001')!;
    const other = onTrayShare({ id: 'CC2', cabinetId: '柜20', stockLineId: 'P001', boxes: 200, vol: 20 });
    const extra = onTrayShare({ id: 'CC1', cabinetId: '柜9', stockLineId: 'P001', boxes: 100, vol: 10 });
    expect(remainingBoxes(p001, [other])).toBe(p001.boxes - 200);
    expect(validateFurnace(extra, groupingCtx([other, extra])).some((i) => i.code === 'ON_TRAY_QTY_OVERFLOW')).toBe(true);
    const ok = onTrayShare({ id: 'CC1', cabinetId: '柜9', stockLineId: 'P001', boxes: 80, vol: 8 });
    expect(validateFurnace(ok, groupingCtx([other, ok])).some((i) => i.code === 'ON_TRAY_QTY_OVERFLOW')).toBe(false);
  });

  it('auto 闸门对 ON_TRAY_QTY_OVERFLOW 拒绝落盘', () => {
    const p001 = poolById('P001')!;
    const empty = content({ id: 'CC1', cabinetId: '柜9', lines: [] });
    const over = onTrayShare({
      id: 'CC1',
      cabinetId: '柜9',
      stockLineId: 'P001',
      boxes: p001.boxes + 10,
      vol: p001.vol + 1,
    });
    const decision = decideCommit({
      previous: [empty],
      next: [over],
      config: cfg,
      ctx: groupingCtx([over]),
      editSource: 'auto',
    });
    expect(decision.aborted).toBe(true);
    expect(decision.issues.some((i) => i.code === 'ON_TRAY_QTY_OVERFLOW')).toBe(true);
    expect(decision.persisted[0]!.lines).toEqual([]);
  });
});
