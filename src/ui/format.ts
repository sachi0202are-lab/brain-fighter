/** 表示用の整形 */
export const fmtInt = (n: number): string => Math.round(n).toLocaleString('ja-JP');
export const fmtPct = (x: number): string => `${Math.round(x * 100)}%`;
export const fmtSigned = (n: number): string => (n > 0 ? `+${fmtInt(n)}` : n < 0 ? `−${fmtInt(-n)}` : '±0');

/** 'YYYY-MM-DD' → '9/28' */
export function fmtMonthDay(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[1])}/${Number(m[2])}` : date;
}

/** Date → 'HH:MM' */
export function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO → 'YYYY/MM/DD' */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
