import { contentVol, fillRateOf } from './cabinet-content';
import { shiftRank } from './dates';
import type {
  Cabinet,
  CabinetContent,
  ScheduleSortPolicy,
  SortDirection,
  SortKeyCode,
  SortKeySpec,
  SortPolicyErrorCode,
  StockLine,
} from './entities';
import { SORT_POLICY_ERROR_CODES } from './entities';

export const SORT_KEY_CODES: SortKeyCode[] = ['date', 'shift', 'volume', 'id', 'due', 'urgent', 'fillRate'];
export const CORE_SORT_CODES: SortKeyCode[] = ['date', 'shift', 'volume'];
export const OPTIONAL_SORT_CODES: SortKeyCode[] = ['due', 'urgent', 'fillRate'];
export const USER_SORT_CODES: SortKeyCode[] = ['date', 'shift', 'volume', 'due', 'urgent', 'fillRate'];

export const SORT_KEY_LABELS: Record<SortKeyCode, string> = {
  date: '上线日期',
  shift: '班次',
  volume: '体积',
  id: '系统破平',
  due: '交期',
  urgent: '加急',
  fillRate: '装柜率',
};

const DATE_LATEST = '9999-12-31';
const SHIFT_LATEST = Number.POSITIVE_INFINITY;

export interface SortPolicyValidation {
  ok: boolean;
  code?: SortPolicyErrorCode;
  message?: string;
}

export interface SortContext {
  poolById: (id: string) => StockLine | undefined;
  cabinets?: Cabinet[];
}

function isSortKeyCode(code: unknown): code is SortKeyCode {
  return SORT_KEY_CODES.includes(code as SortKeyCode);
}

function isDirection(dir: unknown): dir is SortDirection {
  return dir === 'asc' || dir === 'desc';
}

export function cloneScheduleSortPolicy(policy: ScheduleSortPolicy): ScheduleSortPolicy {
  return {
    ...policy,
    keys: policy.keys.map((k) => ({ ...k })),
  };
}

export function defaultScheduleSortPolicy(): ScheduleSortPolicy {
  return {
    id: 'default',
    name: '现行四键（默认）',
    version: 1,
    keys: [
      { code: 'date', direction: 'asc', enabled: true },
      { code: 'shift', direction: 'asc', enabled: true },
      { code: 'volume', direction: 'desc', enabled: true },
      { code: 'due', direction: 'asc', enabled: false },
      { code: 'urgent', direction: 'desc', enabled: false },
      { code: 'fillRate', direction: 'desc', enabled: false },
    ],
    nullDatePolicy: 'treatAsLatest',
    applyMode: 'nextSyncOnly',
    updatedAt: '',
  };
}

function defaultKeys(): SortKeySpec[] {
  return defaultScheduleSortPolicy().keys.map((k) => ({ ...k }));
}

function defaultSpecFor(code: SortKeyCode): SortKeySpec {
  const found = defaultKeys().find((k) => k.code === code);
  if (found) return { ...found };
  return { code, direction: 'asc', enabled: code !== 'id' };
}

export function coerceScheduleSortPolicy(raw?: unknown): ScheduleSortPolicy {
  const d = defaultScheduleSortPolicy();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Partial<ScheduleSortPolicy> & { keys?: unknown };
  const parsed: SortKeySpec[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.keys)) {
    for (const item of o.keys) {
      const row = item as Partial<SortKeySpec>;
      const code = row.code;
      if (typeof code !== 'string' || code === 'id' || seen.has(code) || !isSortKeyCode(code)) continue;
      parsed.push({
        code,
        direction: isDirection(row.direction) ? row.direction : defaultSpecFor(code).direction,
        enabled: CORE_SORT_CODES.includes(code) ? true : row.enabled === true,
      });
      seen.add(code);
    }
  }
  for (const code of USER_SORT_CODES) {
    if (!seen.has(code)) {
      parsed.push(defaultSpecFor(code));
      seen.add(code);
    }
  }
  return {
    id: typeof o.id === 'string' && o.id ? o.id : d.id,
    name: typeof o.name === 'string' && o.name ? o.name : d.name,
    version: typeof o.version === 'number' && Number.isFinite(o.version) ? o.version : d.version,
    keys: parsed.length ? parsed : defaultKeys(),
    nullDatePolicy: 'treatAsLatest',
    applyMode: 'nextSyncOnly',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : d.updatedAt,
  };
}

