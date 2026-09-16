import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { CABINETS, TRAYS } from '../../data/seed-cabinets';
import { PROCESSES } from '../../data/seed-processes';
import { applyGanttSchedule } from '../cabinet-task';
import type { CabinetContent, ScheduleSortPolicy, SortKeySpec, StockLine } from '../entities';
import { SORT_POLICY_ERROR_CODES } from '../entities';
import { autoPackCabinet } from '../grouping';
import { defaultPackSuggestPolicy } from '../pack-suggest-policy';
import {
  cloneScheduleSortPolicy,
  commitScheduleSortPolicy,
  defaultScheduleSortPolicy,
  effectiveKeys,
  formatEffectiveKeysPreview,
  orderContents,
  restoreDefaultScheduleSortPolicy,
  validateScheduleSortPolicy,
} from '../schedule-sort-policy';

function stock(
  partial: Partial<StockLine> & Pick<StockLine, 'id' | 'vol'>,
): StockLine {
  const vol = partial.vol;
  const boxes = partial.boxes ?? 10;
  const boxVol = partial.boxVol ?? vol / boxes;
  return {
    factory: '3010',
    workshop: '制造三车间',
    matType: 'N',
    ref: partial.ref ?? partial.id,
    name: partial.name ?? partial.id,
    customer: 'C-A',
    due: partial.due ?? '2026-07-26',
    wo: 'WO-1',
    batch: 'B',
    loc: '待灭菌仓·老',
    stockStatus: '非限制',
    urgent: false,
    sterilizationMethod: 'EO',
    process: 'D002',
    allowed: ['柜9', '柜20'],
    boxes,
    boxVol,
    ...partial,
    vol,
  };
}

function content(
  partial: Partial<CabinetContent> & Pick<CabinetContent, 'id' | 'lines'>,
): CabinetContent {
  return {
    cabinetId: '柜9',
    date: '2026-07-24',
    shift: '白班',
    scheduleStatus: 'scheduled',
    status: 'scheduled',
    ...partial,
  };
}

function poolBy(lines: StockLine[]) {
  const map = new Map(lines.map((l) => [l.id, l]));
  return (id: string) => map.get(id);
}

function cfgWith(policy: ScheduleSortPolicy) {
  return { ...defaultAppConfig(), scheduleSortPolicy: cloneScheduleSortPolicy(policy) };
}

function enableAndMove(policy: ScheduleSortPolicy, code: SortKeySpec['code'], before: SortKeySpec['code']): ScheduleSortPolicy {
  const next = cloneScheduleSortPolicy(policy);
  const spec = next.keys.find((k) => k.code === code);
  if (spec) spec.enabled = true;
  const keys = next.keys.filter((k) => k.code !== code);
  const moving = next.keys.find((k) => k.code === code)!;
  const idx = keys.findIndex((k) => k.code === before);
  keys.splice(idx < 0 ? 0 : idx, 0, moving);
  next.keys = keys;
  return next;
}

function sync(contents: CabinetContent[], lines: StockLine[], policy: ScheduleSortPolicy) {
  return applyGanttSchedule({
    contents,
    cabinets: CABINETS,
    processes: PROCESSES,
    config: cfgWith(policy),
    poolById: poolBy(lines),
    trayMaster: TRAYS,
    startDate: '2026-07-24',
    scheduleMode: 'auto',
    epoch: '2026-07-24',
  });
}

const cab9 = CABINETS.find((c) => c.id === '柜9')!;

