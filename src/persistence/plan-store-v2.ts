import {
  DEMO_MIN_CABINETS,
  DEMO_MIN_LOADS,
  PLAN_SEED_VERSION,
  STORAGE_KEY,
  STORAGE_KEY_LEGACY,
  defaultAppConfig,
  isDemoSeedEnabled,
  mergeConfig,
  persistableConfig,
} from '../data/config-defaults';
import type { AppConfig, FurnaceRun, PlanSnapshot, Shift, StockLine } from '../domain/entities';
import { isPlanSparse } from '../domain/pool';
import { ensureSplitFurnaces } from '../domain/split-wizard';

export interface LoadedPlan {
  date: string;
  shift: Shift;
  furnaces: FurnaceRun[];
  nextFurnaceSeq: number;
  virtualLines: StockLine[];
  config: AppConfig;
  planSeedVersion: number;
  sparseWiped: boolean;
}

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota */
  }
}

function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function serializePlan(plan: LoadedPlan): PlanSnapshot {
  return {
    version: PLAN_SEED_VERSION,
    date: plan.date,
    shift: plan.shift,
    furnaces: plan.furnaces,
    nextFurnaceSeq: plan.nextFurnaceSeq,
    virtualLines: plan.virtualLines,
    config: persistableConfig(plan.config),
    planSeedVersion: plan.planSeedVersion,
  };
}

export function savePlan(plan: LoadedPlan): void {
  writeItem(STORAGE_KEY, JSON.stringify(serializePlan(plan)));
}

export function parseSnapshot(raw: string): PlanSnapshot | null {
  try {
    const data = JSON.parse(raw) as PlanSnapshot;
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

export function loadPlan(): LoadedPlan {
  const fallback: LoadedPlan = {
    date: '2026-07-24',
    shift: '白班',
    furnaces: [],
    nextFurnaceSeq: 1,
    virtualLines: [],
    config: defaultAppConfig(),
    planSeedVersion: 0,
    sparseWiped: false,
  };

  let raw = readItem(STORAGE_KEY);
  let fromLegacy = false;
  if (!raw) {
    const legacy = readItem(STORAGE_KEY_LEGACY);
    if (legacy) {
      fromLegacy = true;
      const legacyData = parseSnapshot(legacy);
      if (legacyData && !isPlanSparse(legacyData.furnaces || [], DEMO_MIN_LOADS, DEMO_MIN_CABINETS, legacyData.virtualLines || [])) {
        raw = legacy;
      }
      removeItem(STORAGE_KEY_LEGACY);
    }
  }
  if (!raw) return fallback;

  const data = parseSnapshot(raw);
  if (!data) return fallback;

  const plan: LoadedPlan = {
    date: data.date || fallback.date,
    shift: (data.shift as Shift) || fallback.shift,
    furnaces: Array.isArray(data.furnaces) ? data.furnaces : [],
    nextFurnaceSeq: data.nextFurnaceSeq || 1,
    virtualLines: Array.isArray(data.virtualLines) ? data.virtualLines : [],
    config: mergeConfig(data.config as Partial<AppConfig>),
    planSeedVersion: data.planSeedVersion ?? data.version ?? 0,
    sparseWiped: false,
  };

  if (plan.virtualLines.length) {
    const restored = ensureSplitFurnaces(plan.furnaces, plan.virtualLines, plan.nextFurnaceSeq);
    plan.furnaces = restored.furnaces;
    plan.nextFurnaceSeq = restored.nextSeq;
  }

  if (isDemoSeedEnabled(plan.config) && isPlanSparse(plan.furnaces, DEMO_MIN_LOADS, DEMO_MIN_CABINETS, plan.virtualLines)) {
    plan.furnaces = [];
    plan.nextFurnaceSeq = 1;
    plan.planSeedVersion = 0;
    plan.sparseWiped = true;
  } else if (fromLegacy) {
    plan.planSeedVersion = PLAN_SEED_VERSION;
    savePlan(plan);
  }
  return plan;
}
