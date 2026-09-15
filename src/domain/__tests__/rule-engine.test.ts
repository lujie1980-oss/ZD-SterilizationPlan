import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { CABINETS } from '../../data/seed-cabinets';
import { PROCESSES } from '../../data/seed-processes';
import type { FurnaceRun, RuleContext, StockLine } from '../entities';
import { canAddFurnace, validateAll, validateFurnace } from '../rule-engine';

function line(partial: Partial<StockLine> & Pick<StockLine, 'id' | 'process' | 'allowed'>): StockLine {
  const boxes = partial.boxes ?? 10;
  const boxVol = partial.boxVol ?? 0.1;
  const base: StockLine = {
    id: partial.id,
    factory: '3010',
    workshop: '制造三车间',
    matType: 'N',
    ref: 'REF',
    name: '样例',
    customer: 'C-A',
    due: '2026-07-26',
    wo: 'WO-1',
    boxes,
    boxVol,
    vol: +(boxes * boxVol).toFixed(2),
    batch: 'B',
    loc: '待灭菌仓·老',
    stockStatus: '非限制',
    process: partial.process,
    allowed: partial.allowed,
    urgent: false,
    sterilizationMethod: 'EO',
  };
  const merged = { ...base, ...partial };
  if (partial.vol == null) merged.vol = +(merged.boxes * merged.boxVol).toFixed(2);
  return merged;
}

function ctx(pool: StockLine[], extra?: Partial<RuleContext>): RuleContext {
  const map = new Map(pool.map((p) => [p.id, p]));
  const config = extra?.config ?? defaultAppConfig();
  return {
    cabinets: extra?.cabinets ?? CABINETS,
    processes: extra?.processes ?? PROCESSES,
    poolById: extra?.poolById ?? ((id) => map.get(id)),
    config,
    sameShiftFurnaces: extra?.sameShiftFurnaces ?? [],
  };
}

function run(partial: Partial<FurnaceRun> & Pick<FurnaceRun, 'cabinetId' | 'lines'>): FurnaceRun {
  return {
    id: 'F1',
    date: '2026-07-24',
    shift: '白班',
    ...partial,
  };
}

