/**
 * 小さな型付きイベントエミッタ。
 * ラウンド実行（round.ts）はイベントを出すだけで、演出（skin）は購読するだけ。
 * 演出側には EventSource（購読専用）しか渡さないので、演出がラウンドの進行を変えることは構造上できない。
 */

export type Listener<E> = (e: E) => void;

/** 購読専用の窓口 */
export interface EventSource<E extends { type: string }> {
  on<K extends E['type']>(type: K, fn: Listener<Extract<E, { type: K }>>): () => void;
  onAny(fn: Listener<E>): () => void;
}

export class Emitter<E extends { type: string }> implements EventSource<E> {
  private readonly byType = new Map<string, Set<Listener<never>>>();
  private readonly any = new Set<Listener<E>>();

  on<K extends E['type']>(type: K, fn: Listener<Extract<E, { type: K }>>): () => void {
    let set = this.byType.get(type);
    if (!set) {
      set = new Set();
      this.byType.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => {
      set.delete(fn as Listener<never>);
    };
  }

  onAny(fn: Listener<E>): () => void {
    this.any.add(fn);
    return () => {
      this.any.delete(fn);
    };
  }

  /** 購読側の例外は握りつぶして console に出す（購読側の不具合で進行を止めない） */
  emit(e: E): void {
    const set = this.byType.get(e.type);
    if (set) {
      for (const fn of [...set]) {
        try {
          (fn as Listener<E>)(e);
        } catch (err) {
          console.error('[brain-fighter] event listener error', e.type, err);
        }
      }
    }
    for (const fn of [...this.any]) {
      try {
        fn(e);
      } catch (err) {
        console.error('[brain-fighter] event listener error', e.type, err);
      }
    }
  }

  clear(): void {
    this.byType.clear();
    this.any.clear();
  }
}
