export function parseDate(str: string | Date): Date {
  if (str instanceof Date) return new Date(str.getTime());
  if (str.includes('T') || str.includes(' ')) return new Date(str);
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y!, m! - 1, d);
}

export function fmtDate(dt: string | Date): string {
  if (typeof dt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dt)) return dt;
  const x = dt instanceof Date ? dt : parseDate(dt);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const d = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fmtDateTime(dt: string | Date): string {
  const x = dt instanceof Date ? dt : parseDate(dt);
  const base = fmtDate(x);
  const h = x.getHours();
  if (h === 0 && x.getMinutes() === 0) return base;
  return base + (h < 12 ? ' 上午' : ' 下午');
}

export function addDays(dateStr: string | Date, days: number): Date {
  const dt = parseDate(dateStr);
  dt.setTime(dt.getTime() + days * 86400000);
  return dt;
}

export function dayOffset(from: string | Date, to: string | Date): number {
  const a = from instanceof Date ? from : parseDate(from);
  const b = to instanceof Date ? to : parseDate(to);
  return (b.getTime() - a.getTime()) / 86400000;
}

export function shiftRank(s: string): number {
  return s === '白班' ? 0 : 1;
}