describe('C2-01 非法配置拒存', () => {
  const previous = defaultScheduleSortPolicy();

  it('空启用键 → SORT_POLICY_EMPTY，旧策略不变', () => {
    const empty = { ...cloneScheduleSortPolicy(previous), keys: [] };
    expect(validateScheduleSortPolicy(empty).code).toBe(SORT_POLICY_ERROR_CODES.SORT_POLICY_EMPTY);
    const allOff = {
      ...cloneScheduleSortPolicy(previous),
      keys: previous.keys.map((k) => ({ ...k, enabled: false })),
    };
    expect(validateScheduleSortPolicy(allOff).code).toBe(SORT_POLICY_ERROR_CODES.SORT_POLICY_EMPTY);
    const result = commitScheduleSortPolicy(previous, empty);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(SORT_POLICY_ERROR_CODES.SORT_POLICY_EMPTY);
    expect(previous.keys.map((k) => k.code)).toEqual(defaultScheduleSortPolicy().keys.map((k) => k.code));
  });

  it('关掉核心键 date/shift/volume → SORT_POLICY_CORE_DISABLED', () => {
    for (const code of ['date', 'shift', 'volume'] as const) {
      const draft = cloneScheduleSortPolicy(previous);
      const spec = draft.keys.find((k) => k.code === code)!;
      spec.enabled = false;
      expect(validateScheduleSortPolicy(draft).code).toBe(SORT_POLICY_ERROR_CODES.SORT_POLICY_CORE_DISABLED);
      expect(commitScheduleSortPolicy(previous, draft).ok).toBe(false);
    }
    expect(previous.keys.find((k) => k.code === 'date')?.enabled).toBe(true);
  });

  it('未知码 / 重复键 / 非法升降序', () => {
    const unknown = {
      ...cloneScheduleSortPolicy(previous),
      keys: [{ code: 'processPriority' as never, direction: 'asc' as const, enabled: true }],
    };
    expect(validateScheduleSortPolicy(unknown).code).toBe(SORT_POLICY_ERROR_CODES.SORT_POLICY_UNKNOWN_KEY);
    const dup = {
      ...cloneScheduleSortPolicy(previous),
      keys: [
        { code: 'date' as const, direction: 'asc' as const, enabled: true },
        { code: 'date' as const, direction: 'desc' as const, enabled: true },
      ],
    };
    expect(validateScheduleSortPolicy(dup).code).toBe(SORT_POLICY_ERROR_CODES.SORT_POLICY_DUP_KEY);
    const badDir = {
      ...cloneScheduleSortPolicy(previous),
      keys: previous.keys.map((k) => (k.code === 'volume' ? { ...k, direction: 'sideways' as never } : k)),
    };
    expect(validateScheduleSortPolicy(badDir).code).toBe(SORT_POLICY_ERROR_CODES.SORT_POLICY_BAD_DIR);
    expect(commitScheduleSortPolicy(previous, unknown).ok).toBe(false);
    expect(commitScheduleSortPolicy(previous, dup).ok).toBe(false);
    expect(previous.id).toBe('default');
  });
});

describe('C2-02 恢复默认 = date↑ shift↑ volume↓ id↑', () => {
  it('恢复默认后生效序与预览对齐现行四键', () => {
    const custom = enableAndMove(defaultScheduleSortPolicy(), 'due', 'date');
    custom.keys.find((k) => k.code === 'volume')!.direction = 'asc';
    const restored = restoreDefaultScheduleSortPolicy(custom);
    expect(restored.id).toBe('default');
    expect(restored.name).toBe('现行四键（默认）');
    expect(restored.applyMode).toBe('nextSyncOnly');
    expect(restored.nullDatePolicy).toBe('treatAsLatest');
    expect(effectiveKeys(restored).map((k) => `${k.code}:${k.direction}`)).toEqual([
      'date:asc',
      'shift:asc',
      'volume:desc',
      'id:asc',
    ]);
    expect(formatEffectiveKeysPreview(restored)).toBe('date↑ · shift↑ · volume↓ · (id)');
    expect(restored.keys.find((k) => k.code === 'due')?.enabled).toBe(false);
    expect(restored.keys.find((k) => k.code === 'urgent')?.enabled).toBe(false);
    expect(restored.keys.find((k) => k.code === 'fillRate')?.enabled).toBe(false);
    expect(restored.version).toBe((custom.version || 0) + 1);
  });
});

