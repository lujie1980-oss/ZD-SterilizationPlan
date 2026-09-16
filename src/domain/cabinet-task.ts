import type { AppConfig, CabinetContent, CabinetTask, FurnaceSchedule, Process, Shift, StockLine, ValidationIssue } from './entities';
import { cloneContent, isUnscheduled, normalizeCabinetContent } from './cabinet-content';
import { buildEntryLoads } from './entry-scheduler';
import type { Cabinet, Tray } from './entities';
import { addDays, fmtDate } from './dates';

export interface GanttScheduleResult {
  ok: boolean;
  aborted: boolean;
  contents: CabinetContent[];
  tasks: CabinetTask[];
  schedules: FurnaceSchedule[];
  issues: ValidationIssue[];
  message: string;
}

function nextShiftDate(date: string, shift: Shift): { date: string; shift: Shift } {
  if (shift === '白班') return { date, shift: '夜班' };
  return { date: fmtDate(addDays(date, 1)), shift: '白班' };
}

function occupiedSlots(contents: CabinetContent[], cabinetId: string): Set<string> {
  const s = new Set<string>();
  for (const c of contents) {
    if (c.cabinetId !== cabinetId || c.hidden || !c.date || !c.shift) continue;
    s.add(`${c.date}|${c.shift}`);
  }
  return s;
}

export function buildTaskChain(contents: CabinetContent[], cabinetId: string, startSeq: number): {
  tasks: CabinetTask[];
  contents: CabinetContent[];
  firstTaskId: string | null;
  nextSeq: number;
} {
  const list = contents
    .filter((c) => c.cabinetId === cabinetId && !c.hidden && c.lines.length && c.date && c.shift)
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return String(a.date) < String(b.date) ? -1 : 1;
      if (a.shift !== b.shift) return a.shift === '白班' ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
  const tasks: CabinetTask[] = [];
  let seq = startSeq;
  list.forEach((c, i) => {
    const id = c.taskId || `T${seq++}`;
    tasks.push({
      id,
      contentId: c.id,
      previousTaskId: null,
      nextTaskId: null,
      isFirst: i === 0,
      seq: i + 1,
    });
  });
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    t.previousTaskId = i > 0 ? tasks[i - 1]!.id : null;
    t.nextTaskId = i < tasks.length - 1 ? tasks[i + 1]!.id : null;
    t.isFirst = i === 0;
  }
  const byContent = new Map(tasks.map((t) => [t.contentId, t]));
  const nextContents: CabinetContent[] = contents.map((c) => {
    const t = byContent.get(c.id);
    if (!t) return c;
    return {
      ...c,
      taskId: t.id,
      seq: t.seq ?? null,
      status: c.status === 'inSterilization' ? 'inSterilization' : 'scheduled',
      scheduleStatus: 'scheduled',
    };
  });
  return { tasks, contents: nextContents, firstTaskId: tasks[0]?.id ?? null, nextSeq: seq };
}

export function applyGanttSchedule(opts: {
  contents: CabinetContent[];
  cabinets: Cabinet[];
  processes: Process[];
  config: AppConfig;
  poolById: (id: string) => StockLine | undefined;
  trayMaster: Tray[];
  startDate: string;
  scheduleMode: 'auto' | 'manual';
  epoch: string;
  nextTaskSeq?: number;
}): GanttScheduleResult {
  const previous = opts.contents.map(cloneContent);
  let working = opts.contents.map(cloneContent);
  const largeBoxVol = opts.config.box.largeBoxVol;

  const cabIds = [...new Set(working.filter((c) => !c.hidden && c.lines.length).map((c) => c.cabinetId))];
  for (const cabinetId of cabIds) {
    const slots = occupiedSlots(working, cabinetId);
    let cursor = { date: opts.startDate, shift: '白班' as Shift };
    const unscheduled = working
      .filter((c) => c.cabinetId === cabinetId && !c.hidden && c.lines.length && isUnscheduled(c))
      .slice()
      .sort((a, b) => {
        const va = a.lines.reduce((s, id) => s + (opts.poolById(id)?.vol || 0), 0);
        const vb = b.lines.reduce((s, id) => s + (opts.poolById(id)?.vol || 0), 0);
        if (vb !== va) return vb - va;
        return a.id.localeCompare(b.id);
      });
    for (const c of unscheduled) {
      while (slots.has(`${cursor.date}|${cursor.shift}`)) {
        cursor = nextShiftDate(cursor.date, cursor.shift);
      }
      const i = working.findIndex((x) => x.id === c.id);
      if (i < 0) continue;
      working[i] = normalizeCabinetContent(
        {
          ...working[i]!,
          date: cursor.date,
          shift: cursor.shift,
          scheduleStatus: 'scheduled',
          status: 'scheduled',
        },
        {
          trayMaster: opts.trayMaster,
          poolById: opts.poolById,
          largeBoxVol,
          cabinet: opts.cabinets.find((cab) => cab.id === cabinetId),
        },
      );
      slots.add(`${cursor.date}|${cursor.shift}`);
      cursor = nextShiftDate(cursor.date, cursor.shift);
    }
  }

  let allTasks: CabinetTask[] = [];
  const schedules: FurnaceSchedule[] = [];
  let nextSeq = opts.nextTaskSeq || 1;
  for (const cabinetId of cabIds) {
    const built = buildTaskChain(working, cabinetId, nextSeq);
    working = built.contents;
    allTasks = allTasks.concat(built.tasks);
    schedules.push({ cabinetId, firstTaskId: built.firstTaskId });
    nextSeq = built.nextSeq;
  }

  const { loads, conflicts } = buildEntryLoads({
    furnaces: working,
    cabinets: opts.cabinets,
    processes: opts.processes,
    config: opts.config,
    poolById: opts.poolById,
    epoch: opts.epoch,
  });
  void loads;
  const overlap = conflicts.filter((c) => c.code === 'STERILIZE_OVERLAP' || c.code === 'PREHEAT_OVERLAP');
  if (opts.scheduleMode !== 'manual' && overlap.length) {
    return {
      ok: false,
      aborted: true,
      contents: previous,
      tasks: [],
      schedules: [],
      issues: overlap,
      message: '自动模式下进炉排序导致时段重叠，已拒绝写回',
    };
  }

  return {
    ok: true,
    aborted: false,
    contents: working,
    tasks: allTasks,
    schedules,
    issues: conflicts,
    message: overlap.length ? '已写回上线日期/班次（存在重叠，手工预警）' : '已同步进炉顺序并写回上线日期/班次',
  };
}

export function tasksForContent(tasks: CabinetTask[], contentId: string): CabinetTask | undefined {
  return tasks.find((t) => t.contentId === contentId);
}
