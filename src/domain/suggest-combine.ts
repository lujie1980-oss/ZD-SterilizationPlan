import type { FurnaceRun, StockLine } from './entities';
import { furnaceVol } from './pool';

export const SUGGEST_STRATEGY = 'D002_CAB9_DEMO';

export interface SuggestResult {
  ok: boolean;
  message: string;
  added: number;
  furnace?: FurnaceRun;
  createdFurnace: boolean;
}

export function suggestCombineD002Cab9(opts: {
  pool: StockLine[];
  furnaces: FurnaceRun[];
  assigned: Set<string>;
  date: string;
  shift: FurnaceRun['shift'];
  nextSeq: number;
  minLoad: number;
  poolById: (id: string) => StockLine | undefined;
}): { result: SuggestResult; furnaces: FurnaceRun[]; nextSeq: number; selectedFurnaceId?: string } {
  const d002 = opts.pool.filter((p) => p.process === 'D002' && !opts.assigned.has(p.id) && !p.splitOf);
  if (d002.length < 2) {
    return {
      result: {
        ok: false,
        message: '可拼货的 D002 行不足，请查看「拼货建议」标签',
        added: 0,
        createdFurnace: false,
      },
      furnaces: opts.furnaces,
      nextSeq: opts.nextSeq,
    };
  }

  let furnaces = opts.furnaces.slice();
  let nextSeq = opts.nextSeq;
  let created = false;
  let f = furnaces.find((x) => x.cabinetId === '柜9' && x.date === opts.date && x.shift === opts.shift && !x.hidden);
  if (!f) {
    f = {
      id: `F${nextSeq++}`,
      cabinetId: '柜9',
      shift: opts.shift,
      date: opts.date,
      lines: [],
    };
    furnaces.push(f);
    created = true;
  }
  const need = opts.minLoad - furnaceVol(f, opts.poolById);
  let added = 0;
  let vol = 0;
  for (const p of d002) {
    if (vol >= Math.max(need, 0) && added >= 1) break;
    if (!f.lines.includes(p.id)) {
      f.lines.push(p.id);
      vol += p.vol;
      added++;
    }
  }
  return {
    result: {
      ok: true,
      message: `建议拼炉：已将 ${added} 行 D002 装入 ${f.cabinetId}，合计约 ${furnaceVol(f, opts.poolById).toFixed(1)}m³`,
      added,
      furnace: f,
      createdFurnace: created,
    },
    furnaces,
    nextSeq,
    selectedFurnaceId: f.id,
  };
}
