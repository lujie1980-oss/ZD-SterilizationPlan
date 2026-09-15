import type { BoxSpec } from '../domain/entities';

export const BOX_SPECS: BoxSpec[] = [
  { id: 'BS001', sku: 'N100234', name: '外科口罩 50pcs', vol: 0.048, note: '' },
  { id: 'BS002', sku: 'N100567', name: '换药包 标准型', vol: 0.085, note: '' },
  { id: 'BS003', sku: 'K200112', name: '手术衣 XL', vol: 0.135, note: '大箱：合计≤280箱/炉' },
  { id: 'BS004', sku: 'N100890', name: '医用帽 100pcs', vol: 0.032, note: '' },
  { id: 'BS005', sku: 'K200445', name: '棉垫 大号', vol: 0.095, note: '' },
  { id: 'BS006', sku: 'N101001', name: 'D002 敷料包 A', vol: 0.110, note: 'D002 系列' },
  { id: 'BS007', sku: 'N101002', name: 'D002 敷料包 B', vol: 0.125, note: '≥0.12' },
  { id: 'BS008', sku: 'P300078', name: '亚澳定制包', vol: 0.072, note: '' },
];

export const BOX_SPEC_CONCEPT_COUNT = 441;
