import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { CABINETS } from '../../data/seed-cabinets';
import { createSeedPool } from '../../data/seed-pool';
import { PROCESSES } from '../../data/seed-processes';
import { assignedIds } from '../pool';
import { setProcessMinLoad } from '../min-load';
import type { AppConfig, FurnaceRun, RuleContext, StockLine } from '../entities';
import {
  applyAssign,
  applyChangeCabinet,
  cloneFurnaces,
  commitSuggestCombine,
  decideCommit,
  filterAndSortIssues,
} from '../commit-gate';
import { validateFurnace } from '../rule-engine';

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

function furnace(partial: Partial<FurnaceRun> & Pick<FurnaceRun, 'cabinetId' | 'lines'>): FurnaceRun {
  return {
    id: 'F1',
    date: '2026-07-24',
    shift: '白班',
    ...partial,
  };
}

function withMode(mode: AppConfig['scheduleMode'], extra?: Partial<AppConfig>): AppConfig {
  return { ...defaultAppConfig(), ...extra, scheduleMode: mode };
}

describe('commit gate (REQ-2.5)', () => {
  it('A-AUTO-01: auto rejects D002 on a non-allowed cabinet and does not persist the line', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'], name: 'D002 包' });
    const empty = furnace({ cabinetId: '柜8', lines: [] });
    const next = applyAssign([empty], 'F1', ['P001']);
    const decision = decideCommit({
      previous: [empty],
      next,
      config: withMode('auto'),
      ctx: ctx([l], { sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(decision.aborted).toBe(true);
    expect(decision.ok).toBe(false);
    expect(decision.issues.some((i) => i.code === 'CABINET_MISMATCH' && i.sev === 'error')).toBe(true);
    expect(decision.persisted).toEqual([empty]);
    expect(decision.persisted[0]!.lines).toEqual([]);
    expect(decision.persisted[0]!.manualViolation).toBeFalsy();
  });

  it('A-AUTO-02: auto rejects BOX_LIMIT when large-box count > 280 (口径2)', () => {
    const { largeBoxVol, maxBoxesWhenLarge } = defaultAppConfig().box;
    const l = line({
      id: 'Pbig',
      process: '手术衣',
      allowed: ['柜8'],
      boxes: maxBoxesWhenLarge + 1,
      boxVol: largeBoxVol,
    });
    const empty = furnace({ cabinetId: '柜8', lines: [] });
    const next = applyAssign([empty], 'F1', ['Pbig']);
    const decision = decideCommit({
      previous: [empty],
      next,
      config: withMode('auto'),
      ctx: ctx([l], { sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(decision.aborted).toBe(true);
    expect(decision.issues.some((i) => i.code === 'BOX_LIMIT')).toBe(true);
    expect(decision.persisted[0]!.lines).toEqual([]);
  });

  it('A-AUTO-03: auto allows legal D002 → 柜9', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'], boxes: 280, boxVol: 0.1, vol: 28 });
    const empty = furnace({ cabinetId: '柜9', lines: [] });
    const next = applyAssign([empty], 'F1', ['P001']);
    const decision = decideCommit({
      previous: [empty],
      next,
      config: withMode('auto'),
      ctx: ctx([l], { sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(decision.aborted).toBe(false);
    expect(decision.ok).toBe(true);
    expect(decision.persisted[0]!.lines).toEqual(['P001']);
    expect(decision.persisted[0]!.manualViolation).toBeFalsy();
  });

  it('A-AUTO-04: auto reject of a bad append leaves the existing legal furnace intact', () => {
    const good = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'] });
    const bad = line({ id: 'P013', process: '手术衣', allowed: ['柜8'] });
    const existing = furnace({ cabinetId: '柜9', lines: ['P001'] });
    const next = applyAssign([existing], 'F1', ['P013']);
    const decision = decideCommit({
      previous: [existing],
      next,
      config: withMode('auto'),
      ctx: ctx([good, bad], { sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(decision.aborted).toBe(true);
    expect(decision.persisted).toEqual([existing]);
    expect(decision.persisted[0]!.lines).toEqual(['P001']);
  });

  it('A-MAN-01: manual persists illegal cabinet load and marks 手工违例', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'], name: 'D002 包' });
    const empty = furnace({ cabinetId: '柜8', lines: [] });
    const next = applyAssign([empty], 'F1', ['P001']);
    const decision = decideCommit({
      previous: [empty],
      next,
      config: withMode('manual'),
      ctx: ctx([l], { sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(decision.aborted).toBe(false);
    expect(decision.ok).toBe(true);
    expect(decision.persisted[0]!.lines).toEqual(['P001']);
    expect(decision.persisted[0]!.manualViolation).toBe(true);
    expect(decision.needsOverridePrompt).toBe(true);
    expect(decision.issues.some((i) => i.sev === 'error' && i.code === 'CABINET_MISMATCH')).toBe(true);
  });

  it('A-MAN-02: empty override note does not block manual save', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'] });
    const empty = furnace({ cabinetId: '柜8', lines: [] });
    const next = applyAssign([empty], 'F1', ['P001']);
    const config = withMode('manual', { overrideNotes: {} });
    const decision = decideCommit({
      previous: [empty],
      next,
      config,
      ctx: ctx([l], { config, sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(decision.aborted).toBe(false);
    expect(decision.ok).toBe(true);
  });

  it('change cabinet is gated the same way as assign', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'] });
    const existing = furnace({ cabinetId: '柜9', lines: ['P001'] });
    const next = applyChangeCabinet([existing], 'F1', '柜8');
    const auto = decideCommit({
      previous: [existing],
      next,
      config: withMode('auto'),
      ctx: ctx([l], { sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(auto.aborted).toBe(true);
    expect(auto.persisted[0]!.cabinetId).toBe('柜9');

    const manual = decideCommit({
      previous: [existing],
      next,
      config: withMode('manual'),
      ctx: ctx([l], { sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(manual.aborted).toBe(false);
    expect(manual.persisted[0]!.cabinetId).toBe('柜8');
    expect(manual.persisted[0]!.manualViolation).toBe(true);
  });

  it('A-SUG-01: 建议拼炉 is always auto — error rolls back even in manual UI mode', () => {
    const pool = [
      line({ id: 'D1', process: 'D002', allowed: ['柜20'], boxes: 200, boxVol: 0.1, vol: 20 }),
      line({ id: 'D2', process: 'D002', allowed: ['柜20'], boxes: 200, boxVol: 0.1, vol: 20 }),
    ];
    const previous: FurnaceRun[] = [];
    const result = commitSuggestCombine({
      pool,
      furnaces: previous,
      assigned: new Set(),
      date: '2026-07-24',
      shift: '白班',
      nextSeq: 1,
      minLoad: 56,
      poolById: (id) => pool.find((p) => p.id === id),
      config: withMode('manual'),
      cabinets: CABINETS,
      processes: PROCESSES,
    });
    expect(result.aborted).toBe(true);
    expect(result.persisted).toEqual([]);
    expect(result.issues.some((i) => i.code === 'CABINET_MISMATCH')).toBe(true);
  });

  it('A-SUG-02: legal D002 建议拼炉 writes when there is no error', () => {
    const pool = createSeedPool();
    const result = commitSuggestCombine({
      pool,
      furnaces: [],
      assigned: new Set(),
      date: '2026-07-24',
      shift: '白班',
      nextSeq: 1,
      minLoad: 56,
      poolById: (id) => pool.find((p) => p.id === id),
      config: withMode('manual'),
      cabinets: CABINETS,
      processes: PROCESSES,
    });
    expect(result.aborted).toBe(false);
    expect(result.ok).toBe(true);
    const f = result.persisted.find((x) => x.cabinetId === '柜9');
    expect(f?.lines.length).toBeGreaterThanOrEqual(2);
    expect(result.issues.some((i) => i.sev === 'error')).toBe(false);
  });

  it('suggest combine does not mutate the caller furnace list on abort', () => {
    const pool = [
      line({ id: 'D1', process: 'D002', allowed: ['柜20'], boxes: 200, boxVol: 0.1, vol: 20 }),
      line({ id: 'D2', process: 'D002', allowed: ['柜20'], boxes: 200, boxVol: 0.1, vol: 20 }),
    ];
    const existing = furnace({ id: 'F9', cabinetId: '柜9', lines: [] });
    const previous = [existing];
    const snapshot = JSON.stringify(previous);
    commitSuggestCombine({
      pool,
      furnaces: previous,
      assigned: assignedIds(previous),
      date: '2026-07-24',
      shift: '白班',
      nextSeq: 2,
      minLoad: 56,
      poolById: (id) => pool.find((p) => p.id === id),
      config: withMode('auto'),
      cabinets: CABINETS,
      processes: PROCESSES,
    });
    expect(JSON.stringify(previous)).toBe(snapshot);
    expect(existing.lines).toEqual([]);
  });

  it('A-MAN-04: 仅手工违例 filter pins those furnace issues', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'] });
    const viol = furnace({ cabinetId: '柜8', lines: ['P001'], manualViolation: true });
    const ok = furnace({ id: 'F2', cabinetId: '柜9', lines: [] });
    const issues = [
      ...validateFurnace(viol, ctx([l], { sameShiftFurnaces: [viol, ok] })),
      { sev: 'warning' as const, code: 'D002_MIN', msg: 'soft', furnaceId: 'F2' },
    ];
    const onlyManual = filterAndSortIssues(issues, [viol, ok], 'manual');
    expect(onlyManual.length).toBeGreaterThan(0);
    expect(onlyManual.every((i) => i.furnaceId === 'F1')).toBe(true);
    const errors = filterAndSortIssues(issues, [viol, ok], 'error');
    expect(errors.every((i) => i.sev === 'error')).toBe(true);
  });

  it('A-REG-01: 口径2 mixed load is not a BOX_LIMIT error, so auto may persist', () => {
    const { largeBoxVol, maxBoxesWhenLarge } = defaultAppConfig().box;
    const large = line({
      id: 'L',
      process: '手术衣',
      allowed: ['柜8'],
      boxes: maxBoxesWhenLarge,
      boxVol: largeBoxVol,
    });
    const small = line({
      id: 'S',
      process: '手术衣',
      allowed: ['柜8'],
      boxes: 420,
      boxVol: 0.1,
    });
    const empty = furnace({ cabinetId: '柜8', lines: [] });
    const next = applyAssign([empty], 'F1', ['L', 'S']);
    const decision = decideCommit({
      previous: [empty],
      next,
      config: withMode('auto'),
      ctx: ctx([large, small], { sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(decision.issues.some((i) => i.code === 'BOX_LIMIT')).toBe(false);
    expect(decision.aborted).toBe(false);
    expect(decision.persisted[0]!.lines).toEqual(['L', 'S']);
  });

  it('A-REG-02: D002_MIN is warning so auto persist is allowed; threshold follows config', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9'], boxes: 400, boxVol: 0.1, vol: 40 });
    const empty = furnace({ cabinetId: '柜9', lines: [] });
    const next = applyAssign([empty], 'F1', ['P001']);
    const cfg = setProcessMinLoad(withMode('auto'), 'D002', 30);
    const decision = decideCommit({
      previous: [empty],
      next,
      config: cfg,
      ctx: ctx([l], { config: cfg, sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    expect(decision.aborted).toBe(false);
    expect(decision.issues.some((i) => i.code === 'D002_MIN')).toBe(false);
  });

  it('cloneFurnaces is a deep copy of lines so suggest/assign cannot leak', () => {
    const original = furnace({ cabinetId: '柜9', lines: ['P001'] });
    const cloned = cloneFurnaces([original]);
    cloned[0]!.lines.push('P002');
    cloned[0]!.cabinetId = '柜8';
    expect(original.lines).toEqual(['P001']);
    expect(original.cabinetId).toBe('柜9');
  });

  it('stamps scheduleModeAtDetect and blocking on auto errors', () => {
    const l = line({ id: 'P001', process: 'D002', allowed: ['柜9', '柜20'] });
    const empty = furnace({ cabinetId: '柜8', lines: [] });
    const next = applyAssign([empty], 'F1', ['P001']);
    const decision = decideCommit({
      previous: [empty],
      next,
      config: withMode('auto'),
      ctx: ctx([l], { sameShiftFurnaces: next }),
      editSource: 'manual',
    });
    const err = decision.issues.find((i) => i.sev === 'error');
    expect(err?.scheduleModeAtDetect).toBe('auto');
    expect(err?.blocking).toBe(true);
  });
});
