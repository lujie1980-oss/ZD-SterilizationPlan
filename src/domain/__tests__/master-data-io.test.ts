import { describe, expect, it } from 'vitest';
import { BOX_SPECS } from '../../data/seed-boxspecs';
import { CABINETS, TRAYS } from '../../data/seed-cabinets';
import { PROCESSES } from '../../data/seed-processes';
import type { BoxSpec, Cabinet, Process, Tray } from '../entities';
import { csvHasBom } from '../export-csv';
import {
  MASTER_HEADERS,
  applyMasterUpsert,
  parseMasterFile,
  serializeMaster,
  serializeMasterCsvString,
  templateMaster,
  validateMasterImport,
  type MasterData,
  type MasterEntity,
  type ParsedRow,
} from '../master-data-io';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function seedMaster(): MasterData {
  return {
    cabinets: clone(CABINETS),
    trays: clone(TRAYS),
    processes: clone(PROCESSES),
    boxSpecs: clone(BOX_SPECS),
    customerRules: [
      {
        customerId: 'C-华润',
        designatedCabinets: ['柜9', '柜20'],
        mixPolicy: 'warn',
        note: 'D002 指定柜',
      },
    ],
  };
}

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function csv(entity: MasterEntity, rows: string[][]): string {
  const headers = MASTER_HEADERS[entity];
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))];
  return `\ufeff${lines.join('\n')}`;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function parseOk(entity: MasterEntity, bytes: Uint8Array, format: 'csv' | 'xlsx'): ParsedRow[] {
  const parsed = parseMasterFile(entity, bytes, format);
  expect(parsed.ok, parsed.ok ? '' : parsed.error.reason).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.rows;
}

function cabinetRow(overrides: Partial<Record<string, string>> = {}): string[] {
  const headers = MASTER_HEADERS.cabinets;
  const base: Record<string, string> = {
    canonicalId: 'cab-99',
    displayCode: '柜99',
    id: '柜99',
    base: '新',
    capacity: '80',
    ratedLoadM3: '80',
    dailyCapacityM3: '80',
    status: '可用',
    maxTrayCount: '4',
    tags: '演示',
    note: '导入柜',
  };
  Object.assign(base, overrides);
  return headers.map((h) => base[h] ?? '');
}

function trayRow(overrides: Partial<Record<string, string>> = {}): string[] {
  const headers = MASTER_HEADERS.trays;
  const base: Record<string, string> = {
    id: 'cab-9-tray-99',
    cabinetId: '柜9',
    level: '9',
    displayName: '第9层托盘',
    capacityM3: '20',
    maxBoxes: '100',
    maxBoards: '8',
    status: '可用',
    note: '',
  };
  Object.assign(base, overrides);
  return headers.map((h) => base[h] ?? '');
}

function processRow(overrides: Partial<Record<string, string>> = {}): string[] {
  const headers = MASTER_HEADERS.processes;
  const base: Record<string, string> = {
    code: 'NEWP',
    name: '新工艺',
    cabinets: '柜9|柜20',
    aerateDays: '2',
    aerateConfirmed: '是',
    minLoadM3: '40',
    note: '导入工艺',
  };
  Object.assign(base, overrides);
  return headers.map((h) => base[h] ?? '');
}

function boxRow(overrides: Partial<Record<string, string>> = {}): string[] {
  const headers = MASTER_HEADERS.box_specs;
  const base: Record<string, string> = {
    sku: 'N199999',
    id: '',
    name: '导入箱规',
    vol: '0.08',
    lengthMm: '400',
    widthMm: '400',
    heightMm: '500',
    note: '',
  };
  Object.assign(base, overrides);
  return headers.map((h) => base[h] ?? '');
}

