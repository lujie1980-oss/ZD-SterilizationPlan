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
import { CABINETS, TRAYS } from '../data/seed-cabinets';
import { createSeedPool } from '../data/seed-pool';
import { normalizeCabinetContent } from '../domain/cabinet-content';
import { demoRuntimeOverrides, deriveAllRuntimes } from '../domain/cabinet-runtime';
import type {
  AppConfig,
  Cabinet,
  CabinetContent,
  CabinetRuntime,
  CabinetTask,
  FurnaceRun,
  FurnaceSchedule,
  PlanSnapshot,
  Shift,
  StockLine,
  Tray,
} from '../domain/entities';
import { isPlanSparse, lookupPool, mergeVirtualLinesIntoPool } from '../domain/pool';
import { ensureSplitFurnaces } from '../domain/split-wizard';

export interface LoadedPlan {
  date: string;
  shift: Shift;
  furnaces: FurnaceRun[];
  contents?: CabinetContent[];
  tasks?: CabinetTask[];
  runtimes?: CabinetRuntime[];
  schedules?: FurnaceSchedule[];
  nextFurnaceSeq: number;
  nextTaskSeq?: number;
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

function poolLookup(virtualLines: StockLine[]): (id: string) => StockLine | undefined {
  const pool = mergeVirtualLinesIntoPool(createSeedPool(), virtualLines);
  return (id) => lookupPool(pool, virtualLines, id);
}

export function migrateContents(
  rawFurnaces: FurnaceRun[],
  rawContents: CabinetContent[] | undefined,
  virtualLines: StockLine[],
  config: AppConfig,
  master?: { cabinets?: Cabinet[]; trays?: Tray[] },
): CabinetContent[] {
  const cabinets = master?.cabinets?.length ? master.cabinets : CABINETS;
  const trays = master?.trays?.length ? master.trays : TRAYS;
  const source = Array.isArray(rawContents) && rawContents.length ? rawContents : rawFurnaces;
  const poolById = poolLookup(virtualLines);
  return (source || []).map((f) =>
    normalizeCabinetContent(
      {
        ...f,
        date: f.date ?? null,
        shift: f.shift ?? null,
      },
      {
        trayMaster: trays,
        poolById,
        largeBoxVol: config.box.largeBoxVol,
        cabinet: cabinets.find((c) => c.id === f.cabinetId),
      },
    ),
  );
}

export function serializePlan(plan: LoadedPlan): PlanSnapshot {
  const contents = plan.contents?.length ? plan.contents : plan.furnaces;
  return {
    version: PLAN_SEED_VERSION,
    date: plan.date,
    shift: plan.shift,
    furnaces: contents,
    contents,
    tasks: plan.tasks || [],
    runtimes: plan.runtimes || [],
    schedules: plan.schedules || [],
    nextFurnaceSeq: plan.nextFurnaceSeq,
    nextTaskSeq: plan.nextTaskSeq || 1,
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

export function loadPlan(master?: { cabinets?: Cabinet[]; trays?: Tray[] }): LoadedPlan {
  const fallback: LoadedPlan = {
    date: '2026-07-24',
    shift: '白班',
    furnaces: [],
    contents: [],
    tasks: [],
    runtimes: demoRuntimeOverrides(),
    schedules: [],
    nextFurnaceSeq: 1,
    nextTaskSeq: 1,
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

  const config = mergeConfig(data.config as Partial<AppConfig>);
  const virtualLines = Array.isArray(data.virtualLines) ? data.virtualLines : [];
  const cabinets = master?.cabinets?.length ? master.cabinets : CABINETS;
  let furnaces = migrateContents(
    Array.isArray(data.furnaces) ? data.furnaces : [],
    data.contents,
    virtualLines,
    config,
    master,
  );

  const plan: LoadedPlan = {
    date: data.date || fallback.date,
    shift: (data.shift as Shift) || fallback.shift,
    furnaces,
    contents: furnaces,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    runtimes: Array.isArray(data.runtimes) && data.runtimes.length ? data.runtimes : demoRuntimeOverrides(),
    schedules: Array.isArray(data.schedules) ? data.schedules : [],
    nextFurnaceSeq: data.nextFurnaceSeq || 1,
    nextTaskSeq: data.nextTaskSeq || 1,
    virtualLines,
    config,
    planSeedVersion: data.planSeedVersion ?? data.version ?? 0,
    sparseWiped: false,
  };

  if (plan.virtualLines.length) {
    const restored = ensureSplitFurnaces(plan.furnaces, plan.virtualLines, plan.nextFurnaceSeq);
    plan.furnaces = migrateContents(restored.furnaces, undefined, plan.virtualLines, plan.config, master);
    plan.contents = plan.furnaces;
    plan.nextFurnaceSeq = restored.nextSeq;
  }

  plan.runtimes = deriveAllRuntimes(cabinets, plan.contents || plan.furnaces, plan.runtimes || []);

  if (isDemoSeedEnabled(plan.config) && isPlanSparse(plan.furnaces, DEMO_MIN_LOADS, DEMO_MIN_CABINETS, plan.virtualLines)) {
    plan.furnaces = [];
    plan.contents = [];
    plan.tasks = [];
    plan.schedules = [];
    plan.nextFurnaceSeq = 1;
    plan.nextTaskSeq = 1;
    plan.planSeedVersion = 0;
    plan.sparseWiped = true;
  } else if (fromLegacy) {
    plan.planSeedVersion = PLAN_SEED_VERSION;
    savePlan(plan);
  }
  return plan;
}