export function validateScheduleSortPolicy(policy: ScheduleSortPolicy): SortPolicyValidation {
  const keys = policy.keys || [];
  const enabledUser = keys.filter((k) => k.enabled && k.code !== 'id');
  if (!enabledUser.length) {
    return {
      ok: false,
      code: SORT_POLICY_ERROR_CODES.SORT_POLICY_EMPTY,
      message: '至少启用一个非系统破平键',
    };
  }
  const seen = new Set<string>();
  for (const key of keys) {
    if (!isSortKeyCode(key.code)) {
      return {
        ok: false,
        code: SORT_POLICY_ERROR_CODES.SORT_POLICY_UNKNOWN_KEY,
        message: `未知排序键：${String(key.code)}`,
      };
    }
    if (seen.has(key.code)) {
      return {
        ok: false,
        code: SORT_POLICY_ERROR_CODES.SORT_POLICY_DUP_KEY,
        message: `排序键重复：${key.code}`,
      };
    }
    seen.add(key.code);
    if (!isDirection(key.direction)) {
      return {
        ok: false,
        code: SORT_POLICY_ERROR_CODES.SORT_POLICY_BAD_DIR,
        message: `升降序无效：${String(key.direction)}`,
      };
    }
  }
  for (const code of CORE_SORT_CODES) {
    const spec = keys.find((k) => k.code === code);
    if (!spec || spec.enabled !== true) {
      return {
        ok: false,
        code: SORT_POLICY_ERROR_CODES.SORT_POLICY_CORE_DISABLED,
        message: `核心键 ${code} 不可关闭`,
      };
    }
  }
  return { ok: true };
}

export function effectiveKeys(policy: ScheduleSortPolicy): SortKeySpec[] {
  const user = (policy.keys || []).filter((k) => k.enabled && k.code !== 'id' && isSortKeyCode(k.code));
  const last = user[user.length - 1];
  if (last?.code === 'id' && last.direction === 'asc') return user;
  return user.concat([{ code: 'id', direction: 'asc', enabled: true }]);
}

export function formatEffectiveKeysPreview(policy: ScheduleSortPolicy): string {
  return effectiveKeys(policy)
    .map((k) => {
      if (k.code === 'id') return '(id)';
      return `${k.code}${k.direction === 'asc' ? '↑' : '↓'}`;
    })
    .join(' · ');
}

function sameDefaultKeys(keys: SortKeySpec[]): boolean {
  const d = defaultKeys();
  if (keys.length !== d.length) return false;
  return keys.every((k, i) => k.code === d[i]!.code && k.direction === d[i]!.direction && Boolean(k.enabled) === d[i]!.enabled);
}

