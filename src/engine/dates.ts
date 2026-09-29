/** 日付の小道具。日付は端末のローカル時刻で 'YYYY-MM-DD' として扱う */

const pad = (n: number): string => String(n).padStart(2, '0');

/** ローカル日付 'YYYY-MM-DD' */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' を暦日の通し番号に（1970-01-01 = 0。夏時間の影響を受けない） */
export function dayNumber(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`日付の形式が違います: ${date}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** 暦日の差（b − a） */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** その週の月曜日（ローカル日付） */
export function weekStart(d: Date): string {
  const offset = (d.getDay() + 6) % 7; // 月曜 = 0
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  return localDate(m);
}

/** ファイル名用 'YYYYMMDD' */
export function compactDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** 暦日の通し番号 → 'YYYY-MM-DD' */
export function fromDayNumber(n: number): string {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
