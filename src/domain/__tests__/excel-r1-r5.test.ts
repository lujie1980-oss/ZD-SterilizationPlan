/**
 * Excel as-is 样例 R1–R5 逻辑等价回归（BOX_LIMIT 口径 2 / 方案 v1.3）。
 *
 * 仓库内无日计划 xlsx 全文 dump，本文件按对照报告 §4 的合计数字与关键行
 * 构造逼近数据：体积/箱数/最大单箱体积/指定柜/班次与报告一致；未列出的
 * 中间行按合计倒挤。完整 Excel 逐行回放标为「静态+逻辑等价」。
 */
import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../../data/config-defaults';
import { CABINETS } from '../../data/seed-cabinets';
import { PROCESSES } from '../../data/seed-processes';
import type { FurnaceRun, RuleContext, Shift, StockLine } from '../entities';
import { furnaceBoxes, furnaceVol, largeBoxCount, needsSplit } from '../pool';
import { validateFurnace } from '../rule-engine';
import { applySplit } from '../split-wizard';

const D002_ALLOWED = PROCESSES.find((p) => p.code === 'D002')!.cabinets;
const EO_ALLOWED = PROCESSES.find((p) => p.code === 'EO通用')!.cabinets;

function stock(
  partial: Partial<StockLine> & Pick<StockLine, 'id' | 'process' | 'allowed' | 'boxes'>,
): StockLine {
  const boxes = partial.boxes;
  const vol = partial.vol ?? +(boxes * (partial.boxVol ?? 0.06)).toFixed(6);
  const boxVol = partial.boxVol ?? (boxes ? vol / boxes : 0);
  return {
    factory: '3010',
    workshop: '制造三车间',
    matType: 'N',
    ref: partial.ref ?? partial.id,
    name: partial.name ?? partial.ref ?? partial.id,
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
    vol,
  };
}

function ctx(pool: StockLine[]): RuleContext {
  const map = new Map(pool.map((p) => [p.id, p]));
  return {
    cabinets: CABINETS,
    processes: PROCESSES,
    poolById: (id) => map.get(id),
    config: defaultAppConfig(),
    sameShiftFurnaces: [],
  };
}

function furnace(
  cabinetId: string,
  lines: StockLine[],
  extra?: Partial<Pick<FurnaceRun, 'date' | 'shift' | 'id'>>,
): FurnaceRun {
  return {
    id: extra?.id ?? 'FX',
    date: extra?.date ?? '2026-07-24',
    shift: extra?.shift ?? '白班',
    cabinetId,
    lines: lines.map((l) => l.id),
  };
}