describe('rule-engine', () => {
  it('rejects scrapped cabinets when adding a furnace', () => {
    const result = canAddFurnace('柜1', ctx([]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('CABINET_SCRAPPED');
  });

  it('allows pending cabinet 21 to be used', () => {
    expect(canAddFurnace('柜21', ctx([])).ok).toBe(true);
  });

  it('emits CABINET_MISMATCH when D002 is loaded into a non-allowed cabinet', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'], name: 'D002 包' });
    const issues = validateFurnace(run({ cabinetId: '柜8', lines: ['P001'] }), ctx([l]));
    expect(issues.some((i) => i.code === 'CABINET_MISMATCH' && i.sev === 'error')).toBe(true);
  });

  it('clears CABINET_MISMATCH when D002 is on cabinet 9', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'] });
    const issues = validateFurnace(run({ cabinetId: '柜9', lines: ['P001'] }), ctx([l]));
    expect(issues.some((i) => i.code === 'CABINET_MISMATCH')).toBe(false);
  });

  it('emits CABINET_MISMATCH for Z051 off cabinet 16', () => {
    const l = line({ id: 'P005', process: 'Z051', allowed: ['柜16'] });
    const issues = validateFurnace(run({ cabinetId: '柜9', lines: ['P005'] }), ctx([l]));
    expect(issues.some((i) => i.code === 'CABINET_MISMATCH')).toBe(true);
  });

  it('emits BOX_LIMIT error when large boxes exceed 280', () => {
    const l = line({
      id: 'Pbig',
      process: '手术衣',
      allowed: ['柜8'],
      boxes: 281,
      boxVol: 0.12,
      name: '大箱',
    });
    const issues = validateFurnace(run({ cabinetId: '柜8', lines: ['Pbig'] }), ctx([l]));
    const hit = issues.find((i) => i.code === 'BOX_LIMIT');
    expect(hit?.sev).toBe('error');
  });

  it('does not emit BOX_LIMIT at the 280 boundary', () => {
    const l = line({
      id: 'Pedge',
      process: '手术衣',
      allowed: ['柜8'],
      boxes: 280,
      boxVol: 0.12,
    });
    const issues = validateFurnace(run({ cabinetId: '柜8', lines: ['Pedge'] }), ctx([l]));
    expect(issues.some((i) => i.code === 'BOX_LIMIT')).toBe(false);
  });

  it('emits D002_MIN warning below 56 m³', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9'], boxes: 100, boxVol: 0.1, vol: 10 });
    const issues = validateFurnace(run({ cabinetId: '柜9', lines: ['P001'] }), ctx([l]));
    expect(issues.some((i) => i.code === 'D002_MIN' && i.sev === 'warning')).toBe(true);
  });

  it('emits TARGET_MIN with filler copy when allowFiller is off', () => {
    const l = line({ id: 'P013', process: '手术衣', allowed: ['柜8'], boxes: 10, boxVol: 0.1, vol: 1 });
    const issues = validateFurnace(run({ cabinetId: '柜8', lines: ['P013'] }), ctx([l]));
    const hit = issues.find((i) => i.code === 'TARGET_MIN');
    expect(hit?.sev).toBe('warning');
    expect(hit?.msg).toContain('待确认：是否允许填充物');
  });

  it('changes TARGET_MIN copy when allowFiller is on', () => {
    const l = line({ id: 'P013', process: '手术衣', allowed: ['柜8'], boxes: 10, boxVol: 0.1, vol: 1 });
    const config = defaultAppConfig();
    config.allowFiller = true;
    const issues = validateFurnace(run({ cabinetId: '柜8', lines: ['P013'] }), ctx([l], { config }));
    expect(issues.find((i) => i.code === 'TARGET_MIN')?.msg).toContain('已开启填充物开关');
  });

  it('emits MIX_CUSTOMER when mixCustomerWarn is on', () => {
    const a = line({ id: 'A', process: 'D002', allowed: ['柜9'], customer: 'C-华润', vol: 30, boxes: 300, boxVol: 0.1 });
    const b = line({ id: 'B', process: 'D002', allowed: ['柜9'], customer: 'C-国药', vol: 30, boxes: 300, boxVol: 0.1 });
    const f = run({ cabinetId: '柜9', lines: ['A', 'B'] });
    const issues = validateFurnace(f, ctx([a, b]));
    expect(issues.some((i) => i.code === 'MIX_CUSTOMER' && i.sev === 'warning')).toBe(true);
  });

  it('does not emit MIX_CUSTOMER when the switch is off', () => {
    const a = line({ id: 'A', process: 'D002', allowed: ['柜9'], customer: 'C-华润', vol: 30, boxes: 300, boxVol: 0.1 });
    const b = line({ id: 'B', process: 'D002', allowed: ['柜9'], customer: 'C-国药', vol: 30, boxes: 300, boxVol: 0.1 });
    const config = defaultAppConfig();
    config.mixCustomerWarn = false;
    const issues = validateFurnace(run({ cabinetId: '柜9', lines: ['A', 'B'] }), ctx([a, b], { config }));
    expect(issues.some((i) => i.code === 'MIX_CUSTOMER')).toBe(false);
  });

  it('emits OVER_CAP when volume exceeds cabinet capacity', () => {
    const l = line({ id: 'P', process: 'D002', allowed: ['柜9'], vol: 120, boxes: 1200, boxVol: 0.1 });
    const issues = validateFurnace(run({ cabinetId: '柜9', lines: ['P'] }), ctx([l]));
    expect(issues.some((i) => i.code === 'OVER_CAP')).toBe(true);
  });

  it('emits OCCUPANCY when same-shift cabinets exceed capacity together', () => {
    const a = line({ id: 'A', process: 'D002', allowed: ['柜9'], vol: 60, boxes: 600, boxVol: 0.1 });
    const b = line({ id: 'B', process: 'D002', allowed: ['柜9'], vol: 60, boxes: 600, boxVol: 0.1 });
    const f1 = run({ id: 'F1', cabinetId: '柜9', lines: ['A'] });
    const f2 = run({ id: 'F2', cabinetId: '柜9', lines: ['B'] });
    const issues = validateFurnace(f1, ctx([a, b], { sameShiftFurnaces: [f1, f2] }));
    expect(issues.some((i) => i.code === 'OCCUPANCY')).toBe(true);
  });

  it('emits CAB21 info for cabinet 21', () => {
    const l = line({
      id: 'P014',
      process: 'EO通用',
      allowed: ['柜21'],
    });
    const issues = validateFurnace(run({ cabinetId: '柜21', lines: ['P014'] }), ctx([l]));
    expect(issues.some((i) => i.code === 'CAB21' && i.sev === 'info')).toBe(true);
  });

  it('emits PROC_PENDING for 亚澳', () => {
    const l = line({ id: 'P006', process: '亚澳', allowed: ['柜12'] });
    const issues = validateFurnace(run({ cabinetId: '柜12', lines: ['P006'] }), ctx([l]));
    expect(issues.some((i) => i.code === 'PROC_PENDING' && i.sev === 'info')).toBe(true);
  });

  it('validateAll skips empty furnaces', () => {
    const empty = run({ cabinetId: '柜9', lines: [] });
    expect(validateAll([empty], ctx([]))).toEqual([]);
  });
});
