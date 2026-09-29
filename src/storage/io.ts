/** エクスポート／インポート（仕様書 第8節） */
import { compactDate } from '../engine/dates';
import { migrate, SaveDataError } from './storage';
import type { SaveData } from './schema';
import { totalPowerNow, trainingRounds } from './selectors';

/** 'brain-fighter-YYYYMMDD.json' */
export function exportFileName(now: Date = new Date()): string {
  return `brain-fighter-${compactDate(now)}.json`;
}

export function serializeSaveData(data: SaveData): string {
  return JSON.stringify(data);
}

export interface ImportPreview {
  createdAt: string;
  /** 訓練ラウンド数（ウォームアップを除く） */
  rounds: number;
  certs: number;
  totalPower: number;
}

export type ImportResult =
  | { ok: true; data: SaveData; preview: ImportPreview }
  | { ok: false; error: string };

/** インポートするファイルの中身を読んで、置き換え用のデータとプレビューを返す（まだ保存はしない） */
export function parseImport(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON として読めません' };
  }
  try {
    const data = migrate(raw);
    return {
      ok: true,
      data,
      preview: {
        createdAt: data.createdAt,
        rounds: trainingRounds(data).length,
        certs: data.certs.length,
        totalPower: totalPowerNow(data),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof SaveDataError ? err.message : String(err) };
  }
}

/** JSON をファイルとしてダウンロードさせる（ブラウザ専用） */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
