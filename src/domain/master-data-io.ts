import * as XLSX from 'xlsx';
import type { Base, BoxSpec, Cabinet, CabinetStatus, CustomerRule, Process, Tray, TrayStatus } from './entities';

export type MasterEntity = 'cabinets' | 'trays' | 'processes' | 'box_specs' | 'customer_rules';
export type MasterFileFormat = 'csv' | 'xlsx';

export interface MasterData {
  cabinets: Cabinet[];
  trays: Tray[];
  processes: Process[];
  boxSpecs: BoxSpec[];
  customerRules: CustomerRule[];
}

export interface LineError {
  line: number;
  field: string;
  code: string;
  reason: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: LineError[];
  warnings: LineError[];
}

export interface ParsedRow {
  __line: number;
  __example?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export type ParseResult =
  | { ok: true; rows: ParsedRow[] }
  | { ok: false; error: LineError };

export const MASTER_ERROR_CODES = {
  MD_PARSE_FAIL: 'MD_PARSE_FAIL',
  MD_HEADER_MISMATCH: 'MD_HEADER_MISMATCH',
  MD_REQUIRED: 'MD_REQUIRED',
  MD_TYPE: 'MD_TYPE',
  MD_DUP_KEY: 'MD_DUP_KEY',
  MD_FK_CABINET: 'MD_FK_CABINET',
  MD_DUP_LEVEL: 'MD_DUP_LEVEL',
  MD_ENTITY_FORBIDDEN: 'MD_ENTITY_FORBIDDEN',
} as const;

export const MASTER_HEADERS: Record<MasterEntity, readonly string[]> = {
  cabinets: [
    'canonicalId',
    'displayCode',
    'id',
    'base',
    'capacity',
    'ratedLoadM3',
    'dailyCapacityM3',
    'status',
    'maxTrayCount',
    'tags',
    'note',
  ],
  trays: ['id', 'cabinetId', 'level', 'displayName', 'capacityM3', 'maxBoxes', 'maxBoards', 'status', 'note'],
  processes: ['code', 'name', 'cabinets', 'aerateDays', 'aerateConfirmed', 'minLoadM3', 'note'],
  box_specs: ['sku', 'id', 'name', 'vol', 'lengthMm', 'widthMm', 'heightMm', 'note'],
  customer_rules: ['customerId', 'designatedCabinets', 'mixPolicy', 'note'],
};

const CABINET_BASES: Base[] = ['老', '新'];
const CABINET_STATUSES: CabinetStatus[] = ['可用', '报废', '待确认'];
const TRAY_STATUSES: TrayStatus[] = ['可用', '停用'];
const BOOL_TRUE = new Set(['true', '1', '是', 'y', 'yes']);
const BOOL_FALSE = new Set(['false', '0', '否', 'n', 'no']);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv;charset=utf-8';
const FORBIDDEN = '客户规则首版仅导出（P1）';

const TEMPLATE_EXAMPLES: Record<Exclude<MasterEntity, 'customer_rules'>, string[]> = {
  cabinets: ['#示例', '柜X', '柜X', '新', '80', '80', '80', '可用', '4', 'D002', '（示例，导入时忽略）'],
  trays: ['#示例', '柜9', '1', '第1层托盘', '20', '100', '8', '可用', '（示例，导入时忽略）'],
  processes: ['#示例', '示例工艺', '柜9|柜20', '2', '是', '40', '（示例，导入时忽略）'],
  box_specs: ['#示例', '', '示例箱规', '0.08', '400', '400', '500', '（示例，导入时忽略）'],
};

function err(line: number, field: string, code: string, reason: string): LineError {
  return { line, field, code, reason };
}

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function cell(row: ParsedRow, key: string): string {
  return trim(row[key]);
}

export function canonicalIdFromDisplay(id: string): string {
  return `cab-${id.replace(/^柜/, '')}`;
}

export function resolveCabinet(cabinets: Cabinet[], ref: string): Cabinet | undefined {
  const key = trim(ref);
  if (!key) return undefined;
  return cabinets.find((c) => c.id === key || c.canonicalId === key || c.displayCode === key);
}

function parseCsv(text: string): string[][] {
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      cur = '';
      if (row.some((c) => trim(c) !== '')) rows.push(row);
      row = [];
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') continue;
      row.push(cur);
      cur = '';
      if (row.some((c) => trim(c) !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    if (row.some((c) => trim(c) !== '')) rows.push(row);
  }
  return rows;
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function isExampleCells(cells: string[]): boolean {
  const first = trim(cells[0]);
  if (first.startsWith('#')) return true;
  return cells.some((c) => trim(c) === '__EXAMPLE__' || trim(c).includes('导入时忽略'));
}

function isExampleRow(row: ParsedRow): boolean {
  if (row.__example) return true;
  const headers = Object.keys(row).filter((k) => !k.startsWith('__'));
  return isExampleCells(headers.map((h) => cell(row, h)));
}

function liveRows(rows: ParsedRow[]): ParsedRow[] {
  return rows.filter((r) => !isExampleRow(r));
}

function parseNum(s: unknown): number | undefined | 'bad' {
  if (trim(s) === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : 'bad';
}

function parseIntPos(s: unknown): number | undefined | 'bad' {
  const n = parseNum(s);
  if (n === undefined || n === 'bad') return n;
  return Number.isInteger(n) && n > 0 ? n : 'bad';
}

function parseBool(s: unknown): boolean | undefined | 'bad' {
  const v = trim(s).toLowerCase();
  if (!v) return undefined;
  if (BOOL_TRUE.has(v)) return true;
  if (BOOL_FALSE.has(v)) return false;
  return 'bad';
}

function splitMulti(s: unknown): string[] {
  return trim(s)
    .split(/[|,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function inList<T extends string>(v: string, list: readonly T[]): v is T {
  return (list as readonly string[]).includes(v);
}

function readSheet(bytes: Uint8Array): string[][] {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: false, raw: false });
  const name = wb.SheetNames[0];
  if (!name) throw new Error('empty workbook');
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error('empty sheet');
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
  return aoa.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c))) : []));
}

