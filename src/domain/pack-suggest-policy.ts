import { dayOffset } from './dates';
import type {
  Cabinet,
  CabinetContent,
  FillMode,
  PackDimensionCode,
  PackDimensionSpec,
  PackPolicyErrorCode,
  PackSuggestPolicy,
  PackSuggestPreset,
  StockLine,
} from './entities';
import { PACK_POLICY_ERROR_CODES } from './entities';
import { contentVol } from './cabinet-content';

export const PACK_DIMENSION_CODES: PackDimensionCode[] = ['gapMin', 'targetFill', 'dueCluster'];

export const PACK_DIM_LABELS: Record<PackDimensionCode, string> = {
  gapMin: '缺口最小',
  targetFill: '目标装柜率',
  dueCluster: '交期簇',
};

export const PACK_PRESET_LABELS: Record<PackSuggestPreset, string> = {
  fillFirst: '填满优先',
  dueCluster: '交期簇优先',
  balanced: '多柜均衡',
  custom: '自定义',
};

/** 已开柜偏置量级：须压过普通维分差 */
export const BIAS_OPEN = 1e6;

export const TARGET_FILL_RATE_MIN = 0.7;
export const TARGET_FILL_RATE_MAX = 0.95;
export const DUE_WINDOW_MIN = 1;
export const DUE_WINDOW_MAX = 14;

export interface PackPolicyValidation {
  ok: boolean;
  code?: PackPolicyErrorCode;
  message?: string;
}

const FILL_MODES: FillMode[] = ['fillOneFirst', 'balanceAcrossCabinets'];

function isPackDimensionCode(code: unknown): code is PackDimensionCode {
  return PACK_DIMENSION_CODES.includes(code as PackDimensionCode);
}

export function clonePackSuggestPolicy(policy: PackSuggestPolicy): PackSuggestPolicy {
  return {
    ...policy,
    dimensions: policy.dimensions.map((d) => ({ ...d })),
  };
}

export function defaultPackSuggestPolicy(): PackSuggestPolicy {
  return {
    id: 'default',
    name: '填满优先（默认）',
    version: 1,
    preset: 'fillFirst',
    fillMode: 'fillOneFirst',
    targetFillRate: 0.8,
    dueWindowDays: 3,
    dimensions: [
      { code: 'gapMin', enabled: true },
      { code: 'targetFill', enabled: true },
      { code: 'dueCluster', enabled: false },
    ],
    applyMode: 'nextAutoPackOnly',
    updatedAt: '',
  };
}

function defaultDimensions(): PackDimensionSpec[] {
  return defaultPackSuggestPolicy().dimensions.map((d) => ({ ...d }));
}

export function coercePackSuggestPolicy(raw?: unknown): PackSuggestPolicy {
  const d = defaultPackSuggestPolicy();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Partial<PackSuggestPolicy> & { dimensions?: unknown };
  const dimensions = Array.isArray(o.dimensions)
    ? o.dimensions.map((item) => {
        const row = item as Partial<PackDimensionSpec>;
        return {
          code: (row.code as PackDimensionCode) || 'gapMin',
          enabled: row.enabled !== false,
        };
      })
    : defaultDimensions();
  const fillMode = o.fillMode as FillMode | undefined;
  const preset = o.preset as PackSuggestPreset | undefined;
  const rate = typeof o.targetFillRate === 'number' ? o.targetFillRate : d.targetFillRate;
  const windowDays = typeof o.dueWindowDays === 'number' ? o.dueWindowDays : d.dueWindowDays;
  return {
    id: typeof o.id === 'string' && o.id ? o.id : d.id,
    name: typeof o.name === 'string' && o.name ? o.name : d.name,
    version: typeof o.version === 'number' && Number.isFinite(o.version) ? o.version : d.version,
    preset: preset === 'dueCluster' || preset === 'balanced' || preset === 'custom' || preset === 'fillFirst' ? preset : d.preset,
    fillMode: fillMode === 'balanceAcrossCabinets' || fillMode === 'fillOneFirst' ? fillMode : d.fillMode,
    targetFillRate: Number.isFinite(rate) ? rate : d.targetFillRate,
    dueWindowDays: Number.isFinite(windowDays) ? windowDays : d.dueWindowDays,
    dimensions: dimensions.length ? dimensions : defaultDimensions(),
    applyMode: 'nextAutoPackOnly',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : d.updatedAt,
  };
}

