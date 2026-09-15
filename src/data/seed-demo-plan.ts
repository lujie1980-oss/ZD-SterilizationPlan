import type { FurnaceRun } from '../domain/entities';

/** 演示装炉种子 · 覆盖多柜白夜班（planSeedVersion=2） */
export function getDemoFurnaceSeed(): Array<Pick<FurnaceRun, 'cabinetId' | 'date' | 'shift' | 'lines'>> {
  return [
    { cabinetId: '柜9', date: '2026-07-24', shift: '白班', lines: ['P001'] },
    { cabinetId: '柜9', date: '2026-07-25', shift: '夜班', lines: ['P002'] },
    { cabinetId: '柜20', date: '2026-07-26', shift: '白班', lines: ['P003'] },
    { cabinetId: '柜8', date: '2026-07-24', shift: '白班', lines: ['P013'] },
    { cabinetId: '柜8', date: '2026-07-25', shift: '白班', lines: ['P008'] },
    { cabinetId: '柜8', date: '2026-07-26', shift: '夜班', lines: ['P009'] },
    { cabinetId: '柜12', date: '2026-07-25', shift: '白班', lines: ['P006'] },
    { cabinetId: '柜12', date: '2026-07-26', shift: '夜班', lines: ['P011'] },
    { cabinetId: '柜21', date: '2026-07-26', shift: '白班', lines: ['P014'] },
    { cabinetId: '柜3', date: '2026-07-24', shift: '夜班', lines: ['P007'] },
    { cabinetId: '柜5', date: '2026-07-24', shift: '白班', lines: ['P004'] },
    { cabinetId: '柜16', date: '2026-07-25', shift: '夜班', lines: ['P005'] },
    { cabinetId: '柜17', date: '2026-07-26', shift: '白班', lines: ['P010'] },
    { cabinetId: '柜14', date: '2026-07-25', shift: '白班', lines: ['P012'] },
  ];
}
