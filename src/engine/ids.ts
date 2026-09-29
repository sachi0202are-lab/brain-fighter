/** 記録用の ID（衝突しにくい短い文字列） */
export function makeId(prefix: string): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  let rand: string;
  if (c && typeof c.getRandomValues === 'function') {
    const a = c.getRandomValues(new Uint32Array(2));
    rand = (a[0] as number).toString(36) + (a[1] as number).toString(36);
  } else {
    rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  return `${prefix}-${Date.now().toString(36)}-${rand.slice(0, 10)}`;
}
