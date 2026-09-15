import type { StockLine } from '../domain/entities';

type SeedInput = Omit<StockLine, 'vol' | 'sterilizationMethod'> & {
  sterilizationMethod?: StockLine['sterilizationMethod'];
};

function enrich(row: SeedInput): StockLine {
  return {
    ...row,
    sterilizationMethod: row.sterilizationMethod ?? 'EO',
    vol: +(row.boxes * row.boxVol).toFixed(2),
  };
}

const RAW: SeedInput[] = [
  {
    id: 'P001', factory: '3010', workshop: '制造三车间', matType: 'N', ref: 'REF-D002-A01',
    name: 'D002 敷料包 A型', customer: 'C-华润', due: '2026-07-26', wo: 'WO-3010-78421',
    boxes: 280, boxVol: 0.10, batch: 'B2026071801', loc: '待灭菌仓·老', stockStatus: '非限制',
    process: 'D002', allowed: ['柜9', '柜20'], urgent: true, suggest: '可与 P002/P003 拼',
  },
  {
    id: 'P002', factory: '3010', workshop: '制造三车间', matType: 'N', ref: 'REF-D002-A02',
    name: 'D002 敷料包 A型补货', customer: 'C-华润', due: '2026-07-27', wo: 'WO-3010-78422',
    boxes: 160, boxVol: 0.10, batch: 'B2026071802', loc: '待灭菌仓·老', stockStatus: '非限制',
    process: 'D002', allowed: ['柜9', '柜20'], urgent: false, suggest: '可与 P001 拼',
  },
  {
    id: 'P003', factory: '3010', workshop: '制造三车间', matType: 'N', ref: 'REF-D002-B01',
    name: 'D002 敷料包 B型', customer: 'C-国药', due: '2026-07-28', wo: 'WO-3010-78430',
    boxes: 120, boxVol: 0.11, batch: 'B2026071901', loc: '待灭菌仓·老', stockStatus: '非限制',
    process: 'D002', allowed: ['柜9', '柜20'], urgent: false, suggest: '可与 P001 拼',
  },
  {
    id: 'P004', factory: '3010', workshop: '制造七车间', matType: 'K', ref: 'REF-Z181-01',
    name: 'Z181 护理套装', customer: 'C-美敦力', due: '2026-07-25', wo: 'WO-3010-79101',
    boxes: 350, boxVol: 0.18, batch: 'B2026072001', loc: '待灭菌仓·新', stockStatus: '非限制',
    process: 'Z181', allowed: ['柜5', '柜7', '柜15'], urgent: true, suggest: '', oversized: true,
  },
  {
    id: 'P005', factory: '3010', workshop: '制造七车间', matType: 'N', ref: 'REF-Z051-01',
    name: 'Z051 专用包', customer: 'C-强生', due: '2026-07-29', wo: 'WO-3010-79201',
    boxes: 200, boxVol: 0.08, batch: 'B2026072101', loc: '待灭菌仓·新', stockStatus: '非限制',
    process: 'Z051', allowed: ['柜16'], urgent: false, suggest: '',
  },
  {
    id: 'P006', factory: '3010', workshop: '制造二车间', matType: 'K', ref: 'REF-YY-01',
    name: '亚澳定制手术包', customer: 'C-亚澳', due: '2026-07-30', wo: 'WO-3010-80011',
    boxes: 180, boxVol: 0.072, batch: 'B2026072105', loc: '待灭菌仓·新', stockStatus: '非限制',
    process: '亚澳', allowed: ['柜12'], urgent: false, suggest: '', pendingAllow: true,
  },
  {
    id: 'P007', factory: '3010', workshop: '制造三车间', matType: 'N', ref: 'REF-Z162-01',
    name: 'Z162 止血垫', customer: 'C-新华', due: '2026-07-26', wo: 'WO-3010-78501',
    boxes: 400, boxVol: 0.05, batch: 'B2026071701', loc: '待灭菌仓·老', stockStatus: '非限制',
    process: 'Z162', allowed: ['柜3'], urgent: false, suggest: '',
  },
  {
    id: 'P008', factory: '3010', workshop: '制造二车间', matType: 'N', ref: 'REF-HAT-01',
    name: '医用帽 标准', customer: 'C-振德内销', due: '2026-07-28', wo: 'WO-3010-80101',
    boxes: 500, boxVol: 0.032, batch: 'B2026072201', loc: '待灭菌仓·新', stockStatus: '非限制',
    process: '帽子棉垫', allowed: ['柜8', '柜13', '柜18'], urgent: false, suggest: '可与 P009 拼',
  },
  {
    id: 'P009', factory: '3010', workshop: '制造二车间', matType: 'N', ref: 'REF-PAD-01',
    name: '棉垫 大号', customer: 'C-振德内销', due: '2026-07-28', wo: 'WO-3010-80102',
    boxes: 220, boxVol: 0.095, batch: 'B2026072202', loc: '待灭菌仓·新', stockStatus: '非限制',
    process: '帽子棉垫', allowed: ['柜8', '柜13', '柜18'], urgent: false, suggest: '可与 P008 拼',
  },
  {
    id: 'P010', factory: '3010', workshop: '制造七车间', matType: 'N', ref: 'REF-DR-01',
    name: '换药包 标准型', customer: 'C-九州通', due: '2026-07-27', wo: 'WO-3010-79301',
    boxes: 300, boxVol: 0.085, batch: 'B2026072008', loc: '待灭菌仓·新', stockStatus: '非限制',
    process: '换药包', allowed: ['柜17'], urgent: false, suggest: '',
  },
  {
    id: 'P011', factory: '3010', workshop: '制造三车间', matType: 'K', ref: 'REF-P006-01',
    name: 'P006 出口套装', customer: 'C-Export-EU', due: '2026-07-31', wo: 'WO-3010-78601',
    boxes: 150, boxVol: 0.09, batch: 'B2026072301', loc: '待灭菌仓·新', stockStatus: '非限制',
    process: 'P006', allowed: ['柜12', '柜20'], urgent: true, suggest: '',
  },
  {
    id: 'P012', factory: '3010', workshop: '制造七车间', matType: 'N', ref: 'REF-P252-01',
    name: 'P252 专科包', customer: 'C-威高', due: '2026-07-29', wo: 'WO-3010-79401',
    boxes: 100, boxVol: 0.12, batch: 'B2026072109', loc: '待灭菌仓·新', stockStatus: '非限制',
    process: 'P252', allowed: ['柜14'], urgent: false, suggest: '',
  },
  {
    id: 'P013', factory: '3010', workshop: '制造二车间', matType: 'K', ref: 'REF-GOWN-01',
    name: '二车间手术衣 XL', customer: 'C-新华', due: '2026-07-26', wo: 'WO-3010-80201',
    boxes: 200, boxVol: 0.135, batch: 'B2026071905', loc: '待灭菌仓·老', stockStatus: '非限制',
    process: '手术衣', allowed: ['柜8'], urgent: false, suggest: '',
  },
  {
    id: 'P014', factory: '3010', workshop: '制造三车间', matType: 'N', ref: 'REF-EO-01',
    name: '通用 EO 耗材包', customer: 'C-地方医院', due: '2026-07-30', wo: 'WO-3010-78701',
    boxes: 180, boxVol: 0.06, batch: 'B2026072305', loc: '待灭菌仓·新', stockStatus: '非限制',
    process: 'EO通用', allowed: ['柜4', '柜6', '柜7', '柜9', '柜11', '柜14', '柜19', '柜20', '柜21'],
    urgent: false, suggest: '', useCab21: true,
  },
  {
    id: 'P015', factory: '3010', workshop: '制造三车间', matType: 'N', ref: 'REF-HOLD-01',
    name: '限制库存样例（不可排）', customer: 'C-演示', due: '2026-07-30', wo: 'WO-3010-00000',
    boxes: 10, boxVol: 0.05, batch: 'B2026070000', loc: '待灭菌仓·老', stockStatus: '限制',
    process: 'EO通用', allowed: ['柜9'], urgent: false, suggest: '',
  },
];

export function createSeedPool(): StockLine[] {
  return RAW.map((r) => enrich({ ...r }));
}

export const SEED_POOL: StockLine[] = createSeedPool();