describe('C2-03 调 volume 升降或与 date 换序 → 下次同步 seq 可区分', () => {
  const lines = [
    stock({ id: 'VA', vol: 40, due: '2026-07-28' }),
    stock({ id: 'VB', vol: 80, due: '2026-07-28' }),
  ];
  const contents: CabinetContent[] = [
    content({ id: 'CA', lines: ['VA'], date: '2026-07-24', shift: '白班' }),
    content({ id: 'CB', lines: ['VB'], date: '2026-07-25', shift: '白班' }),
  ];

  it('默认 volume↓ 且 date 优先：先 CA 后 CB；volume 提到 date 前则翻转', () => {
    const ctx = { poolById: poolBy(lines), cabinets: CABINETS };
    const def = defaultScheduleSortPolicy();
    expect(orderContents(contents, def, ctx).map((c) => c.id)).toEqual(['CA', 'CB']);
    const swapped = cloneScheduleSortPolicy(def);
    const vol = swapped.keys.find((k) => k.code === 'volume')!;
    swapped.keys = swapped.keys.filter((k) => k.code !== 'volume');
    swapped.keys.unshift(vol);
    expect(orderContents(contents, swapped, ctx).map((c) => c.id)).toEqual(['CB', 'CA']);

    const defSync = sync(contents, lines, def);
    const swapSync = sync(contents, lines, swapped);
    expect(defSync.ok && swapSync.ok).toBe(true);
    const defOrder = defSync.tasks.filter((t) => contents.some((c) => c.id === t.contentId)).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).map((t) => t.contentId);
    const swapOrder = swapSync.tasks.filter((t) => contents.some((c) => c.id === t.contentId)).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).map((t) => t.contentId);
    expect(defOrder).toEqual(['CA', 'CB']);
    expect(swapOrder).toEqual(['CB', 'CA']);
    expect(defOrder).not.toEqual(swapOrder);
  });

  it('同日同班仅调 volume 升降可区分', () => {
    const sameDay: CabinetContent[] = [
      content({ id: 'CA', lines: ['VA'], date: '2026-07-24', shift: '白班' }),
      content({ id: 'CB', lines: ['VB'], date: '2026-07-24', shift: '白班' }),
    ];
    const ctx = { poolById: poolBy(lines), cabinets: CABINETS };
    const desc = defaultScheduleSortPolicy();
    const asc = cloneScheduleSortPolicy(desc);
    asc.keys.find((k) => k.code === 'volume')!.direction = 'asc';
    expect(orderContents(sameDay, desc, ctx).map((c) => c.id)).toEqual(['CB', 'CA']);
    expect(orderContents(sameDay, asc, ctx).map((c) => c.id)).toEqual(['CA', 'CB']);
  });
});

describe('C2-04 启用 due 并置于 volume 前', () => {
  it('交期更紧更靠前，相对默认可区分', () => {
    const lines = [
      stock({ id: 'DA', vol: 80, due: '2026-08-30' }),
      stock({ id: 'DB', vol: 40, due: '2026-07-25' }),
    ];
    const contents: CabinetContent[] = [
      content({ id: 'CA', lines: ['DA'], date: '2026-07-24', shift: '白班' }),
      content({ id: 'CB', lines: ['DB'], date: '2026-07-25', shift: '白班' }),
    ];
    const ctx = { poolById: poolBy(lines), cabinets: CABINETS };
    const def = defaultScheduleSortPolicy();
    const withDue = enableAndMove(def, 'due', 'date');
    expect(orderContents(contents, def, ctx).map((c) => c.id)).toEqual(['CA', 'CB']);
    expect(orderContents(contents, withDue, ctx).map((c) => c.id)).toEqual(['CB', 'CA']);
    const a = sync(contents, lines, def);
    const b = sync(contents, lines, withDue);
    expect(a.ok && b.ok).toBe(true);
    expect(a.tasks.sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0)).map((t) => t.contentId)).toEqual(['CA', 'CB']);
    expect(b.tasks.sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0)).map((t) => t.contentId)).toEqual(['CB', 'CA']);
  });
});

describe('C2-05 启用 urgent / fillRate 可区分', () => {
  it('urgent desc 置于最前：加急更靠前', () => {
    const lines = [
      stock({ id: 'UA', vol: 80, urgent: false, due: '2026-07-28' }),
      stock({ id: 'UB', vol: 40, urgent: true, due: '2026-07-28' }),
    ];
    const contents: CabinetContent[] = [
      content({ id: 'CA', lines: ['UA'], date: '2026-07-24', shift: '白班' }),
      content({ id: 'CB', lines: ['UB'], date: '2026-07-25', shift: '白班' }),
    ];
    const ctx = { poolById: poolBy(lines), cabinets: CABINETS };
    const def = defaultScheduleSortPolicy();
    const withUrgent = enableAndMove(def, 'urgent', 'date');
    expect(orderContents(contents, def, ctx).map((c) => c.id)).toEqual(['CA', 'CB']);
    expect(orderContents(contents, withUrgent, ctx).map((c) => c.id)).toEqual(['CB', 'CA']);
  });

  it('fillRate desc 置于最前：装柜率更高更靠前', () => {
    const lines = [
      stock({ id: 'FA', vol: 40, due: '2026-07-28' }),
      stock({ id: 'FB', vol: 80, due: '2026-07-28' }),
    ];
    const contents: CabinetContent[] = [
      content({ id: 'CA', lines: ['FA'], date: '2026-07-24', shift: '白班', fillRate: 40 / cab9.ratedLoadM3 }),
      content({ id: 'CB', lines: ['FB'], date: '2026-07-25', shift: '白班', fillRate: 80 / cab9.ratedLoadM3 }),
    ];
    const ctx = { poolById: poolBy(lines), cabinets: CABINETS };
    const def = defaultScheduleSortPolicy();
    const withFill = enableAndMove(def, 'fillRate', 'date');
    expect(orderContents(contents, def, ctx).map((c) => c.id)).toEqual(['CA', 'CB']);
    expect(orderContents(contents, withFill, ctx).map((c) => c.id)).toEqual(['CB', 'CA']);
  });
});

