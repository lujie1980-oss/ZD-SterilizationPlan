import { CSV_HEADERS } from '../data/config-defaults';
import type { Cabinet, FurnaceRun, StockLine } from './entities';

export function buildDayPlanCsv(opts: {
  date: string;
  shift: string;
  furnaces: FurnaceRun[];
  cabinets: Cabinet[];
  poolById: (id: string) => StockLine | undefined;
}): { filename: string; content: string; rowCount: number } {
  const lines: string[] = [CSV_HEADERS.join(',')];
  opts.furnaces
    .filter((f) => !f.hidden && f.date === opts.date && f.shift === opts.shift)
    .forEach((f) => {
      const cab = opts.cabinets.find((c) => c.id === f.cabinetId);
      f.lines.forEach((lid) => {
        const p = opts.poolById(lid);
        if (!p) return;
        const cols = [
          opts.date,
          opts.shift,
          f.id,
          f.cabinetId,
          cab?.base || '',
          p.id,
          p.ref,
          `"${p.name}"`,
          p.customer,
          p.process,
          String(p.boxes),
          String(p.boxVol),
          String(p.vol),
          p.wo,
          p.batch,
          p.urgent ? 'Y' : 'N',
        ];
        lines.push(cols.join(','));
      });
    });
  const body = lines.join('\n');
  const content = `\ufeff${body}`;
  return {
    filename: `日计划_${opts.date}_${opts.shift}.csv`,
    content,
    rowCount: lines.length - 1,
  };
}

export function csvHasBom(content: string): boolean {
  return content.charCodeAt(0) === 0xfeff;
}
