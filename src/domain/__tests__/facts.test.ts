import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { createSeedPool } from '../../data/seed-pool';
import { PROCESSES } from '../../data/seed-processes';
import { setProcessMinLoad } from '../min-load';
import type { StockLine } from '../entities';
import { deriveFacts } from '../facts';

const AS_OF = '2026-07-24';

function byId(id: string): StockLine {
  const row = createSeedPool().find((p) => p.id === id);
  if (!row) throw new Error(`missing seed ${id}`);
  return row;
}

describe('deriveFacts (REQ-2.1 / A-FACT)', () => {
  it('A-FACT-01: P001–P004 show due tone and designated-cabinet chips without validate()', () => {
    for (const id of ['P001', 'P002', 'P003', 'P004'] as const) {
      const facts = deriveFacts(byId(id), PROCESSES, defaultAppConfig(), AS_OF);
      expect(facts.dueLabel).toContain(byId(id).due);
      expect(facts.hasDesignatedCabinet).toBe(true);
      expect(facts.allowedCabinets).toEqual(byId(id).allowed);
      expect(facts.facts.some((f) => f.code === 'DESIGNATED')).toBe(true);
      expect(facts.facts.some((f) => f.code === 'NO_DESIGNATED')).toBe(false);
    }
    const p001 = deriveFacts(byId('P001'), PROCESSES, defaultAppConfig(), AS_OF);
    const p004 = deriveFacts(byId('P004'), PROCESSES, defaultAppConfig(), AS_OF);
    expect(p001.dueTone).toBe('soon');
    expect(p001.dueLabel).toMatch(/临近/);
    expect(p004.dueTone).toBe('soon');
  });

  it('A-FACT-02: D002 P001 has DESIGNATED 柜9/20 and LOAD_TARGET ≥56', () => {
    const facts = deriveFacts(byId('P001'), PROCESSES, defaultAppConfig(), AS_OF);
    const designated = facts.facts.find((f) => f.code === 'DESIGNATED');
    expect(designated?.label).toMatch(/指定柜/);
    expect(designated?.label).toContain('柜9');
    expect(designated?.label).toContain('柜20');
    const load = facts.facts.find((f) => f.code === 'LOAD_TARGET');
    expect(load?.label).toBe('D002目标≥56');
  });

  it('marks overdue when due is before asOf', () => {
    const facts = deriveFacts(byId('P004'), PROCESSES, defaultAppConfig(), '2026-07-27');
    expect(facts.dueTone).toBe('overdue');
    expect(facts.dueLabel).toMatch(/已逾期/);
    expect(facts.facts.some((f) => f.code === 'DUE_OVERDUE' && f.tone === 'danger')).toBe(true);
  });

  it('marks due as ok when more than 3 days away', () => {
    const facts = deriveFacts(byId('P003'), PROCESSES, defaultAppConfig(), AS_OF);
    expect(facts.dueTone).toBe('ok');
    expect(facts.facts.some((f) => f.code === 'DUE_SOON' || f.code === 'DUE_OVERDUE')).toBe(false);
  });

  it('A-FACT-03: BOX_LARGE chip when boxVol ≥ 0.12', () => {
    const facts = deriveFacts(byId('P004'), PROCESSES, defaultAppConfig(), AS_OF);
    const chip = facts.facts.find((f) => f.code === 'BOX_LARGE');
    expect(chip?.label).toBe('大箱·计入280');
    expect(deriveFacts(byId('P001'), PROCESSES, defaultAppConfig(), AS_OF).facts.some((f) => f.code === 'BOX_LARGE')).toBe(
      false,
    );
  });

  it('A-FACT-04: URGENT chip on rush lines', () => {
    expect(deriveFacts(byId('P001'), PROCESSES, defaultAppConfig(), AS_OF).facts.some((f) => f.code === 'URGENT')).toBe(true);
    expect(deriveFacts(byId('P002'), PROCESSES, defaultAppConfig(), AS_OF).facts.some((f) => f.code === 'URGENT')).toBe(false);
  });

  it('A-FACT-06: PENDING_ALLOW chip when pendingAllow', () => {
    const facts = deriveFacts(byId('P006'), PROCESSES, defaultAppConfig(), AS_OF);
    expect(facts.facts.some((f) => f.code === 'PENDING_ALLOW' && f.label.includes('待确认'))).toBe(true);
  });

  it('NO_DESIGNATED when allowed list is empty', () => {
    const line: StockLine = { ...byId('P001'), allowed: [] };
    const facts = deriveFacts(line, PROCESSES, defaultAppConfig(), AS_OF);
    expect(facts.hasDesignatedCabinet).toBe(false);
    expect(facts.facts.some((f) => f.code === 'NO_DESIGNATED' && f.label === '未指定柜')).toBe(true);
  });

  it('LOAD_TARGET follows config.minLoadM3ByProcess (D1 contract)', () => {
    const cfg = setProcessMinLoad(defaultAppConfig(), 'D002', 30);
    const facts = deriveFacts(byId('P001'), PROCESSES, cfg, AS_OF);
    expect(facts.facts.find((f) => f.code === 'LOAD_TARGET')?.label).toBe('D002目标≥30');
  });
});