export function restoreDefaultScheduleSortPolicy(previous?: ScheduleSortPolicy): ScheduleSortPolicy {
  const next = defaultScheduleSortPolicy();
  next.version = (previous?.version ?? 0) + 1;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function commitScheduleSortPolicy(
  previous: ScheduleSortPolicy,
  draft: ScheduleSortPolicy,
): { ok: true; policy: ScheduleSortPolicy } | { ok: false; code: SortPolicyErrorCode; message: string } {
  const checked = validateScheduleSortPolicy(draft);
  if (!checked.ok) {
    return {
      ok: false,
      code: checked.code || SORT_POLICY_ERROR_CODES.SORT_POLICY_EMPTY,
      message: checked.message || '排序策略无效',
    };
  }
  const ordered: SortKeySpec[] = [];
  const seen = new Set<string>();
  for (const k of draft.keys || []) {
    if (k.code === 'id' || seen.has(k.code) || !USER_SORT_CODES.includes(k.code)) continue;
    ordered.push({
      code: k.code,
      direction: k.direction,
      enabled: CORE_SORT_CODES.includes(k.code) ? true : k.enabled === true,
    });
    seen.add(k.code);
  }
  for (const code of USER_SORT_CODES) {
    if (!seen.has(code)) ordered.push(defaultSpecFor(code));
  }
  const isDefault = sameDefaultKeys(ordered);
  return {
    ok: true,
    policy: {
      id: isDefault ? 'default' : 'custom',
      name: isDefault ? '现行四键（默认）' : '自定义',
      version: (previous.version || 0) + 1,
      keys: ordered,
      nullDatePolicy: 'treatAsLatest',
      applyMode: 'nextSyncOnly',
      updatedAt: new Date().toISOString(),
    },
  };
}

export function resolveScheduleSortPolicy(config: { scheduleSortPolicy?: ScheduleSortPolicy } | undefined): ScheduleSortPolicy {
  const policy = coerceScheduleSortPolicy(config?.scheduleSortPolicy);
  const checked = validateScheduleSortPolicy(policy);
  return checked.ok ? policy : defaultScheduleSortPolicy();
}

function minDueOfContent(content: CabinetContent, poolById: (id: string) => StockLine | undefined): string | null {
  const dues = content.lines.map((id) => poolById(id)?.due).filter((d): d is string => Boolean(d));
  if (!dues.length) return null;
  return dues.slice().sort()[0] || null;
}

function hasUrgent(content: CabinetContent, poolById: (id: string) => StockLine | undefined): boolean {
  return content.lines.some((id) => poolById(id)?.urgent === true);
}

function cabinetOf(content: CabinetContent, cabinets?: Cabinet[]): Cabinet | undefined {
  return cabinets?.find((c) => c.id === content.cabinetId);
}

function dateKey(content: CabinetContent): string {
  return content.date || DATE_LATEST;
}

function shiftKey(content: CabinetContent): number {
  if (!content.date) return SHIFT_LATEST;
  if (!content.shift) return SHIFT_LATEST;
  return shiftRank(content.shift);
}

function keyValue(
  code: SortKeyCode,
  content: CabinetContent,
  ctx: SortContext,
): string | number {
  if (code === 'date') return dateKey(content);
  if (code === 'shift') return shiftKey(content);
  if (code === 'volume') return contentVol(content, ctx.poolById);
  if (code === 'id') return String(content.id);
  if (code === 'due') return minDueOfContent(content, ctx.poolById) || DATE_LATEST;
  if (code === 'urgent') return hasUrgent(content, ctx.poolById) ? 1 : 0;
  const cab = cabinetOf(content, ctx.cabinets);
  return fillRateOf(content, cab, ctx.poolById);
}

function compareValues(a: string | number, b: string | number, direction: SortDirection): number {
  if (a === b) return 0;
  let cmp: number;
  if (typeof a === 'number' && typeof b === 'number') {
    const aInf = !Number.isFinite(a);
    const bInf = !Number.isFinite(b);
    if (aInf && bInf) return 0;
    if (aInf) cmp = 1;
    else if (bInf) cmp = -1;
    else cmp = a - b;
  } else {
    cmp = String(a).localeCompare(String(b));
  }
  if (cmp === 0) return 0;
  return direction === 'desc' ? -cmp : cmp;
}

export function compareContents(
  a: CabinetContent,
  b: CabinetContent,
  policy: ScheduleSortPolicy,
  ctx: SortContext,
): number {
  for (const key of effectiveKeys(policy)) {
    const av = keyValue(key.code, a, ctx);
    const bv = keyValue(key.code, b, ctx);
    const cmp = compareValues(av, bv, key.direction);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

export function orderContents(
  contents: CabinetContent[],
  policy: ScheduleSortPolicy,
  ctx: SortContext,
): CabinetContent[] {
  const ids = new Set(contents.map((c) => c.cabinetId));
  if (ids.size > 1) {
    throw new Error('SORT_POLICY_MIXED_CABINET');
  }
  return contents.slice().sort((a, b) => compareContents(a, b, policy, ctx));
}