describe('C2-06 仅保存策略不改已有 Task 链', () => {
  it('commitScheduleSortPolicy 不重写 contents / tasks', () => {
    const lines = [
      stock({ id: 'SA', vol: 40 }),
      stock({ id: 'SB', vol: 80 }),
    ];
    const contents: CabinetContent[] = [
      content({ id: 'CA', lines: ['SA'], date: '2026-07-24', shift: '白班' }),
      content({ id: 'CB', lines: ['SB'], date: '2026-07-25', shift: '白班' }),
    ];
    const scheduled = sync(contents, lines, defaultScheduleSortPolicy());
    expect(scheduled.ok).toBe(true);
    const beforeTasks = JSON.stringify(scheduled.tasks);
    const beforeContents = JSON.stringify(scheduled.contents);
    const draft = enableAndMove(defaultScheduleSortPolicy(), 'due', 'date');
    const saved = commitScheduleSortPolicy(defaultScheduleSortPolicy(), draft);
    expect(saved.ok).toBe(true);
    expect(saved.ok && saved.policy.applyMode).toBe('nextSyncOnly');
    expect(JSON.stringify(scheduled.tasks)).toBe(beforeTasks);
    expect(JSON.stringify(scheduled.contents)).toBe(beforeContents);
  });
});

describe('C2-07 同步不改 StockLine.due；组柜仍无 Task', () => {
  it('applyGanttSchedule 不改写 due；autoPack 无 taskId', () => {
    const lines = [
      stock({ id: 'XA', vol: 30, due: '2026-07-29', process: 'D002', allowed: ['柜9'] }),
    ];
    const dueBefore = lines[0]!.due;
    const packed = autoPackCabinet({
      cabinetId: '柜9',
      pool: lines,
      contents: [],
      cabinets: [cab9],
      processes: PROCESSES,
      trayMaster: TRAYS.filter((t) => t.cabinetId === '柜9').map((t) => ({ ...t, capacityM3: 500, ratedLoadM3: 500 })),
      runtimes: [],
      config: cfgWith(defaultScheduleSortPolicy()),
      nextId: 'CC-X',
      poolById: poolBy(lines),
    });
    expect(packed.ok).toBe(true);
    expect(packed.content!.taskId).toBeNull();
    expect(packed.content!.date).toBeNull();
    expect(packed.content!.shift).toBeNull();

    const scheduled = sync([packed.content!], lines, defaultScheduleSortPolicy());
    expect(scheduled.ok).toBe(true);
    expect(scheduled.contents[0]!.taskId).toBeTruthy();
    expect(poolBy(lines)('XA')!.due).toBe(dueBefore);
    expect(lines[0]!.due).toBe(dueBefore);
  });
});

