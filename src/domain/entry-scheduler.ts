import { aerateInfo } from '../data/seed-processes';
import type { AppConfig, Cabinet, EntryLoad, FurnaceRun, Process, StockLine, ValidationIssue } from './entities';
import { ISSUE_CODES } from './entities';
import { addDays, dayOffset, shiftRank } from './dates';
import { furnaceBoxes, furnaceCustomers, furnaceVol } from './pool';

export function sortFurnaceRunsForEntry(
  list: FurnaceRun[],
  poolById: (id: string) => StockLine | undefined,
): FurnaceRun[] {
  return list.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (shiftRank(a.shift) !== shiftRank(b.shift)) return shiftRank(a.shift) - shiftRank(b.shift);
    const va = furnaceVol(a, poolById);
    const vb = furnaceVol(b, poolById);
    if (vb !== va) return vb - va;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function schedulePhases(run: FurnaceRun, processCode: string, cfg: AppConfig, processes: Process[]) {
  const aer = aerateInfo(processCode, processes);
  let sterilizeStart: Date;
  let preheat: { start: Date; end: Date } | null;
  if (run.shift === '夜班') {
    sterilizeStart = addDays(run.date, cfg.cycle.nightSterilizeOffsetDays);
    preheat = { start: addDays(run.date, 0), end: sterilizeStart };
  } else {
    preheat = { start: addDays(run.date, -cfg.cycle.preheatDays), end: addDays(run.date, 0) };
    sterilizeStart = addDays(run.date, 0);
  }
  const sterilizeEnd = addDays(sterilizeStart, cfg.cycle.sterilizeDays);
  const aerateEnd = addDays(sterilizeEnd, aer.days);
  const biEnd = addDays(aerateEnd, cfg.cycle.biDays);
  return {
    preheat,
    sterilize: { start: sterilizeStart, end: sterilizeEnd },
    aerate: { start: sterilizeEnd, end: aerateEnd, days: aer.days, pending: aer.pending },
    bi: { start: aerateEnd, end: biEnd },
  };
}

function intervalsOverlap(
  a: { start: Date | string; end: Date | string },
  b: { start: Date | string; end: Date | string },
  epoch: string,
): boolean {
  const a0 = dayOffset(epoch, a.start);
  const a1 = dayOffset(epoch, a.end);
  const b0 = dayOffset(epoch, b.start);
  const b1 = dayOffset(epoch, b.end);
  return a0 < b1 && b0 < a1;
}

export function detectEntryConflicts(loads: EntryLoad[], epoch: string): ValidationIssue[] {
  const conflicts: ValidationIssue[] = [];
  const byCab = new Map<string, EntryLoad[]>();
  for (const load of loads) {
    if (!byCab.has(load.cabinetId)) byCab.set(load.cabinetId, []);
    byCab.get(load.cabinetId)!.push(load);
  }
  for (const [cabinetId, cabLoads] of byCab) {
    for (let i = 0; i < cabLoads.length; i++) {
      for (let j = i + 1; j < cabLoads.length; j++) {
        const li = cabLoads[i]!;
        const lj = cabLoads[j]!;
        if (intervalsOverlap(li.phases.sterilize, lj.phases.sterilize, epoch)) {
          li.conflict = true;
          lj.conflict = true;
          conflicts.push({
            sev: 'warning',
            code: ISSUE_CODES.STERILIZE_OVERLAP,
            msg: `${cabinetId} 炉次 ${li.furnaceId}（序${li.seq}）与 ${lj.furnaceId}（序${lj.seq}）进炉/灭菌时段重叠`,
            cabinetId,
            furnaceId: li.furnaceId,
          });
        }
        const pa = li.phases.preheat;
        const pb = lj.phases.preheat;
        if (pa && pb && intervalsOverlap(pa, pb, epoch)) {
          li.conflict = true;
          lj.conflict = true;
          conflicts.push({
            sev: 'warning',
            code: ISSUE_CODES.PREHEAT_OVERLAP,
            msg: `${cabinetId} 预热时段重叠：${li.furnaceId} / ${lj.furnaceId}（同柜白夜班不可重叠预热）`,
            cabinetId,
            furnaceId: li.furnaceId,
            pendingFlag: true,
          });
        }
      }
    }
  }
  return conflicts;
}

export function buildEntryLoads(opts: {
  furnaces: FurnaceRun[];
  cabinets: Cabinet[];
  processes: Process[];
  config: AppConfig;
  poolById: (id: string) => StockLine | undefined;
  epoch: string;
}): { loads: EntryLoad[]; conflicts: ValidationIssue[] } {
  const { furnaces, cabinets, processes, config, poolById, epoch } = opts;
  const visible = furnaces.filter((f) => !f.hidden && f.lines && f.lines.length);
  const byCab = new Map<string, FurnaceRun[]>();
  visible.forEach((f) => {
    if (!byCab.has(f.cabinetId)) byCab.set(f.cabinetId, []);
    byCab.get(f.cabinetId)!.push(f);
  });

  const loads: EntryLoad[] = [];
  for (const [cabinetId, list] of byCab) {
    const sorted = sortFurnaceRunsForEntry(list, poolById);
    sorted.forEach((f, idx) => {
      const lines = f.lines.map(poolById).filter((l): l is StockLine => Boolean(l));
      const primary = lines[0];
      const process = primary?.process || 'EO通用';
      const aer = aerateInfo(process, processes);
      const pendingNotes: string[] = [];
      if (aer.pending) pendingNotes.push(`解析天数示意 ${aer.days}d · 待确认`);
      if (cabinetId === '柜21') pendingNotes.push('柜21 主数据待确认');
      if (processes.find((p) => p.code === process)?.pending) pendingNotes.push(`工艺「${process}」规则待确认`);
      const customers = furnaceCustomers(f, poolById);
      loads.push({
        furnaceId: f.id,
        cabinetId,
        seq: idx + 1,
        date: f.date,
        shift: f.shift,
        process,
        customer: customers[0] || '—',
        customers,
        vol: furnaceVol(f, poolById),
        boxes: furnaceBoxes(f, poolById),
        lineIds: f.lines.slice(),
        lineNames: lines.map((l) => l.name),
        pending: aer.pending || cabinetId === '柜21',
        pendingNotes,
        phases: schedulePhases(f, process, config, processes),
        conflict: false,
      });
    });
  }

  const conflicts = detectEntryConflicts(loads, epoch);
  const cabOrder = cabinets.map((c) => c.id);
  loads.sort((a, b) => {
    const ia = cabOrder.indexOf(a.cabinetId);
    const ib = cabOrder.indexOf(b.cabinetId);
    if (ia !== ib) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    return a.seq - b.seq;
  });
  return { loads, conflicts };
}
