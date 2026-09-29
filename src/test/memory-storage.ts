/** テスト用の localStorage 代わり（失敗の注入つき） */
import type { StorageLike } from '../storage/storage';

export class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  /** true なら getItem が例外を投げる */
  failGet = false;
  /** true なら setItem が例外を投げる */
  failSet = false;
  /** 1回の setItem で書ける最大文字数（超えると QuotaExceededError 相当） */
  quotaChars = Number.POSITIVE_INFINITY;

  getItem(key: string): string | null {
    if (this.failGet) throw new Error('SecurityError');
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('SecurityError');
    if (value.length > this.quotaChars) {
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}
