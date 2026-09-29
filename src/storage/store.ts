/** アプリ全体で1つの保存データ（メモリ上の状態 + localStorage への書き込み） */
import type { SaveData } from './schema';
import {
  clearSaveData,
  defaultSaveData,
  loadSaveData,
  saveSaveData,
  type SaveResult,
  type StorageLike,
} from './storage';

export class Store {
  data: SaveData;
  /** localStorage に保存できる環境か */
  readonly available: boolean;
  /** 読めなかったデータを退避したキー（あれば設定画面で知らせる） */
  readonly backupKey: string | undefined;
  lastSave: SaveResult = { ok: true };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly backend: StorageLike | null,
    private readonly clock: () => Date = () => new Date(),
  ) {
    const r = loadSaveData(backend, clock());
    this.data = r.data;
    this.available = r.available;
    this.backupKey = r.backupKey;
  }

  /** いまのデータを保存する（保存できない環境では何もしない） */
  save(): boolean {
    if (!this.available) return false;
    this.lastSave = saveSaveData(this.backend, this.data, this.clock());
    return this.lastSave.ok;
  }

  /** データを書き換えて保存し、購読者に知らせる */
  update(fn: (d: SaveData) => void): void {
    fn(this.data);
    this.save();
    this.notify();
  }

  /** インポート: 丸ごと置き換える */
  replace(next: SaveData): void {
    this.data = next;
    this.save();
    this.notify();
  }

  /** 全消去 */
  clearAll(): void {
    clearSaveData(this.backend);
    this.data = defaultSaveData(this.clock());
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
