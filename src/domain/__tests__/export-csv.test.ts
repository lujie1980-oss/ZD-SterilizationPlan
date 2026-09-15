import { describe, expect, it } from 'vitest';
import { CABINETS } from '../../data/seed-cabinets';
import { CSV_HEADERS } from '../../data/config-defaults';
import { buildDayPlanCsv, csvHasBom } from '../export-csv';
import type { FurnaceRun, StockLine } from '../entities';

describe('export-csv', () => {
  const line: StockLine = {
    id: 'P001',
    factory: '3010',
    workshop: 'w',
    matType: 'N',
    ref: 'REF-D002-A01',
    name: 'D002 敷料包 A型',
    customer: 'C-华润',
    due: '2026-07-26',
    wo: 'WO-3010-78421',
    boxes: 280,
    boxVol: 0.1,
    vol: 28,
    batch: 'B2026071801',
    loc: '待灭菌仓·老',
    stockStatus: '非限制',
    process: 'D002',
    allowed: ['柜9'],
    urgent: true,
    sterilizationMethod: 'EO',
  };

  const furnaces: FurnaceRun[] = [
    { id: 'F1', cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P001'] },
  ];

  it('emits UTF-8 BOM, required columns, quoted name, and Y/N urgency', () => {
    const csv = buildDayPlanCsv({
      date: '2026-07-24',
      shift: '白班',
      furnaces,
      cabinets: CABINETS,
      poolById: (id) => (id === 'P001' ? line : undefined),
    });
    expect(csv.filename).toBe('日计划_2026-07-24_白班.csv');
    expect(csvHasBom(csv.content)).toBe(true);
    const body = csv.content.replace(/^\ufeff/, '');
    const header = body.split('\n')[0];
    expect(header).toBe(CSV_HEADERS.join(','));
    expect(body).toContain('"D002 敷料包 A型"');
    expect(body).toContain(',Y');
    expect(csv.rowCount).toBe(1);
  });
});
