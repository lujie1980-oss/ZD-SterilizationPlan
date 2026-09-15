import type { AppConfig } from '../domain/entities';

export const STORAGE_KEY = 'zhende_sterilization_plan_v2';
export const STORAGE_KEY_LEGACY = 'zhende_sterilization_plan_v1';
export const PLAN_SEED_VERSION = 2;
export const DEMO_MIN_CABINETS = 5;
export const DEMO_MIN_LOADS = 5;
export const DEFAULT_DATE = '2026-07-24';
export const DEFAULT_SHIFT = '白班' as const;

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

export function defaultAppConfig(): AppConfig {
  return {
    allowFiller: false,
    mixCustomerWarn: true,
    showPendingTags: true,
    cycle: {
      preheatDays: 0.5,
      sterilizeDays: 1,
      biDays: 2,
      nightSterilizeOffsetDays: 0.5,
    },
    load: {
      d002MinM3: 56,
      defaultMinM3: 60,
      loadMetric: 'grossVolume',
    },
    box: {
      largeBoxVol: 0.12,
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
  };
}

export function mergeConfig(partial?: Partial<AppConfig> | null): AppConfig {
  const base = defaultAppConfig();
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    cycle: { ...base.cycle, ...(partial.cycle ?? {}) },
    load: { ...base.load, ...(partial.load ?? {}) },
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
  };
}