describe('C2-08 仍按柜建链', () => {
  it('两柜多 Content 同步后柜 A seq 不插入柜 B', () => {
    const lines = [
      stock({ id: 'A1', vol: 40 }),
      stock({ id: 'A2', vol: 50 }),
      stock({ id: 'B1', vol: 40 }),
      stock({ id: 'B2', vol: 50 }),
    ];
    const contents: CabinetContent[] = [
      content({ id: 'CA1', cabinetId: '柜9', lines: ['A1'], date: '2026-07-24', shift: '白班' }),
      content({ id: 'CA2', cabinetId: '柜9', lines: ['A2'], date: '2026-07-25', shift: '白班' }),
      content({ id: 'CB1', cabinetId: '柜20', lines: ['B1'], date: '2026-07-24', shift: '白班' }),
      content({ id: 'CB2', cabinetId: '柜20', lines: ['B2'], date: '2026-07-25', shift: '白班' }),
    ];
    expect(() => orderContents(contents, defaultScheduleSortPolicy(), { poolById: poolBy(lines), cabinets: CABINETS })).toThrow(
      'SORT_POLICY_MIXED_CABINET',
    );
    const result = sync(contents, lines, defaultScheduleSortPolicy());
    expect(result.ok).toBe(true);
    const tasksA = result.tasks.filter((t) => ['CA1', 'CA2'].includes(t.contentId)).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const tasksB = result.tasks.filter((t) => ['CB1', 'CB2'].includes(t.contentId)).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    expect(tasksA.map((t) => t.seq)).toEqual([1, 2]);
    expect(tasksB.map((t) => t.seq)).toEqual([1, 2]);
    expect(tasksA[0]!.nextTaskId).toBe(tasksA[1]!.id);
    expect(tasksA[1]!.previousTaskId).toBe(tasksA[0]!.id);
    expect(tasksB.map((t) => t.id)).not.toEqual(expect.arrayContaining(tasksA.map((t) => t.id)));
    expect([tasksA[0]!.previousTaskId, tasksA[0]!.nextTaskId, tasksA[1]!.previousTaskId, tasksA[1]!.nextTaskId]).not.toEqual(
      expect.arrayContaining(tasksB.map((t) => t.id)),
    );
  });
});

describe('C2-09 变更-3 packSuggestPolicy 回归', () => {
  it('默认配置仍含变更-3 真源 packSuggestPolicy', () => {
    const cfg = defaultAppConfig();
    const pack = defaultPackSuggestPolicy();
    expect(cfg.packSuggestPolicy.preset).toBe('fillFirst');
    expect(cfg.packSuggestPolicy.fillMode).toBe('fillOneFirst');
    expect(cfg.packSuggestPolicy.targetFillRate).toBe(0.8);
    expect(cfg.packSuggestPolicy.dueWindowDays).toBe(3);
    expect(cfg.packSuggestPolicy.dimensions.find((d) => d.code === 'dueCluster')?.enabled).toBe(false);
    expect(cfg.packSuggestPolicy.applyMode).toBe(pack.applyMode);
    expect(cfg.scheduleSortPolicy.applyMode).toBe('nextSyncOnly');
    expect(formatEffectiveKeysPreview(cfg.scheduleSortPolicy)).toBe('date↑ · shift↑ · volume↓ · (id)');
  });
});

describe('C2-11 系统强制末键 id', () => {
  it('UI 未显式排 id 时比较仍以 id asc 破平', () => {
    const lines = [stock({ id: 'IA', vol: 40 }), stock({ id: 'IB', vol: 40 })];
    const contents: CabinetContent[] = [
      content({ id: 'ZZ', lines: ['IB'], date: '2026-07-24', shift: '白班' }),
      content({ id: 'AA', lines: ['IA'], date: '2026-07-24', shift: '白班' }),
    ];
    const keys = effectiveKeys(defaultScheduleSortPolicy());
    expect(keys[keys.length - 1]).toEqual({ code: 'id', direction: 'asc', enabled: true });
    const ordered = orderContents(contents, defaultScheduleSortPolicy(), { poolById: poolBy(lines), cabinets: CABINETS });
    expect(ordered.map((c) => c.id)).toEqual(['AA', 'ZZ']);
  });
});

describe('C2-12 未排 Content 靠后', () => {
  it('date=null 相对已有 date 固定靠后', () => {
    const lines = [stock({ id: 'PA', vol: 90 }), stock({ id: 'PB', vol: 10 })];
    const contents: CabinetContent[] = [
      content({ id: 'UNSCHED', lines: ['PA'], date: null, shift: null, scheduleStatus: 'unscheduled' }),
      content({ id: 'SCHED', lines: ['PB'], date: '2026-07-24', shift: '白班' }),
    ];
    const ordered = orderContents(contents, defaultScheduleSortPolicy(), { poolById: poolBy(lines), cabinets: CABINETS });
    expect(ordered.map((c) => c.id)).toEqual(['SCHED', 'UNSCHED']);
  });
});
