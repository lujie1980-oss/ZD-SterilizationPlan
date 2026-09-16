import type { Cabinet, Tray } from '../domain/entities';

function canonicalIdFromDisplay(id: string): string {
  return `cab-${id.replace(/^柜/, '')}`;
}

function enrichCabinet(
  row: Omit<Cabinet, 'canonicalId' | 'displayCode' | 'ratedLoadM3'> & {
    canonicalId?: string;
    displayCode?: string;
    ratedLoadM3?: number;
  },
): Cabinet {
  const displayCode = row.displayCode ?? row.id;
  const canonicalId = row.canonicalId ?? canonicalIdFromDisplay(row.id);
  const ratedLoadM3 = row.ratedLoadM3 ?? row.capacity;
  return {
    ...row,
    canonicalId,
    displayCode,
    ratedLoadM3,
    dailyCapacityM3: row.dailyCapacityM3 ?? row.capacity,
    maxTrayCount: row.maxTrayCount ?? (ratedLoadM3 >= 100 ? 5 : 4),
  };
}

export const CABINETS: Cabinet[] = [
  enrichCabinet({ id: '柜1', base: '老', capacity: 40, status: '报废', note: '报废不可选', tags: [] }),
  enrichCabinet({ id: '柜3', base: '老', capacity: 80, status: '可用', note: 'Z162 指定', tags: ['Z162'] }),
  enrichCabinet({ id: '柜5', base: '老', capacity: 80, status: '可用', note: '', tags: ['Z181'] }),
  enrichCabinet({ id: '柜7', base: '老', capacity: 80, status: '可用', note: '', tags: ['Z181'] }),
  enrichCabinet({ id: '柜8', base: '老', capacity: 90, status: '可用', note: '二车间手术衣', tags: ['手术衣'] }),
  enrichCabinet({ id: '柜9', base: '老', capacity: 100, status: '可用', note: 'D002 指定', tags: ['D002'] }),
  enrichCabinet({ id: '柜10', base: '老', capacity: 80, status: '可用', note: '', tags: [] }),
  enrichCabinet({ id: '柜11', base: '新', capacity: 90, status: '可用', note: '', tags: [] }),
  enrichCabinet({ id: '柜12', base: '新', capacity: 100, status: '可用', note: '亚澳/P006', tags: ['亚澳', 'P006'] }),
  enrichCabinet({ id: '柜13', base: '新', capacity: 80, status: '可用', note: '帽子棉垫', tags: ['帽子棉垫'] }),
  enrichCabinet({ id: '柜14', base: '新', capacity: 90, status: '可用', note: 'P252', tags: ['P252'] }),
  enrichCabinet({ id: '柜15', base: '新', capacity: 80, status: '可用', note: '', tags: ['Z181'] }),
  enrichCabinet({ id: '柜16', base: '新', capacity: 85, status: '可用', note: 'Z051', tags: ['Z051'] }),
  enrichCabinet({ id: '柜17', base: '新', capacity: 80, status: '可用', note: '换药包', tags: ['换药包'] }),
  enrichCabinet({ id: '柜18', base: '新', capacity: 75, status: '可用', note: '帽子棉垫', tags: ['帽子棉垫'] }),
  enrichCabinet({ id: '柜19', base: '新', capacity: 90, status: '可用', note: '', tags: [] }),
  enrichCabinet({ id: '柜20', base: '新', capacity: 100, status: '可用', note: 'D002/P006', tags: ['D002', 'P006'] }),
  enrichCabinet({ id: '柜21', base: '新', capacity: 90, status: '待确认', note: '未进产能主数据', tags: ['待确认'], pending: true }),
];

function buildTrays(cabinets: Cabinet[]): Tray[] {
  const trays: Tray[] = [];
  for (const cab of cabinets) {
    const n = cab.maxTrayCount ?? 4;
    for (let i = 1; i <= n; i++) {
      trays.push({
        id: `${cab.canonicalId}-tray-${String(i).padStart(2, '0')}`,
        cabinetId: cab.id,
        level: i,
        displayName: `第${i}层托盘`,
        ratedLoadM3: +(cab.ratedLoadM3 / n).toFixed(2),
        status: '可用',
      });
    }
  }
  return trays;
}

export const TRAYS: Tray[] = buildTrays(CABINETS);

export function cabinetById(id: string): Cabinet | undefined {
  return CABINETS.find((c) => c.id === id || c.canonicalId === id || c.displayCode === id);
}

export function traysForCabinet(cabinetId: string): Tray[] {
  const cab = cabinetById(cabinetId);
  const id = cab?.id ?? cabinetId;
  return TRAYS.filter((t) => t.cabinetId === id && t.status === '可用').sort((a, b) => a.level - b.level);
}

export function usableCabinets(): Cabinet[] {
  return CABINETS.filter((c) => c.status !== '报废');
}

export function candidateCabinets(allowed: string[]): Cabinet[] {
  return usableCabinets().filter((c) => allowed.includes(c.id) || allowed.includes(c.displayCode) || allowed.includes(c.canonicalId));
}
