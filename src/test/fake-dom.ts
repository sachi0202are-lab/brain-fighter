/**
 * Node で演出（skin/hud.ts）をそのまま動かすための、ごく小さな document の代用品。
 * createElement と、演出が使うプロパティ（className / textContent / hidden / style / dataset / append / setAttribute）だけ。
 */
export class FakeElement {
  className = '';
  textContent = '';
  hidden = false;
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  constructor(readonly tagName: string) {}
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  setAttribute(k: string, v: string): void {
    this.attributes.set(k, v);
  }
}

/** globalThis.document を差し替える。戻り値で元に戻す */
export function installFakeDocument(): () => void {
  const g = globalThis as { document?: unknown };
  const prev = g.document;
  g.document = { createElement: (tag: string) => new FakeElement(tag) };
  return () => {
    g.document = prev;
  };
}