function codesOf(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

function hasCode(issues: { code: string }[], code: string): boolean {
  return issues.some((i) => i.code === code);
}

/** R1：7.24 柜9 白班 D002。8 行合计 64.251 m³ / 953 箱 / 最大单箱 0.0768。 */
function r1Lines(): StockLine[] {
  const remaining: Array<{ id: string; boxes: number; vol: number; customer: string }> = [
    { id: 'R1-3', boxes: 49, vol: 3.0, customer: 'P015' },
    { id: 'R1-4', boxes: 49, vol: 3.0, customer: 'KD002' },
    { id: 'R1-5', boxes: 49, vol: 3.0, customer: 'D002' },
    { id: 'R1-6', boxes: 49, vol: 3.0, customer: 'P015' },
    { id: 'R1-7', boxes: 49, vol: 2.8821, customer: 'KD002' },
    { id: 'R1-8', boxes: 48, vol: 2.8821, customer: 'P015' },
  ];
  return [
    stock({
      id: 'R1-1',
      ref: 'ES29105CE',
      process: 'D002',
      allowed: D002_ALLOWED,
      boxes: 389,
      vol: 25.674,
      boxVol: 25.674 / 389,
      customer: 'KD002',
    }),
    stock({
      id: 'R1-2',
      ref: 'ES15221CE',
      process: 'D002',
      allowed: D002_ALLOWED,
      boxes: 271,
      vol: 20.8128,
      boxVol: 0.0768,
      customer: 'D002',
    }),
    ...remaining.map((r) =>
      stock({
        ...r,
        process: 'D002',
        allowed: D002_ALLOWED,
        boxVol: r.vol / r.boxes,
      }),
    ),
  ];
}

/** R2：7.24 柜20 白班 D002。3 行合计 65.851 m³ / 1036 箱 / 最大单箱 0.0768。 */
function r2Lines(): StockLine[] {
  const rows: Array<{ id: string; boxes: number; vol: number }> = [
    { id: 'R2-1', boxes: 400, vol: 25 },
    { id: 'R2-2', boxes: 336, vol: 20.851 },
    { id: 'R2-3', boxes: 300, vol: 20 },
  ];
  return rows.map((r) =>
    stock({
      ...r,
      process: 'D002',
      allowed: D002_ALLOWED,
      boxVol: r.vol / r.boxes,
      customer: 'KD002',
    }),
  );
}

/** R3：7.24 柜21 夜班。10 行合计 25.852 m³ / 455 箱 / 最大单箱 0.1026。 */
function r3Lines(): StockLine[] {
  const customers = ['KD015', 'KA078', 'KP007', 'KA457', 'P391'];
  const head = stock({
    id: 'R3-1',
    process: 'EO通用',
    allowed: EO_ALLOWED,
    boxes: 20,
    boxVol: 0.1026,
    vol: 20 * 0.1026,
    customer: customers[0]!,
    planRemark: '和手套拼',
  });
  const restBoxes = 455 - 20;
  const restVol = 25.852 - head.vol;
  const rest: StockLine[] = [];
  let boxesLeft = restBoxes;
  let volLeft = restVol;
  for (let i = 0; i < 9; i++) {
    const last = i === 8;
    const boxes = last ? boxesLeft : 48;
    const vol = last ? volLeft : +(restVol / 9).toFixed(6);
    rest.push(
      stock({
        id: `R3-${i + 2}`,
        process: 'EO通用',
        allowed: EO_ALLOWED,
        boxes,
        vol,
        boxVol: vol / boxes,
        customer: customers[i % customers.length]!,
        planRemark: '和手套拼',
      }),
    );
    boxesLeft -= boxes;
    volLeft -= vol;
  }
  return [head, ...rest];
}

/** R4：7.28 柜11 夜班。炉总箱 620、大箱约 82、最大单箱 0.15576。 */
function r4Lines(): StockLine[] {
  const largeA = stock({
    id: 'R4-F367',
    ref: 'F-367',
    process: 'EO通用',
    allowed: EO_ALLOWED,
    boxes: 8,
    boxVol: 0.15576,
    customer: 'C-混拼',
  });
  const largeB = stock({
    id: 'R4-ZLG',
    ref: 'ZLG3-108S',
    process: 'EO通用',
    allowed: EO_ALLOWED,
    boxes: 74,
    boxVol: 0.14076,
    customer: 'C-混拼',
  });
  const smallVol = 57.833 - largeA.vol - largeB.vol;
  const smallBoxes = 620 - 8 - 74;
  const smallParts = [90, 90, 90, 90, 90, smallBoxes - 90 * 5];
  const smallVolEach = smallVol / smallBoxes;
  const small = smallParts.map((boxes, i) =>
    stock({
      id: `R4-S${i + 1}`,
      process: 'EO通用',
      allowed: EO_ALLOWED,
      boxes,
      vol: +(boxes * smallVolEach).toFixed(6),
      boxVol: smallVolEach,
      customer: 'C-混拼',
    }),
  );
  return [largeA, largeB, ...small];
}

function r5Parent(): StockLine {
  return stock({
    id: 'R5-PAIN3',
    ref: '痛点#3',
    name: '0.156 箱规',
    process: '手术衣',
    allowed: ['柜8'],
    boxes: 300,
    boxVol: 0.156,
    vol: +(300 * 0.156).toFixed(3),
  });
}

describe('Excel R1–R5 逻辑等价（BOX_LIMIT 口径 2）', () => {
  describe('R1 7.24 柜9 白班 D002', () => {
    const lines = r1Lines();
    const ruleCtx = ctx(lines);
    const f = furnace('柜9', lines, { date: '2026-07-24', shift: '白班' });

    it('合计逼近 Excel：8 行 / 953 箱 / 64.251 m³ / 无 ≥0.12 大箱', () => {
      expect(lines).toHaveLength(8);
      expect(furnaceBoxes(f, ruleCtx.poolById)).toBe(953);
      expect(furnaceVol(f, ruleCtx.poolById)).toBeCloseTo(64.251, 3);
      expect(Math.max(...lines.map((l) => l.boxVol))).toBeCloseTo(0.0768, 4);
      expect(largeBoxCount(lines, 0.12)).toBe(0);
    });

    it('无 CABINET_MISMATCH / D002_MIN / BOX_LIMIT', () => {
      const issues = validateFurnace(f, ruleCtx);
      expect(hasCode(issues, 'CABINET_MISMATCH')).toBe(false);
      expect(hasCode(issues, 'D002_MIN')).toBe(false);
      expect(hasCode(issues, 'BOX_LIMIT')).toBe(false);
      expect(issues.filter((i) => i.sev === 'error')).toEqual([]);
    });
  });

  describe('R2 7.24 柜20 白班 D002', () => {
    const lines = r2Lines();
    const ruleCtx = ctx(lines);

    it('合计逼近 Excel：3 行 / 1036 箱 / 65.851 m³ / 无大箱', () => {
      const f = furnace('柜20', lines);
      expect(lines).toHaveLength(3);
      expect(furnaceBoxes(f, ruleCtx.poolById)).toBe(1036);
      expect(furnaceVol(f, ruleCtx.poolById)).toBeCloseTo(65.851, 3);
      expect(Math.max(...lines.map((l) => l.boxVol))).toBeLessThan(0.12);
    });

    it('指定柜20 通过：无 CABINET_MISMATCH / D002_MIN / BOX_LIMIT', () => {
      const issues = validateFurnace(furnace('柜20', lines), ruleCtx);
      expect(hasCode(issues, 'CABINET_MISMATCH')).toBe(false);
      expect(hasCode(issues, 'D002_MIN')).toBe(false);
      expect(hasCode(issues, 'BOX_LIMIT')).toBe(false);
      expect(issues.filter((i) => i.sev === 'error')).toEqual([]);
    });

    it('误分柜11 → CABINET_MISMATCH error', () => {
      const issues = validateFurnace(furnace('柜11', lines), ruleCtx);
      expect(issues.some((i) => i.code === 'CABINET_MISMATCH' && i.sev === 'error')).toBe(true);
    });
  });

  describe('R3 7.24 柜21 夜班 低拼载', () => {
    const lines = r3Lines();
    const ruleCtx = ctx(lines);
    const f = furnace('柜21', lines, { date: '2026-07-24', shift: '夜班' as Shift });

    it('合计逼近 Excel：10 行 / 455 箱 / 25.852 m³ / 最大单箱 0.1026', () => {
      expect(lines).toHaveLength(10);
      expect(furnaceBoxes(f, ruleCtx.poolById)).toBe(455);
      expect(furnaceVol(f, ruleCtx.poolById)).toBeCloseTo(25.852, 3);
      expect(Math.max(...lines.map((l) => l.boxVol))).toBeCloseTo(0.1026, 4);
      expect(largeBoxCount(lines, 0.12)).toBe(0);
      expect(EO_ALLOWED).toContain('柜21');
    });

    it('TARGET_MIN warning 可有；CAB21 info；不应 BOX_LIMIT / CABINET_MISMATCH', () => {
      const issues = validateFurnace(f, ruleCtx);
      const target = issues.find((i) => i.code === 'TARGET_MIN');
      expect(target?.sev).toBe('warning');
      expect(issues.some((i) => i.code === 'CAB21' && i.sev === 'info')).toBe(true);
      expect(hasCode(issues, 'BOX_LIMIT')).toBe(false);
      expect(hasCode(issues, 'CABINET_MISMATCH')).toBe(false);
      expect(issues.filter((i) => i.sev === 'error')).toEqual([]);
      expect(codesOf(issues)).toEqual(expect.arrayContaining(['TARGET_MIN', 'CAB21']));
    });
  });

  describe('R4 7.28 柜11 夜班 大箱混拼（口径 2 门禁）', () => {
    const lines = r4Lines();
    const ruleCtx = ctx(lines);
    const f = furnace('柜11', lines, { date: '2026-07-28', shift: '夜班' });

    it('合计逼近 Excel：炉总箱 620、大箱 82、体积 57.833、最大单箱 0.15576', () => {
      expect(lines).toHaveLength(8);
      expect(furnaceBoxes(f, ruleCtx.poolById)).toBe(620);
      expect(furnaceVol(f, ruleCtx.poolById)).toBeCloseTo(57.833, 3);
      expect(largeBoxCount(lines, 0.12)).toBe(82);
      expect(Math.max(...lines.map((l) => l.boxVol))).toBeCloseTo(0.15576, 5);
      const f367 = lines.find((l) => l.ref === 'F-367');
      const zlg = lines.find((l) => l.ref === 'ZLG3-108S');
      expect(f367?.boxes).toBe(8);
      expect(zlg?.boxes).toBe(74);
    });

    it('口径2：炉总箱 620>280 但大箱 82≤280 → 不触发 BOX_LIMIT', () => {
      const issues = validateFurnace(f, ruleCtx);
      expect(hasCode(issues, 'BOX_LIMIT')).toBe(false);
      expect(issues.filter((i) => i.code === 'BOX_LIMIT' && i.sev === 'error')).toEqual([]);
    });

    it('可有 TARGET_MIN warning（57.833<60）；无指定柜硬错误', () => {
      const issues = validateFurnace(f, ruleCtx);
      const target = issues.find((i) => i.code === 'TARGET_MIN');
      expect(target?.sev).toBe('warning');
      expect(hasCode(issues, 'CABINET_MISMATCH')).toBe(false);
    });

    it('对照负例：仅当大箱合计>280 才 BOX_LIMIT（文案为大箱数而非炉总箱）', () => {
      const bumped = lines.map((l) =>
        l.ref === 'ZLG3-108S' ? { ...l, boxes: 74 + (281 - 82), vol: (74 + (281 - 82)) * l.boxVol } : l,
      );
      expect(largeBoxCount(bumped, 0.12)).toBe(281);
      expect(furnaceBoxes(furnace('柜11', bumped), ctx(bumped).poolById)).toBeGreaterThan(281);
      const issues = validateFurnace(furnace('柜11', bumped), ctx(bumped));
      const hit = issues.find((i) => i.code === 'BOX_LIMIT');
      expect(hit?.sev).toBe('error');
      expect(hit?.msg).toContain('281');
      expect(hit?.msg).not.toMatch(/合计 6\d{2} 箱/);
    });
  });

  describe('R5 痛点#3 拆炉 300箱×0.156', () => {
    const parent = r5Parent();
    const cfg = defaultAppConfig();

    it('单行 300×0.156≈46.8m³ 标记需拆炉（大箱箱数>280，非炉总箱口径）', () => {
      expect(parent.vol).toBeCloseTo(46.8, 1);
      expect(parent.boxes * parent.boxVol).toBeCloseTo(46.8, 1);
      expect(needsSplit(parent, cfg)).toBe(true);
    });

    it('未拆整炉装入 → BOX_LIMIT error（大箱合计 300>280）', () => {
      const issues = validateFurnace(furnace('柜8', [parent]), ctx([parent]));
      const hit = issues.find((i) => i.code === 'BOX_LIMIT');
      expect(hit?.sev).toBe('error');
      expect(hit?.msg).toContain('300');
    });

    it('拆为两段后单段不再 oversized/需拆炉，且不报 BOX_LIMIT', () => {
      const result = applySplit({
        parent,
        boxesA: 150,
        cabinetId: '柜8',
        date: '2026-07-24',
        shift: '白班',
        nextSeq: 1,
      });
      expect(result.rowA.boxes).toBe(150);
      expect(result.rowB.boxes).toBe(150);
      expect(result.rowA.oversized).toBe(false);
      expect(result.rowB.oversized).toBe(false);
      expect(needsSplit(result.rowA, cfg)).toBe(false);
      expect(needsSplit(result.rowB, cfg)).toBe(false);

      const pool = [parent, result.rowA, result.rowB];
      const visible = result.furnaces.filter((x) => !x.hidden);
      expect(visible).toHaveLength(2);
      for (const f of visible) {
        const issues = validateFurnace(f, ctx(pool));
        expect(hasCode(issues, 'BOX_LIMIT')).toBe(false);
      }
    });
  });
});
