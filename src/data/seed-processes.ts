import type { Process } from '../domain/entities';

export const PROCESSES: Process[] = [
  {
    code: 'D002',
    name: 'D002 环氧乙烷灭菌',
    cabinets: ['柜9', '柜20'],
    aerateDays: 2,
    aerateConfirmed: true,
    pending: false,
    note: '最低拼载 56m³',
    minLoadM3: 56,
  },
  {
    code: 'Z181',
    name: 'Z181',
    cabinets: ['柜5', '柜7', '柜15'],
    aerateDays: 1,
    aerateConfirmed: true,
    pending: false,
    note: '',
  },
  {
    code: 'Z051',
    name: 'Z051',
    cabinets: ['柜16'],
    aerateDays: 1,
    aerateConfirmed: true,
    pending: false,
    note: '',
  },
  {
    code: '亚澳',
    name: '亚澳工艺',
    cabinets: ['柜12'],
    aerateDays: 2,
    aerateConfirmed: false,
    pending: true,
    note: '模板另有 10#/12# · 待确认',
  },
  {
    code: 'Z162',
    name: 'Z162',
    cabinets: ['柜3'],
    aerateDays: 1,
    aerateConfirmed: true,
    pending: false,
    note: '',
  },
  {
    code: '帽子棉垫',
    name: '帽子/棉垫',
    cabinets: ['柜8', '柜13', '柜18'],
    aerateDays: 1,
    aerateConfirmed: true,
    pending: false,
    note: '',
  },
  {
    code: '换药包',
    name: '换药包',
    cabinets: ['柜17'],
    aerateDays: 1,
    aerateConfirmed: true,
    pending: false,
    note: '',
  },
  {
    code: 'P006',
    name: 'P006',
    cabinets: ['柜12', '柜20'],
    aerateDays: 2,
    aerateConfirmed: false,
    pending: false,
    note: '',
  },
  {
    code: 'P252',
    name: 'P252',
    cabinets: ['柜14'],
    aerateDays: 2,
    aerateConfirmed: false,
    pending: false,
    note: '',
  },
  {
    code: '手术衣',
    name: '二车间手术衣',
    cabinets: ['柜8'],
    aerateDays: 1,
    aerateConfirmed: true,
    pending: false,
    note: '',
  },
  {
    code: 'EO通用',
    name: 'Generic EO 1#',
    cabinets: ['柜4', '柜6', '柜7', '柜9', '柜11', '柜14', '柜19', '柜20', '柜21'],
    aerateDays: 1,
    aerateConfirmed: false,
    pending: true,
    note: '示例允许柜列表 · 待确认',
  },
];

export function processByCode(code: string): Process | undefined {
  return PROCESSES.find((p) => p.code === code);
}

export function aerateInfo(
  processCode: string,
  processes: Process[] = PROCESSES,
): { days: number; pending: boolean } {
  const hit = processes.find((p) => p.code === processCode);
  if (hit) return { days: hit.aerateDays, pending: !hit.aerateConfirmed };
  return { days: 1, pending: true };
}
