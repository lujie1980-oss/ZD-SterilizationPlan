import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { CABINETS } from '../../data/seed-cabinets';
import { PROCESSES } from '../../data/seed-processes';
import { addDays, dayOffset, fmtDate } from '../dates';
import { buildEntryLoads, schedulePhases, sortFurnaceRunsForEntry } from '../entry-scheduler';
import type { FurnaceRun, StockLine } from '../entities';

function line(id: string, vol: number, process = 'D002'): StockLine {
  return {
    id,
    factory: '3010',
    workshop: 'w',
    matType: 'N',
    ref: 'R',
    name: id,
    customer: 'C-A',
    due: '2026-07-26',
    wo: 'WO',
    boxes: 10,
    boxVol: vol / 10,
    vol,
    batch: 'B',
    loc: '待灭菌仓·老',
    stockStatus: '非限制',
    process,
    allowed: ['柜9', '柜20'],
    urgent: false,
    sterilizationMethod: 'EO',
  };
}

const pool = [line('P1', 40), line('P2', 80), line('P3', 40)];
const poolById = (id: string) => pool.find((p) => p.id === id);

describe('entry-scheduler', () => {
  it('sorts date asc → day before night → volume desc → furnaceId lex, then seq 1…n', () => {
    const runs: FurnaceRun[] = [
      { id: 'F9', cabinetId: '柜9', date: '2026-07-25', shift: '白班', lines: ['P1'] },
      { id: 'F2', cabinetId: '柜9', date: '2026-07-24', shift: '夜班', lines: ['P1'] },
      { id: 'F1', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P1'] },
      { id: 'Fb', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P2'] },
      { id: 'Fa', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P3'] },
    ];
    const sorted = sortFurnaceRunsForEntry(runs, poolById);
    expect(sorted.map((r) => r.id)).toEqual(['Fb', 'F1', 'Fa', 'F2', 'F9']);
    const { loads } = buildEntryLoads({
      furnaces: runs,
      cabinets: CABINETS,
      processes: PROCESSES,
      config: defaultAppConfig(),
      poolById,
      epoch: '2026-07-24',
    });
    expect(loads.map((l) => `${l.seq}:${l.furnaceId}`)).toEqual([
      '1:Fb',
      '2:F1',
      '3:Fa',
      '4:F2',
      '5:F9',
    ]);
  });

  it('schedules day-shift preheat as date-0.5d → date and sterilize 1d', () => {
    const run: FurnaceRun = { id: 'F1', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P1'] };
    const ph = schedulePhases(run, 'D002', defaultAppConfig(), PROCESSES);
    expect(fmtDate(ph.preheat!.end)).toBe('2026-07-24');
    expect(dayOffset(ph.preheat!.start, ph.preheat!.end)).toBeCloseTo(0.5);
    expect(fmtDate(ph.sterilize.start)).toBe('2026-07-24');
    expect(dayOffset(ph.sterilize.start, ph.sterilize.end)).toBeCloseTo(1);
    expect(ph.aerate.days).toBe(2);
    expect(dayOffset(ph.aerate.end, ph.bi.end)).toBeCloseTo(2);
  });

  it('staggers night-shift sterilize start by +0.5d', () => {
    const run: FurnaceRun = { id: 'F1', cabinetId: '柜9', date: '2026-07-24', shift: '夜班', lines: ['P1'] };
    const ph = schedulePhases(run, 'D002', defaultAppConfig(), PROCESSES);
    expect(dayOffset('2026-07-24', ph.sterilize.start)).toBeCloseTo(0.5);
    expect(fmtDate(ph.preheat!.start)).toBe('2026-07-24');
  });

  it('changes BI length when cycle.biDays changes', () => {
    const run: FurnaceRun = { id: 'F1', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P1'] };
    const cfg = defaultAppConfig();
    cfg.cycle.biDays = 4;
    const ph = schedulePhases(run, 'D002', cfg, PROCESSES);
    expect(dayOffset(ph.aerate.end, ph.bi.end)).toBeCloseTo(4);
  });

  it('flags STERILIZE_OVERLAP when sterilize windows intersect', () => {
    const a: FurnaceRun = { id: 'F1', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P1'] };
    const b: FurnaceRun = { id: 'F2', cabinetId: '柜9', date: '2026-07-24', shift: '夜班', lines: ['P2'] };
    const { loads, conflicts } = buildEntryLoads({
      furnaces: [a, b],
      cabinets: CABINETS,
      processes: PROCESSES,
      config: defaultAppConfig(),
      poolById,
      epoch: '2026-07-24',
    });
    expect(conflicts.some((c) => c.code === 'STERILIZE_OVERLAP')).toBe(true);
    expect(loads.every((l) => l.conflict)).toBe(true);
  });

  it('flags PREHEAT_OVERLAP when preheat windows intersect', () => {
    const cfg = defaultAppConfig();
    cfg.cycle.preheatDays = 1;
    cfg.cycle.nightSterilizeOffsetDays = 0.5;
    const a: FurnaceRun = { id: 'F1', cabinetId: '柜8', date: '2026-07-24', shift: '白班', lines: ['P1'] };
    const b: FurnaceRun = { id: 'F2', cabinetId: '柜8', date: '2026-07-23', shift: '夜班', lines: ['P2'] };
    const { conflicts } = buildEntryLoads({
      furnaces: [a, b],
      cabinets: CABINETS,
      processes: PROCESSES,
      config: cfg,
      poolById,
      epoch: '2026-07-23',
    });
    expect(conflicts.some((c) => c.code === 'PREHEAT_OVERLAP')).toBe(true);
  });

  it('uses process aerateDays for D002 = 2', () => {
    const ph = schedulePhases(
      { id: 'F1', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P1'] },
      'D002',
      defaultAppConfig(),
      PROCESSES,
    );
    expect(dayOffset(ph.sterilize.end, ph.aerate.end)).toBeCloseTo(2);
    expect(ph.aerate.pending).toBe(false);
  });

  it('marks 亚澳 aerate as pending', () => {
    const ph = schedulePhases(
      { id: 'F1', cabinetId: '柜12', date: '2026-07-24', shift: '白班', lines: ['P1'] },
      '亚澳',
      defaultAppConfig(),
      PROCESSES,
    );
    expect(ph.aerate.pending).toBe(true);
  });

  it('addDays preserves half-day ticks', () => {
    const dt = addDays('2026-07-24', 0.5);
    expect(dt.getHours()).toBe(12);
  });
});
