import type { AppConfig, LegacyConfigInput, LoadConfig } from '../domain/entities';
import { coercePackSuggestPolicy, defaultPackSuggestPolicy } from '../domain/pack-suggest-policy';

export const STORAGE_KEY = 'zhende_sterilization_plan_v2';
export const STORAGE_KEY_LEGACY = 'zhende_sterilization_plan_v1';
export const PLAN_SEED_VERSION = 2;
export const DEMO_MIN_CABINETS = 5;
export const DEMO_MIN_LOADS = 5;
export const DEFAULT_DATE = '2026-07-24';
export const DEFAULT_SHIFT = '白班' as const;
export const DEFAULT_D002_MIN_M3 = 56;

export const CSV_HEADERS = [
  '日期',
  '班次',
  '炉次号',
  '灭菌柜',
  '基地',
  '物料行ID',
  'REF',
  '品名',
  '客户号',
  '工艺',
  '箱数',
  '单箱体积',
  '体积m³',
  '工单',
  '生产批号',
  '加急',
] as const;

export function isDemoSeedEnabled(cfg?: AppConfig): boolean {
  if (cfg && cfg.demo.enableSeed === false) return false;
  const env = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_ENABLE_DEMO_SEED : undefined;
  if (env === 'false' || env === '0') return false;
  return true;
}

function finiteNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** 读入 minLoadM3ByProcess，兼容 d002MinLoadM3 / 旧 load.d002MinM3 */
export function migrateMinLoadM3ByProcess(partial?: LegacyConfigInput | null): Record<string, number> {
  const map: Record<string, number> = { D002: DEFAULT_D002_MIN_M3 };
  const legacy =
    finiteNumber(partial?.d002MinLoadM3) ?? finiteNumber(partial?.load && (partial.load as { d002MinM3?: number }).d002MinM3);
  if (legacy != null) map.D002 = legacy;
  if (partial?.minLoadM3ByProcess) {
    for (const [code, value] of Object.entries(partial.minLoadM3ByProcess)) {
      const n = finiteNumber(value);
      if (n != null) map[code] = n;
    }
  }
  return map;
}

export function defaultAppConfig(): AppConfig {
  return {
    allowFiller: false,
    mixCustomerWarn: true,
    showPendingTags: true,
    scheduleMode: 'auto',
    overrideNotes: {},
    minLoadM3ByProcess: { D002: DEFAULT_D002_MIN_M3 },
    d002MinLoadM3: DEFAULT_D002_MIN_M3,
    cycle: {
      preheatDays: 0.5,
      sterilizeDays: 1,
      biDays: 2,
      nightSterilizeOffsetDays: 0.5,
    },
    load: {
      defaultMinM3: 60,
      loadMetric: 'grossVolume',
    },
    box: {
      /** 大箱单箱体积阈值（m³） */
      largeBoxVol: 0.12,
      /** v1.3：每炉大箱合计上限，炉总箱数不触发 BOX_LIMIT */
      maxBoxesWhenLarge: 280,
      boardsPerFurnaceHint: 30,
    },
    eligibility: {
      locations: ['待灭菌仓·老', '待灭菌仓·新'],
      stockStatuses: ['非限制'],
    },
    processMatch: { key: 'K' },
    suggest: { strategy: 'D002_CAB9_DEMO' },
    export: { blockOnError: false },
    demo: { enableSeed: true },
    fp: { defaultHorizon: 14 },
    mix: { customer: 'warn' },
    fillRateDenom: 'ratedLoadM3',
    grouping: { skipInOtherCabinet: true, defaultTrayCount: 4 },
    packSuggestPolicy: defaultPackSuggestPolicy(),
  };
}

export function mergeConfig(partial?: LegacyConfigInput | null): AppConfig {
  const base = defaultAppConfig();
  if (!partial) return base;
  const minLoadM3ByProcess = migrateMinLoadM3ByProcess(partial);
  const loadRest = { ...(partial.load ?? {}) } as Partial<LoadConfig> & { d002MinM3?: number };
  delete loadRest.d002MinM3;
  return {
    ...base,
    ...partial,
    minLoadM3ByProcess,
    d002MinLoadM3: minLoadM3ByProcess.D002 ?? base.d002MinLoadM3,
    cycle: { ...base.cycle, ...(partial.cycle ?? {}) },
    load: { ...base.load, ...loadRest },
    box: { ...base.box, ...(partial.box ?? {}) },
    eligibility: {
      locations: partial.eligibility?.locations ?? base.eligibility.locations,
      stockStatuses: partial.eligibility?.stockStatuses ?? base.eligibility.stockStatuses,
    },
    processMatch: { ...base.processMatch, ...(partial.processMatch ?? {}) },
    suggest: { ...base.suggest, ...(partial.suggest ?? {}) },
    export: { ...base.export, ...(partial.export ?? {}) },
    demo: { ...base.demo, ...(partial.demo ?? {}) },
    fp: { ...base.fp, ...(partial.fp ?? {}) },
    mix: { ...base.mix, ...(partial.mix ?? {}) },
    scheduleMode: partial.scheduleMode === 'manual' ? 'manual' : 'auto',
    overrideNotes: { ...(partial.overrideNotes ?? {}) },
    fillRateDenom: partial.fillRateDenom === 'dailyCapacityM3' ? 'dailyCapacityM3' : 'ratedLoadM3',
    grouping: {
      skipInOtherCabinet: partial.grouping?.skipInOtherCabinet !== false,
      defaultTrayCount: partial.grouping?.defaultTrayCount ?? base.grouping.defaultTrayCount,
    },
    packSuggestPolicy: coercePackSuggestPolicy(partial.packSuggestPolicy),
  };
}

/** 写出时同时带正式字段与旧字段，便于原型/旧客户端回退读取 */
export function persistableConfig(config: AppConfig): AppConfig {
  const minLoadM3ByProcess = { ...config.minLoadM3ByProcess };
  if (minLoadM3ByProcess.D002 == null && config.d002MinLoadM3 != null) {
    minLoadM3ByProcess.D002 = config.d002MinLoadM3;
  }
  return {
    ...config,
    minLoadM3ByProcess,
    d002MinLoadM3: minLoadM3ByProcess.D002 ?? config.d002MinLoadM3 ?? DEFAULT_D002_MIN_M3,
    scheduleMode: config.scheduleMode === 'manual' ? 'manual' : 'auto',
    overrideNotes: { ...(config.overrideNotes ?? {}) },
    load: {
      defaultMinM3: config.load.defaultMinM3,
      loadMetric: config.load.loadMetric,
    },
    fillRateDenom: config.fillRateDenom === 'dailyCapacityM3' ? 'dailyCapacityM3' : 'ratedLoadM3',
    grouping: {
      skipInOtherCabinet: config.grouping?.skipInOtherCabinet !== false,
      defaultTrayCount: config.grouping?.defaultTrayCount ?? 4,
    },
    packSuggestPolicy: coercePackSuggestPolicy(config.packSuggestPolicy),
  };
}
