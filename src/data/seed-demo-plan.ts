import type { FurnaceRun } from '../domain/entities';

/** 演示组柜种子 · 一柜一份未排 Content（date/shift=null）；甘特同步后才写回上线日期 */
export function getDemoFurnaceSeed(): Array<Pick<FurnaceRun, 'cabinetId' | 'lines'> & { date?: null; shift?: null }> {
  return [
    { cabinetId: '柜9', date: null, shift: null, lines: ['P001', 'P002'] },
    { cabinetId: '柜20', date: null, shift: null, lines: ['P003'] },
    { cabinetId: '柜8', date: null, shift: null, lines: ['P013'] },
    { cabinetId: '柜12', date: null, shift: null, lines: ['P006', 'P011'] },
    { cabinetId: '柜21', date: null, shift: null, lines: ['P014'] },
    { cabinetId: '柜3', date: null, shift: null, lines: ['P007'] },
    { cabinetId: '柜5', date: null, shift: null, lines: ['P004'] },
    { cabinetId: '柜16', date: null, shift: null, lines: ['P005'] },
    { cabinetId: '柜17', date: null, shift: null, lines: ['P010'] },
    { cabinetId: '柜14', date: null, shift: null, lines: ['P012'] },
    { cabinetId: '柜13', date: null, shift: null, lines: ['P008'] },
    { cabinetId: '柜18', date: null, shift: null, lines: ['P009'] },
  ];
}
