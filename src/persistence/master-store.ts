import { STORAGE_KEY_MASTER } from '../data/config-defaults';
import { BOX_SPECS } from '../data/seed-boxspecs';
import { CABINETS, TRAYS } from '../data/seed-cabinets';
import { seedCustomerRules } from '../data/seed-customer-rules';
import { PROCESSES } from '../data/seed-processes';
import type { MasterData } from '../domain/master-data-io';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function defaultMaster(): MasterData {
  return {
    cabinets: clone(CABINETS),
    trays: clone(TRAYS),
    processes: clone(PROCESSES),
    boxSpecs: clone(BOX_SPECS),
    customerRules: seedCustomerRules(),
  };
}

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function loadMaster(): MasterData {
  const fallback = defaultMaster();
  const raw = readItem(STORAGE_KEY_MASTER);
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw) as Partial<MasterData>;
    return {
      cabinets: Array.isArray(data.cabinets) ? data.cabinets : fallback.cabinets,
      trays: Array.isArray(data.trays) ? data.trays : fallback.trays,
      processes: Array.isArray(data.processes) ? data.processes : fallback.processes,
      boxSpecs: Array.isArray(data.boxSpecs) ? data.boxSpecs : fallback.boxSpecs,
      customerRules: Array.isArray(data.customerRules) ? data.customerRules : fallback.customerRules,
    };
  } catch {
    return fallback;
  }
}

export function saveMaster(data: MasterData): void {
  localStorage.setItem(STORAGE_KEY_MASTER, JSON.stringify(data));
}