export function validatePackSuggestPolicy(policy: PackSuggestPolicy): PackPolicyValidation {
  if (!FILL_MODES.includes(policy.fillMode)) {
    return {
      ok: false,
      code: PACK_POLICY_ERROR_CODES.PACK_POLICY_BAD_FILL_MODE,
      message: '填满模式无效（须为先填满一台或多柜均衡）',
    };
  }
  const rate = policy.targetFillRate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < TARGET_FILL_RATE_MIN - 1e-9 || rate > TARGET_FILL_RATE_MAX + 1e-9) {
    return {
      ok: false,
      code: PACK_POLICY_ERROR_CODES.PACK_POLICY_BAD_FILL_RATE,
      message: '目标装柜率须在 70%～95%',
    };
  }
  const days = policy.dueWindowDays;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < DUE_WINDOW_MIN || days > DUE_WINDOW_MAX) {
    return {
      ok: false,
      code: PACK_POLICY_ERROR_CODES.PACK_POLICY_BAD_DUE_WINDOW,
      message: '交期窗口须为 1～14 天的整数',
    };
  }
  const dims = policy.dimensions || [];
  if (!dims.length || dims.every((d) => !d.enabled)) {
    return {
      ok: false,
      code: PACK_POLICY_ERROR_CODES.PACK_POLICY_EMPTY_DIM,
      message: '至少启用一个策略维度',
    };
  }
  const seen = new Set<string>();
  for (const dim of dims) {
    if (!isPackDimensionCode(dim.code)) {
      return {
        ok: false,
        code: PACK_POLICY_ERROR_CODES.PACK_POLICY_UNKNOWN_DIM,
        message: `未知策略维度：${String(dim.code)}`,
      };
    }
    if (seen.has(dim.code)) {
      return {
        ok: false,
        code: PACK_POLICY_ERROR_CODES.PACK_POLICY_DUP_DIM,
        message: `策略维度重复：${dim.code}`,
      };
    }
    seen.add(dim.code);
  }
  return { ok: true };
}

export function enabledDimensions(policy: PackSuggestPolicy): PackDimensionSpec[] {
  return (policy.dimensions || []).filter((d) => d.enabled && isPackDimensionCode(d.code));
}

function sameDimOrder(policy: PackSuggestPolicy, codes: PackDimensionCode[]): boolean {
  const got = policy.dimensions.map((d) => d.code);
  if (got.length !== codes.length) return false;
  return codes.every((c, i) => got[i] === c);
}

export function detectPackPreset(policy: PackSuggestPolicy): PackSuggestPreset {
  const due = policy.dimensions.find((d) => d.code === 'dueCluster');
  const dueOn = Boolean(due?.enabled);
  const rateOk = Math.abs(policy.targetFillRate - 0.8) < 1e-9;
  const winOk = policy.dueWindowDays === 3;
  if (!rateOk || !winOk) return 'custom';
  if (policy.fillMode === 'fillOneFirst' && sameDimOrder(policy, ['gapMin', 'targetFill', 'dueCluster']) && !dueOn) {
    return 'fillFirst';
  }
  if (policy.fillMode === 'fillOneFirst' && sameDimOrder(policy, ['dueCluster', 'gapMin', 'targetFill']) && dueOn) {
    return 'dueCluster';
  }
  if (policy.fillMode === 'balanceAcrossCabinets' && sameDimOrder(policy, ['gapMin', 'targetFill', 'dueCluster']) && !dueOn) {
    return 'balanced';
  }
  return 'custom';
}

export function policyFromPreset(preset: Exclude<PackSuggestPreset, 'custom'>, previous?: PackSuggestPolicy): PackSuggestPolicy {
  const version = previous?.version ?? 1;
  const updatedAt = previous?.updatedAt ?? '';
  if (preset === 'dueCluster') {
    return {
      id: 'due-cluster',
      name: '交期簇优先',
      version,
      preset: 'dueCluster',
      fillMode: 'fillOneFirst',
      targetFillRate: 0.8,
      dueWindowDays: previous?.dueWindowDays && previous.dueWindowDays >= 1 ? previous.dueWindowDays : 3,
      dimensions: [
        { code: 'dueCluster', enabled: true },
        { code: 'gapMin', enabled: true },
        { code: 'targetFill', enabled: true },
      ],
      applyMode: 'nextAutoPackOnly',
      updatedAt,
    };
  }
  if (preset === 'balanced') {
    return {
      id: 'balanced',
      name: '多柜均衡',
      version,
      preset: 'balanced',
      fillMode: 'balanceAcrossCabinets',
      targetFillRate: 0.8,
      dueWindowDays: 3,
      dimensions: [
        { code: 'gapMin', enabled: true },
        { code: 'targetFill', enabled: true },
        { code: 'dueCluster', enabled: false },
      ],
      applyMode: 'nextAutoPackOnly',
      updatedAt,
    };
  }
  return {
    id: 'fill-first',
    name: '填满优先',
    version,
    preset: 'fillFirst',
    fillMode: 'fillOneFirst',
    targetFillRate: 0.8,
    dueWindowDays: 3,
    dimensions: [
      { code: 'gapMin', enabled: true },
      { code: 'targetFill', enabled: true },
      { code: 'dueCluster', enabled: false },
    ],
    applyMode: 'nextAutoPackOnly',
    updatedAt,
  };
}