function writeSheet(rows: string[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'data');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

function xlsxBlob(table: string[][]): Blob {
  const bytes = writeSheet(table);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: XLSX_MIME });
}

function rowsToParsed(entity: MasterEntity, table: string[][]): ParseResult {
  if (!table.length) {
    return { ok: false, error: err(0, '', MASTER_ERROR_CODES.MD_PARSE_FAIL, '文件为空或无法解析') };
  }
  const headers = table[0]!.map((h) => trim(h));
  const required = MASTER_HEADERS[entity];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length) {
    return {
      ok: false,
      error: err(1, missing.join(','), MASTER_ERROR_CODES.MD_HEADER_MISMATCH, `缺必要列：${missing.join('、')}`),
    };
  }
  const rows: ParsedRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i] || [];
    if (!cells.some((c) => trim(c) !== '')) continue;
    const row = { __line: i + 1 } as ParsedRow;
    for (const h of required) {
      const idx = headers.indexOf(h);
      row[h] = idx >= 0 ? trim(cells[idx] || '') : '';
    }
    if (isExampleCells(required.map((h) => cell(row, h)))) row.__example = true;
    rows.push(row);
  }
  return { ok: true, rows };
}

function toUint8(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

export function parseMasterFile(
  entity: MasterEntity,
  bytes: Uint8Array | ArrayBuffer,
  format: MasterFileFormat,
): ParseResult {
  try {
    const buf = toUint8(bytes);
    if (!buf.byteLength) {
      return { ok: false, error: err(0, '', MASTER_ERROR_CODES.MD_PARSE_FAIL, '文件为空或无法解析') };
    }
    if (format === 'csv') {
      const text = new TextDecoder('utf-8').decode(buf);
      return rowsToParsed(entity, parseCsv(text));
    }
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
      return { ok: false, error: err(0, '', MASTER_ERROR_CODES.MD_PARSE_FAIL, '文件无法解析') };
    }
    return rowsToParsed(entity, readSheet(buf));
  } catch {
    return { ok: false, error: err(0, '', MASTER_ERROR_CODES.MD_PARSE_FAIL, '文件无法解析') };
  }
}