describe('变更-6 主数据导入导出 domain', () => {
  it('C6-01/02: 模板头 = 导出头 = 导入头，CSV 带 BOM，xlsx 可往返', async () => {
    const master = seedMaster();
    const entities: Exclude<MasterEntity, 'customer_rules'>[] = ['cabinets', 'trays', 'processes', 'box_specs'];
    for (const entity of entities) {
      const tmplCsv = templateMaster(entity, 'csv');
      const tmplXlsx = templateMaster(entity, 'xlsx');
      const expCsv = serializeMaster(entity, master, 'csv');
      const expXlsx = serializeMaster(entity, master, 'xlsx');
      expect(tmplCsv.type).toMatch(/csv/);
      expect(tmplXlsx.type).toMatch(/spreadsheetml|officedocument/);
      const csvText = await blobText(tmplCsv);
      const headerLine = csvText.replace(/^\ufeff/, '').split(/\r?\n/)[0];
      expect(headerLine).toBe(MASTER_HEADERS[entity].join(','));
      expect(csvHasBom(serializeMasterCsvString(entity, master))).toBe(true);
      const expText = await blobText(expCsv);
      expect(expText.replace(/^\ufeff/, '').split(/\r?\n/)[0]).toBe(MASTER_HEADERS[entity].join(','));

      const parsedTmpl = parseMasterFile(entity, enc(csvText), 'csv');
      expect(parsedTmpl.ok).toBe(true);
      if (parsedTmpl.ok) {
        expect(parsedTmpl.rows.every((r) => r.__example)).toBe(true);
      }

      const xlsxBytes = await blobBytes(expXlsx);
      const round = parseOk(entity, xlsxBytes, 'xlsx');
      expect(round.length).toBeGreaterThan(0);
      expect(Object.keys(round[0]!).filter((k) => !k.startsWith('__'))).toEqual([...MASTER_HEADERS[entity]]);
    }
  });

  it('C6-02: 客户规则禁止导入，返回 MD_ENTITY_FORBIDDEN', () => {
    const master = seedMaster();
    const blob = serializeMaster('customer_rules', master, 'csv');
    const parsed = parseMasterFile('customer_rules', enc('customerId\nC-华润'), 'csv');
    const rows = parsed.ok ? parsed.rows : [];
    const report = validateMasterImport('customer_rules', rows, master);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === 'MD_ENTITY_FORBIDDEN')).toBe(true);
    expect(() => applyMasterUpsert('customer_rules', rows, master)).toThrow(/MD_ENTITY_FORBIDDEN/);
    expect(blob.type).toMatch(/csv/);
    expect(() => templateMaster('customer_rules', 'csv')).toThrow(/MD_ENTITY_FORBIDDEN/);
  });

  it('C6-03: 合法 CSV upsert 后主键稳定，重复导入不复制', () => {
    const master = seedMaster();
    const cabCsv = csv('cabinets', [cabinetRow()]);
    const cabRows = parseOk('cabinets', enc(cabCsv), 'csv');
    const cabReport = validateMasterImport('cabinets', cabRows, master);
    expect(cabReport.ok).toBe(true);
    const cabinets = applyMasterUpsert('cabinets', cabRows, master) as Cabinet[];
    expect(cabinets.filter((c) => c.canonicalId === 'cab-99')).toHaveLength(1);
    expect(cabinets.find((c) => c.canonicalId === 'cab-9')?.id).toBe('柜9');
    const cabAgain = applyMasterUpsert('cabinets', cabRows, { ...master, cabinets }) as Cabinet[];
    expect(cabAgain.filter((c) => c.canonicalId === 'cab-99')).toHaveLength(1);
    expect(cabAgain.length).toBe(cabinets.length);

    const trayCsv = csv('trays', [trayRow()]);
    const trayRows = parseOk('trays', enc(trayCsv), 'csv');
    expect(validateMasterImport('trays', trayRows, { ...master, cabinets }).ok).toBe(true);
    const trays = applyMasterUpsert('trays', trayRows, { ...master, cabinets }) as Tray[];
    expect(trays.filter((t) => t.id === 'cab-9-tray-99')).toHaveLength(1);
    expect(trays.find((t) => t.id === 'cab-9-tray-01')?.cabinetId).toBe('柜9');

    const procCsv = csv('processes', [processRow({ cabinets: 'cab-9|柜20' })]);
    const procRows = parseOk('processes', enc(procCsv), 'csv');
    expect(validateMasterImport('processes', procRows, master).ok).toBe(true);
    const processes = applyMasterUpsert('processes', procRows, master) as Process[];
    expect(processes.filter((p) => p.code === 'NEWP')).toHaveLength(1);
    const newp = processes.find((p) => p.code === 'NEWP')!;
    expect(newp.cabinets).toContain('柜9');
    expect(newp.aerateConfirmed).toBe(true);

    const boxCsv = csv('box_specs', [boxRow()]);
    const boxRows = parseOk('box_specs', enc(boxCsv), 'csv');
    expect(validateMasterImport('box_specs', boxRows, master).ok).toBe(true);
    const boxSpecs = applyMasterUpsert('box_specs', boxRows, master) as BoxSpec[];
    const added = boxSpecs.find((b) => b.sku === 'N199999')!;
    expect(added.id).toMatch(/^bs-/);
    const boxAgain = applyMasterUpsert('box_specs', boxRows, { ...master, boxSpecs }) as BoxSpec[];
    expect(boxAgain.filter((b) => b.sku === 'N199999')).toHaveLength(1);
    expect(boxAgain.find((b) => b.sku === 'N199999')?.id).toBe(added.id);
  });

  it('C6-03: 缺 canonicalId 时用 id 推导，往返不漂移', async () => {
    const master = seedMaster();
    const row = cabinetRow({ canonicalId: '', id: '柜88', displayCode: '' });
    const rows = parseOk('cabinets', enc(csv('cabinets', [row])), 'csv');
    expect(validateMasterImport('cabinets', rows, master).ok).toBe(true);
    const cabinets = applyMasterUpsert('cabinets', rows, master) as Cabinet[];
    const added = cabinets.find((c) => c.id === '柜88')!;
    expect(added.canonicalId).toBe('cab-88');
    expect(added.displayCode).toBe('柜88');
    const exported = serializeMaster('cabinets', { ...master, cabinets }, 'csv');
    const text = await blobText(exported);
    expect(text).toContain('cab-88');
    expect(text).toContain('柜88');
  });

  it('C6-04: 硬错误整批不写入（缺主键 / 坏外键 / 枚举 / 重复键 / 层号）', () => {
    const master = seedMaster();
    const cases: Array<{ entity: MasterEntity; rows: string[][]; code: string }> = [
      { entity: 'cabinets', rows: [cabinetRow({ canonicalId: '', id: '', displayCode: '' })], code: 'MD_REQUIRED' },
      { entity: 'trays', rows: [trayRow({ cabinetId: '柜不存在' })], code: 'MD_FK_CABINET' },
      { entity: 'processes', rows: [processRow({ cabinets: '柜幽灵' })], code: 'MD_FK_CABINET' },
      { entity: 'cabinets', rows: [cabinetRow({ status: '维修' })], code: 'MD_TYPE' },
      { entity: 'cabinets', rows: [cabinetRow(), cabinetRow()], code: 'MD_DUP_KEY' },
      { entity: 'trays', rows: [trayRow({ id: 't-a', level: '3' }), trayRow({ id: 't-b', level: '3' })], code: 'MD_DUP_LEVEL' },
    ];
    for (const c of cases) {
      const parsed = parseOk(c.entity, enc(csv(c.entity, c.rows)), 'csv');
      const report = validateMasterImport(c.entity, parsed, master);
      expect(report.ok, `${c.code} ${c.entity}`).toBe(false);
      expect(report.errors.some((e) => e.code === c.code), `${c.code} missing in ${JSON.stringify(report.errors)}`).toBe(true);
      const before = JSON.stringify(master);
      expect(before).toBe(JSON.stringify(seedMaster()));
    }
  });

  it('C6-04: 合法行+非法行混合时确认不可用，apply 不得部分写入', () => {
    const master = seedMaster();
    const rows = parseOk(
      'cabinets',
      enc(csv('cabinets', [cabinetRow(), cabinetRow({ canonicalId: 'cab-100', id: '柜100', displayCode: '柜100', status: '坏了' })])),
      'csv',
    );
    const report = validateMasterImport('cabinets', rows, master);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === 'MD_TYPE')).toBe(true);
    const cabinets = applyMasterUpsert('cabinets', rows.filter((r) => r.canonicalId === 'cab-99'), master) as Cabinet[];
    expect(cabinets.some((c) => c.canonicalId === 'cab-99')).toBe(true);
    expect(master.cabinets.some((c) => c.canonicalId === 'cab-99')).toBe(false);
  });

  it('缺必要列表头为 MD_HEADER_MISMATCH；损坏 xlsx 为 MD_PARSE_FAIL', () => {
    const master = seedMaster();
    const badHeader = enc('foo,bar\n1,2');
    const parsed = parseMasterFile('cabinets', badHeader, 'csv');
    if (parsed.ok) {
      const report = validateMasterImport('cabinets', parsed.rows, master);
      expect(report.errors.some((e) => e.code === 'MD_HEADER_MISMATCH')).toBe(true);
    } else {
      expect(parsed.error.code).toBe('MD_HEADER_MISMATCH');
    }
    const broken = parseMasterFile('cabinets', enc('not-a-zip'), 'xlsx');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error.code).toBe('MD_PARSE_FAIL');
  });

  it('C6-05: upsert 只改对应主数据切片，不删未出现行，不碰交易形状字段', () => {
    const master = seedMaster();
    const snapshot = clone(master);
    const rows = parseOk('cabinets', enc(csv('cabinets', [cabinetRow({ status: '报废' })])), 'csv');
    const cabinets = applyMasterUpsert('cabinets', rows, master) as Cabinet[];
    expect(cabinets.find((c) => c.canonicalId === 'cab-99')?.status).toBe('报废');
    expect(cabinets.find((c) => c.id === '柜9')).toBeTruthy();
    expect(master.trays).toEqual(snapshot.trays);
    expect(master.processes).toEqual(snapshot.processes);
    expect(master.boxSpecs).toEqual(snapshot.boxSpecs);
    expect(master.cabinets).toEqual(snapshot.cabinets);
  });

  it('箱规长宽高与体积偏差仅 warning，不阻断', () => {
    const master = seedMaster();
    const rows = parseOk(
      'box_specs',
      enc(csv('box_specs', [boxRow({ vol: '0.08', lengthMm: '10', widthMm: '10', heightMm: '10' })])),
      'csv',
    );
    const report = validateMasterImport('box_specs', rows, master);
    expect(report.ok).toBe(true);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('示例行导入时忽略', () => {
    const master = seedMaster();
    const headers = MASTER_HEADERS.cabinets.join(',');
    const example = ['#示例', '柜X', '柜X', '新', '80', '80', '80', '可用', '4', '', '（示例，导入时忽略）'].join(',');
    const real = cabinetRow().join(',');
    const rows = parseOk('cabinets', enc(`\ufeff${headers}\n${example}\n${real}`), 'csv');
    expect(rows.filter((r) => !r.__example)).toHaveLength(1);
    const report = validateMasterImport('cabinets', rows, master);
    expect(report.ok).toBe(true);
  });
});