export function restoreDefaultPackSuggestPolicy(previous?: PackSuggestPolicy): PackSuggestPolicy {
  const next = defaultPackSuggestPolicy();
  next.version = (previous?.version ?? 0) + 1;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function commitPackSuggestPolicy(
  previous: PackSuggestPolicy,
  draft: PackSuggestPolicy,
): { ok: true; policy: PackSuggestPolicy } | { ok: false; code: PackPolicyErrorCode; message: string } {
  const checked = validatePackSuggestPolicy(draft);
  if (!checked.ok) {
    return {
      ok: false,
      code: checked.code || PACK_POLICY_ERROR_CODES.PACK_POLICY_EMPTY_DIM,
      message: checked.message || '策略配置无效',
    };
  }
  const normalized = coercePackSuggestPolicy(draft);
  normalized.fillMode = draft.fillMode;
  normalized.targetFillRate = draft.targetFillRate;
  normalized.dueWindowDays = draft.dueWindowDays;
  normalized.dimensions = draft.dimensions.map((d) => ({ ...d }));
  const preset = draft.preset === 'custom' ? 'custom' : detectPackPreset(normalized);
  return {
    ok: true,
    policy: {
      ...normalized,
      preset,
      id: preset === 'custom' ? 'custom' : normalized.id,
      name: preset === 'custom' ? '自定义' : normalized.name,
      version: (previous.version || 0) + 1,
      updatedAt: new Date().toISOString(),
      applyMode: 'nextAutoPackOnly',
    },
  };
}

export function resolvePackSuggestPolicy(config: { packSuggestPolicy?: PackSuggestPolicy } | undefined): PackSuggestPolicy {
  const policy = coercePackSuggestPolicy(config?.packSuggestPolicy);
  const checked = validatePackSuggestPolicy(policy);
  return checked.ok ? policy : defaultPackSuggestPolicy();
}

export function absDueDays(a: string, b: string): number {
  return Math.abs(Math.round(dayOffset(a, b)));
}

export function cabinetFillRate(loadedVol: number, rated: number): number {
  if (rated <= 0) return 0;
  return loadedVol / rated;
}

export function loadedVolumeOf(
  content: CabinetContent | undefined,
  poolById: (id: string) => StockLine | undefined,
): number {
  if (!content) return 0;
  return contentVol(content, poolById);
}

export function minDueOf(lines: StockLine[]): string | null {
  const dues = lines.map((l) => l.due).filter((d): d is string => Boolean(d));
  if (!dues.length) return null;
  return dues.slice().sort()[0] || null;
}

export function dimensionScore(opts: {
  code: PackDimensionCode;
  cabinet: Cabinet;
  line: StockLine;
  loadedVol: number;
  loadedLines: StockLine[];
  policy: PackSuggestPolicy;
}): number {
  const R = opts.cabinet.ratedLoadM3 || opts.cabinet.capacity || 0;
  const L = opts.loadedVol;
  const v = opts.line.vol || 0;
  if (R <= 0) return Number.NEGATIVE_INFINITY;
  if (L + v > R + 1e-9) return Number.NEGATIVE_INFINITY;
  if (opts.code === 'gapMin') {
    const remain = R - L - v;
    return -Math.abs(remain);
  }
  if (opts.code === 'targetFill') {
    const fill = (L + v) / R;
    const T = opts.policy.targetFillRate;
    if (T <= 0) return fill;
    return fill >= T - 1e-12 ? 1 + (fill - T) : fill / T;
  }
  if (!opts.line.due) return 0;
  if (!opts.loadedLines.length) return 1;
  const anchor = minDueOf(opts.loadedLines);
  if (!anchor) return 1;
  const days = absDueDays(opts.line.due, anchor);
  if (days <= opts.policy.dueWindowDays) return 1;
  return 1 / (1 + days);
}

export function fillModeCabinetRank(opts: {
  fillMode: FillMode;
  loadedVol: number;
  rated: number;
  lineVol: number;
  targetFillRate: number;
}): number {
  const { fillMode, loadedVol, rated, lineVol, targetFillRate } = opts;
  if (loadedVol + lineVol > rated + 1e-9) return Number.NEGATIVE_INFINITY;
  if (fillMode === 'balanceAcrossCabinets') {
    return rated - loadedVol;
  }
  const fill = cabinetFillRate(loadedVol, rated);
  const continuable = loadedVol > 1e-9 && fill < targetFillRate - 1e-12;
  if (continuable) return BIAS_OPEN * 2;
  if (loadedVol <= 1e-9) return BIAS_OPEN;
  return 0;
}

export function scoreVectorForLine(opts: {
  cabinet: Cabinet;
  line: StockLine;
  loadedVol: number;
  loadedLines: StockLine[];
  policy: PackSuggestPolicy;
  includeFillMode: boolean;
}): number[] {
  const R = opts.cabinet.ratedLoadM3 || opts.cabinet.capacity || 0;
  const vec: number[] = [];
  if (opts.includeFillMode) {
    vec.push(
      fillModeCabinetRank({
        fillMode: opts.policy.fillMode,
        loadedVol: opts.loadedVol,
        rated: R,
        lineVol: opts.line.vol || 0,
        targetFillRate: opts.policy.targetFillRate,
      }),
    );
  } else if (opts.policy.fillMode === 'fillOneFirst') {
    const fillAfter = cabinetFillRate(opts.loadedVol + (opts.line.vol || 0), R);
    vec.push(fillAfter >= opts.policy.targetFillRate - 1e-12 ? 1 : 0);
  }
  for (const dim of enabledDimensions(opts.policy)) {
    vec.push(
      dimensionScore({
        code: dim.code,
        cabinet: opts.cabinet,
        line: opts.line,
        loadedVol: opts.loadedVol,
        loadedLines: opts.loadedLines,
        policy: opts.policy,
      }),
    );
  }
  return vec;
}

/** 更高更好；全相等返回 0 */
export function compareScoreKeys(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    const aInf = !Number.isFinite(av);
    const bInf = !Number.isFinite(bv);
    if (aInf && bInf) continue;
    if (aInf) return 1;
    if (bInf) return -1;
    if (av === bv) continue;
    return bv - av;
  }
  return 0;
}