function cabinetIdent(row: ParsedRow): { canonicalId: string; id: string; displayCode: string } | null {
  const canonicalIdRaw = trim(row.canonicalId);
  const idRaw = trim(row.id);
  const displayRaw = trim(row.displayCode);
  if (!canonicalIdRaw && !idRaw && !displayRaw) return null;
  const id =
    idRaw ||
    displayRaw ||
    (canonicalIdRaw.startsWith('cab-') ? `柜${canonicalIdRaw.slice(4)}` : canonicalIdRaw);
  const displayCode = displayRaw || id;
  const canonicalId = canonicalIdRaw || canonicalIdFromDisplay(id);
  return { canonicalId, id, displayCode };
}

function matchCabinet(cabinets: Cabinet[], ident: { canonicalId: string; id: string; displayCode: string }): Cabinet | undefined {
  return cabinets.find(
    (c) =>
      c.canonicalId === ident.canonicalId ||
      c.id === ident.id ||
      c.displayCode === ident.displayCode ||
      c.canonicalId === ident.id ||
      c.id === ident.canonicalId,
  );
}

export function validateMasterImport(entity: MasterEntity, rows: ParsedRow[], current: MasterData): ValidationReport {
  const errors: LineError[] = [];
  const warnings: LineError[] = [];
  if (entity === 'customer_rules') {
    return {
      ok: false,
      errors: [err(0, '', MASTER_ERROR_CODES.MD_ENTITY_FORBIDDEN, FORBIDDEN)],
      warnings,
    };
  }
  const live = liveRows(rows);
  const seen = new Map<string, number>();
  const cabinetsAfter = current.cabinets.slice();

  if (entity === 'cabinets') {
    for (const row of live) {
      const ident = cabinetIdent(row);
      if (!ident) {
        errors.push(err(row.__line, 'canonicalId', MASTER_ERROR_CODES.MD_REQUIRED, '主键为空（canonicalId / id / displayCode）'));
        continue;
      }
      const prev = seen.get(ident.canonicalId);
      if (prev != null) errors.push(err(row.__line, 'canonicalId', MASTER_ERROR_CODES.MD_DUP_KEY, `文件内主键重复：${ident.canonicalId}`));
      else seen.set(ident.canonicalId, row.__line);
      const base = trim(row.base);
      if (base && !inList(base, CABINET_BASES)) {
        errors.push(err(row.__line, 'base', MASTER_ERROR_CODES.MD_TYPE, `基地非法：${base}`));
      }
      const status = trim(row.status);
      if (status && !inList(status, CABINET_STATUSES)) {
        errors.push(err(row.__line, 'status', MASTER_ERROR_CODES.MD_TYPE, `状态非法：${status}`));
      }
      for (const f of ['capacity', 'ratedLoadM3', 'dailyCapacityM3', 'maxTrayCount'] as const) {
        const n = parseNum(row[f] || '');
        if (n === 'bad') errors.push(err(row.__line, f, MASTER_ERROR_CODES.MD_TYPE, `${f} 不是合法数字`));
      }
    }
  }

  if (entity === 'trays') {
    const fileLevels = new Map<string, number>();
    for (const row of live) {
      if (!trim(row.id)) errors.push(err(row.__line, 'id', MASTER_ERROR_CODES.MD_REQUIRED, '托盘主键 id 为空'));
      else {
        const prev = seen.get(cell(row, 'id'));
        if (prev != null) errors.push(err(row.__line, 'id', MASTER_ERROR_CODES.MD_DUP_KEY, `文件内主键重复：${cell(row, 'id')}`));
        else seen.set(cell(row, 'id'), row.__line);
      }
      if (!trim(row.cabinetId)) errors.push(err(row.__line, 'cabinetId', MASTER_ERROR_CODES.MD_REQUIRED, 'cabinetId 为空'));
      else if (!resolveCabinet(cabinetsAfter, cell(row, 'cabinetId'))) {
        errors.push(err(row.__line, 'cabinetId', MASTER_ERROR_CODES.MD_FK_CABINET, `托盘引用柜不存在：${cell(row, 'cabinetId')}`));
      }
      const level = parseIntPos(row.level || '');
      if (level === undefined) errors.push(err(row.__line, 'level', MASTER_ERROR_CODES.MD_REQUIRED, '层号为空'));
      else if (level === 'bad') errors.push(err(row.__line, 'level', MASTER_ERROR_CODES.MD_TYPE, '层号必须是正整数'));
      const status = trim(row.status);
      if (status && !inList(status, TRAY_STATUSES)) {
        errors.push(err(row.__line, 'status', MASTER_ERROR_CODES.MD_TYPE, `状态非法：${status}`));
      }
      const cab = resolveCabinet(cabinetsAfter, cell(row, 'cabinetId'));
      if (cab && typeof level === 'number') {
        const key = `${cab.id}#${level}`;
        const prev = fileLevels.get(key);
        if (prev != null) errors.push(err(row.__line, 'level', MASTER_ERROR_CODES.MD_DUP_LEVEL, `同柜层号冲突：${cab.id} 第${level}层`));
        else fileLevels.set(key, row.__line);
      }
      for (const f of ['capacityM3', 'maxBoxes', 'maxBoards'] as const) {
        const n = parseNum(row[f] || '');
        if (n === 'bad') errors.push(err(row.__line, f, MASTER_ERROR_CODES.MD_TYPE, `${f} 不是合法数字`));
      }
    }
    if (errors.length === 0) {
      const nextIds = new Set(live.map((r) => cell(r, 'id')));
      const merged = current.trays.filter((t) => !nextIds.has(t.id));
      for (const row of live) {
        const cab = resolveCabinet(cabinetsAfter, cell(row, 'cabinetId'));
        const level = parseIntPos(row.level || '');
        if (!cab || typeof level !== 'number') continue;
        merged.push({
          id: cell(row, 'id'),
          cabinetId: cab.id,
          level,
          status: inList(trim(row.status), TRAY_STATUSES) ? (trim(row.status) as TrayStatus) : '可用',
        });
      }
      const lvl = new Map<string, string>();
      for (const t of merged) {
        const key = `${t.cabinetId}#${t.level}`;
        if (lvl.has(key)) {
          errors.push(err(0, 'level', MASTER_ERROR_CODES.MD_DUP_LEVEL, `同柜层号冲突：${t.cabinetId} 第${t.level}层`));
          break;
        }
        lvl.set(key, t.id);
      }
    }
  }

  if (entity === 'processes') {
    for (const row of live) {
      if (!trim(row.code)) errors.push(err(row.__line, 'code', MASTER_ERROR_CODES.MD_REQUIRED, '工艺主键 code 为空'));
      else {
        const prev = seen.get(cell(row, 'code'));
        if (prev != null) errors.push(err(row.__line, 'code', MASTER_ERROR_CODES.MD_DUP_KEY, `文件内主键重复：${cell(row, 'code')}`));
        else seen.set(cell(row, 'code'), row.__line);
      }
      const refs = splitMulti(row.cabinets || '');
      for (const ref of refs) {
        if (!resolveCabinet(cabinetsAfter, ref)) {
          errors.push(err(row.__line, 'cabinets', MASTER_ERROR_CODES.MD_FK_CABINET, `工艺引用柜不存在：${ref}`));
        }
      }
      const days = parseNum(row.aerateDays || '');
      if (days === 'bad') errors.push(err(row.__line, 'aerateDays', MASTER_ERROR_CODES.MD_TYPE, '解析天数不是合法数字'));
      const conf = parseBool(row.aerateConfirmed || '');
      if (conf === 'bad') errors.push(err(row.__line, 'aerateConfirmed', MASTER_ERROR_CODES.MD_TYPE, 'aerateConfirmed 非法'));
      const minL = parseNum(row.minLoadM3 || '');
      if (minL === 'bad') errors.push(err(row.__line, 'minLoadM3', MASTER_ERROR_CODES.MD_TYPE, 'minLoadM3 不是合法数字'));
    }
  }

  if (entity === 'box_specs') {
    const seenId = new Map<string, number>();
    for (const row of live) {
      if (!trim(row.sku)) errors.push(err(row.__line, 'sku', MASTER_ERROR_CODES.MD_REQUIRED, '箱规主键 sku 为空'));
      else {
        const prev = seen.get(cell(row, 'sku'));
        if (prev != null) errors.push(err(row.__line, 'sku', MASTER_ERROR_CODES.MD_DUP_KEY, `文件内主键重复：${cell(row, 'sku')}`));
        else seen.set(cell(row, 'sku'), row.__line);
      }
      if (trim(row.id)) {
        const prev = seenId.get(cell(row, 'id'));
        if (prev != null) errors.push(err(row.__line, 'id', MASTER_ERROR_CODES.MD_DUP_KEY, `文件内 id 重复：${cell(row, 'id')}`));
        else seenId.set(cell(row, 'id'), row.__line);
      }
      const vol = parseNum(row.vol || '');
      if (vol === undefined) errors.push(err(row.__line, 'vol', MASTER_ERROR_CODES.MD_REQUIRED, '体积为空'));
      else if (vol === 'bad' || vol <= 0) errors.push(err(row.__line, 'vol', MASTER_ERROR_CODES.MD_TYPE, '体积必须为大于 0 的数字'));
      const L = parseNum(row.lengthMm || '');
      const W = parseNum(row.widthMm || '');
      const H = parseNum(row.heightMm || '');
      for (const [f, n] of [
        ['lengthMm', L],
        ['widthMm', W],
        ['heightMm', H],
      ] as const) {
        if (n === 'bad') errors.push(err(row.__line, f, MASTER_ERROR_CODES.MD_TYPE, `${f} 不是合法数字`));
      }
      if (typeof vol === 'number' && vol > 0 && typeof L === 'number' && typeof W === 'number' && typeof H === 'number') {
        const computed = (L * W * H) / 1e9;
        const denom = Math.max(vol, computed, 1e-9);
        if (Math.abs(computed - vol) / denom > 0.2) {
          warnings.push(
            err(row.__line, 'vol', 'MD_VOL_DIM', `体积 ${vol} 与长宽高推算 ${computed.toFixed(6)} m³ 偏差较大（warning）`),
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function stableBoxId(sku: string): string {
  return `bs-${sku.replace(/[^A-Za-z0-9._-]/g, '') || 'item'}`;
}

export function applyMasterUpsert(
  entity: MasterEntity,
  rows: ParsedRow[],
  current: MasterData,
): Cabinet[] | Tray[] | Process[] | BoxSpec[] | CustomerRule[] {
  if (entity === 'customer_rules') {
    throw new Error('MD_ENTITY_FORBIDDEN');
  }
  const live = liveRows(rows);
  if (entity === 'cabinets') {
    const next = cloneJson(current.cabinets);
    for (const row of live) {
      const ident = cabinetIdent(row);
      if (!ident) continue;
      const cap = parseNum(row.capacity);
      const rated = parseNum(row.ratedLoadM3);
      const daily = parseNum(row.dailyCapacityM3);
      const maxT = parseIntPos(row.maxTrayCount);
      const existing = matchCabinet(next, ident);
      const capacity = typeof cap === 'number' ? cap : typeof rated === 'number' ? rated : existing?.capacity ?? 0;
      const ratedLoadM3 = typeof rated === 'number' ? rated : existing?.ratedLoadM3 ?? capacity;
      const patch: Cabinet = {
        id: ident.id,
        canonicalId: ident.canonicalId,
        displayCode: ident.displayCode,
        base: inList(trim(row.base), CABINET_BASES) ? (trim(row.base) as Base) : existing?.base ?? '老',
        capacity,
        ratedLoadM3,
        dailyCapacityM3: typeof daily === 'number' ? daily : existing?.dailyCapacityM3 ?? capacity,
        status: inList(trim(row.status), CABINET_STATUSES)
          ? (trim(row.status) as CabinetStatus)
          : existing?.status ?? '可用',
        note: trim(row.note) || existing?.note || '',
        tags: splitMulti(row.tags),
        maxTrayCount: typeof maxT === 'number' ? maxT : existing?.maxTrayCount,
        pending: false,
      };
      patch.pending = patch.status === '待确认';
      if (existing) {
        const idx = next.indexOf(existing);
        next[idx] = { ...existing, ...patch, tags: patch.tags };
      } else next.push(patch);
    }
    return next;
  }
  if (entity === 'trays') {
    const next = cloneJson(current.trays);
    for (const row of live) {
      const cab = resolveCabinet(current.cabinets, cell(row, 'cabinetId'));
      const level = parseIntPos(row.level);
      if (!cell(row, 'id') || !cab || typeof level !== 'number') continue;
      const cap = parseNum(row.capacityM3);
      const maxBoxes = parseNum(row.maxBoxes);
      const maxBoards = parseNum(row.maxBoards);
      const patch: Tray = {
        id: cell(row, 'id'),
        cabinetId: cab.id,
        level,
        displayName: trim(row.displayName) || undefined,
        capacityM3: typeof cap === 'number' ? cap : undefined,
        ratedLoadM3: typeof cap === 'number' ? cap : undefined,
        maxBoxes: typeof maxBoxes === 'number' ? maxBoxes : undefined,
        maxBoards: typeof maxBoards === 'number' ? maxBoards : undefined,
        status: inList(trim(row.status), TRAY_STATUSES) ? (trim(row.status) as TrayStatus) : '可用',
        note: trim(row.note) || undefined,
      };
      const idx = next.findIndex((t) => t.id === patch.id);
      if (idx >= 0) next[idx] = { ...next[idx]!, ...patch };
      else next.push(patch);
    }
    return next;
  }
  if (entity === 'processes') {
    const next = cloneJson(current.processes);
    for (const row of live) {
      if (!cell(row, 'code')) continue;
      const existing = next.find((p) => p.code === cell(row, 'code'));
      const days = parseNum(row.aerateDays);
      const conf = parseBool(row.aerateConfirmed);
      const minL = parseNum(row.minLoadM3);
      const cabs = splitMulti(row.cabinets)
        .map((ref) => resolveCabinet(current.cabinets, ref)?.id || ref)
        .filter(Boolean);
      const patch: Process = {
        code: cell(row, 'code'),
        name: trim(row.name) || existing?.name || cell(row, 'code'),
        cabinets: cabs,
        aerateDays: typeof days === 'number' ? days : existing?.aerateDays ?? 1,
        aerateConfirmed: typeof conf === 'boolean' ? conf : existing?.aerateConfirmed ?? false,
        note: trim(row.note) || existing?.note || '',
        minLoadM3: typeof minL === 'number' ? minL : existing?.minLoadM3,
        pending: existing?.pending ?? false,
      };
      if (existing) {
        const idx = next.indexOf(existing);
        next[idx] = { ...existing, ...patch };
      } else next.push(patch);
    }
    return next;
  }
  const next = cloneJson(current.boxSpecs);
  for (const row of live) {
    if (!cell(row, 'sku')) continue;
    const vol = parseNum(row.vol);
    if (typeof vol !== 'number' || vol <= 0) continue;
    const L = parseNum(row.lengthMm);
    const W = parseNum(row.widthMm);
    const H = parseNum(row.heightMm);
    const sku = cell(row, 'sku');
    const bySku = next.find((b) => b.sku === sku);
    const byId = cell(row, 'id') ? next.find((b) => b.id === cell(row, 'id')) : undefined;
    const existing = bySku || byId;
    const id = cell(row, 'id') || existing?.id || stableBoxId(sku);
    const patch: BoxSpec = {
      id,
      sku,
      name: trim(row.name) || existing?.name || sku,
      vol,
      lengthMm: typeof L === 'number' ? L : existing?.lengthMm,
      widthMm: typeof W === 'number' ? W : existing?.widthMm,
      heightMm: typeof H === 'number' ? H : existing?.heightMm,
      note: trim(row.note) || existing?.note || '',
    };
    if (existing) {
      const idx = next.indexOf(existing);
      next[idx] = { ...existing, ...patch };
    } else next.push(patch);
  }
  return next;
}

function recordRows(entity: MasterEntity, data: MasterData): string[][] {
  const headers = [...MASTER_HEADERS[entity]];
  const body: string[][] = [];
  if (entity === 'cabinets') {
    for (const c of data.cabinets) {
      body.push([
        c.canonicalId,
        c.displayCode,
        c.id,
        c.base,
        String(c.capacity),
        String(c.ratedLoadM3),
        String(c.dailyCapacityM3 ?? c.capacity),
        c.status,
        c.maxTrayCount != null ? String(c.maxTrayCount) : '',
        (c.tags || []).join('|'),
        c.note || '',
      ]);
    }
  } else if (entity === 'trays') {
    for (const t of data.trays) {
      body.push([
        t.id,
        t.cabinetId,
        String(t.level),
        t.displayName || '',
        t.capacityM3 != null ? String(t.capacityM3) : '',
        t.maxBoxes != null ? String(t.maxBoxes) : '',
        t.maxBoards != null ? String(t.maxBoards) : '',
        t.status,
        t.note || '',
      ]);
    }
  } else if (entity === 'processes') {
    for (const p of data.processes) {
      body.push([
        p.code,
        p.name,
        p.cabinets.join('|'),
        String(p.aerateDays),
        p.aerateConfirmed ? 'true' : 'false',
        p.minLoadM3 != null ? String(p.minLoadM3) : '',
        p.note || '',
      ]);
    }
  } else if (entity === 'box_specs') {
    for (const b of data.boxSpecs) {
      body.push([
        b.sku,
        b.id,
        b.name,
        String(b.vol),
        b.lengthMm != null ? String(b.lengthMm) : '',
        b.widthMm != null ? String(b.widthMm) : '',
        b.heightMm != null ? String(b.heightMm) : '',
        b.note || '',
      ]);
    }
  } else {
    for (const r of data.customerRules) {
      body.push([r.customerId, r.designatedCabinets.join('|'), r.mixPolicy, r.note || '']);
    }
  }
  return [headers, ...body];
}

function csvBlob(table: string[][]): Blob {
  return new Blob([csvText(table)], { type: CSV_MIME });
}

export function csvText(table: string[][]): string {
  const body = table.map((r) => r.map(csvEscape).join(',')).join('\n');
  return `\ufeff${body}`;
}

export function serializeMaster(entity: MasterEntity, data: MasterData, format: MasterFileFormat): Blob {
  const table = recordRows(entity, data);
  if (format === 'csv') return csvBlob(table);
  return xlsxBlob(table);
}

export function serializeMasterCsvString(entity: MasterEntity, data: MasterData): string {
  return csvText(recordRows(entity, data));
}

export function templateMaster(entity: MasterEntity, format: MasterFileFormat): Blob {
  if (entity === 'customer_rules') throw new Error('MD_ENTITY_FORBIDDEN');
  const headers = [...MASTER_HEADERS[entity]];
  const example = TEMPLATE_EXAMPLES[entity];
  const table = [headers, example];
  if (format === 'csv') return csvBlob(table);
  return xlsxBlob(table);
}

export function overlayMasterSlice(
  data: MasterData,
  entity: MasterEntity,
  slice: Cabinet[] | Tray[] | Process[] | BoxSpec[] | CustomerRule[],
): MasterData {
  if (entity === 'cabinets') return { ...data, cabinets: slice as Cabinet[] };
  if (entity === 'trays') return { ...data, trays: slice as Tray[] };
  if (entity === 'processes') return { ...data, processes: slice as Process[] };
  if (entity === 'box_specs') return { ...data, boxSpecs: slice as BoxSpec[] };
  return { ...data, customerRules: slice as CustomerRule[] };
}
