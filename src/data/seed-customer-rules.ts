import type { CustomerRule } from '../domain/entities';
import { SEED_POOL } from './seed-pool';

export function seedCustomerRules(): CustomerRule[] {
  const map = new Map<string, Set<string>>();
  for (const line of SEED_POOL) {
    let set = map.get(line.customer);
    if (!set) {
      set = new Set();
      map.set(line.customer, set);
    }
    for (const cab of line.allowed) set.add(cab);
  }
  return [...map.entries()].map(([customerId, cabs]) => ({
    customerId,
    designatedCabinets: [...cabs],
    mixPolicy: 'warn',
    note: '',
  }));
}

export const CUSTOMER_RULES: CustomerRule[] = seedCustomerRules();
