import type { Cabinet } from '../domain/entities';

export const CABINETS: Cabinet[] = [
  { id: '柜1', base: '老', capacity: 40, status: '报废', note: '报废不可选', tags: [] },
  { id: '柜3', base: '老', capacity: 80, status: '可用', note: 'Z162 指定', tags: ['Z162'] },
  { id: '柜5', base: '老', capacity: 80, status: '可用', note: '', tags: ['Z181'] },
  { id: '柜7', base: '老', capacity: 80, status: '可用', note: '', tags: ['Z181'] },
  { id: '柜8', base: '老', capacity: 90, status: '可用', note: '二车间手术衣', tags: ['手术衣'] },
  { id: '柜9', base: '老', capacity: 100, status: '可用', note: 'D002 指定', tags: ['D002'] },
  { id: '柜10', base: '老', capacity: 80, status: '可用', note: '', tags: [] },
  { id: '柜11', base: '新', capacity: 90, status: '可用', note: '', tags: [] },
  { id: '柜12', base: '新', capacity: 100, status: '可用', note: '亚澳/P006', tags: ['亚澳', 'P006'] },
  { id: '柜13', base: '新', capacity: 80, status: '可用', note: '帽子棉垫', tags: ['帽子棉垫'] },
  { id: '柜14', base: '新', capacity: 90, status: '可用', note: 'P252', tags: ['P252'] },
  { id: '柜15', base: '新', capacity: 80, status: '可用', note: '', tags: ['Z181'] },
  { id: '柜16', base: '新', capacity: 85, status: '可用', note: 'Z051', tags: ['Z051'] },
  { id: '柜17', base: '新', capacity: 80, status: '可用', note: '换药包', tags: ['换药包'] },
  { id: '柜18', base: '新', capacity: 75, status: '可用', note: '帽子棉垫', tags: ['帽子棉垫'] },
  { id: '柜19', base: '新', capacity: 90, status: '可用', note: '', tags: [] },
  { id: '柜20', base: '新', capacity: 100, status: '可用', note: 'D002/P006', tags: ['D002', 'P006'] },
  { id: '柜21', base: '新', capacity: 90, status: '待确认', note: '未进产能主数据', tags: ['待确认'], pending: true },
];

export function cabinetById(id: string): Cabinet | undefined {
  return CABINETS.find((c) => c.id === id);
}

export function usableCabinets(): Cabinet[] {
  return CABINETS.filter((c) => c.status !== '报废');
}

export function candidateCabinets(allowed: string[]): Cabinet[] {
  return usableCabinets().filter((c) => allowed.includes(c.id));
}