export function pickBestLineForCabinet(opts: {
  cabinet: Cabinet;
  lines: StockLine[];
  loadedVol: number;
  loadedLines: StockLine[];
  policy: PackSuggestPolicy;
}): StockLine | null {
  let best: StockLine | null = null;
  let bestKey: number[] | null = null;
  for (const line of opts.lines) {
    const key = scoreVectorForLine({
      cabinet: opts.cabinet,
      line,
      loadedVol: opts.loadedVol,
      loadedLines: opts.loadedLines,
      policy: opts.policy,
      includeFillMode: false,
    });
    if (key.some((n) => !Number.isFinite(n))) continue;
    if (!best || !bestKey) {
      best = line;
      bestKey = key;
      continue;
    }
    const cmp = compareScoreKeys(key, bestKey);
    if (cmp < 0 || (cmp === 0 && line.id.localeCompare(best.id) < 0)) {
      best = line;
      bestKey = key;
    }
  }
  return best;
}

export function pickBestCabinetForLine(opts: {
  line: StockLine;
  cabinets: Cabinet[];
  loadedVolOf: (cabinetId: string) => number;
  loadedLinesOf: (cabinetId: string) => StockLine[];
  policy: PackSuggestPolicy;
}): Cabinet | null {
  let best: Cabinet | null = null;
  let bestKey: number[] | null = null;
  for (const cabinet of opts.cabinets) {
    const loadedVol = opts.loadedVolOf(cabinet.id);
    const key = scoreVectorForLine({
      cabinet,
      line: opts.line,
      loadedVol,
      loadedLines: opts.loadedLinesOf(cabinet.id),
      policy: opts.policy,
      includeFillMode: true,
    });
    if (key.some((n) => !Number.isFinite(n))) continue;
    if (!best || !bestKey) {
      best = cabinet;
      bestKey = key;
      continue;
    }
    const cmp = compareScoreKeys(key, bestKey);
    if (cmp < 0 || (cmp === 0 && cabinet.id.localeCompare(best.id) < 0)) {
      best = cabinet;
      bestKey = key;
    }
  }
  return best;
}

export function shouldStopFillOneFirst(fill: number, targetFillRate: number): boolean {
  return fill >= targetFillRate - 1e-12;
}
