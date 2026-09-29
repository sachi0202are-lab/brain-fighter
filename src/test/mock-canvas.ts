/**
 * Node で renderStimulus を呼ぶための CanvasRenderingContext2D の代用品。
 * どのメソッドも何もせず、プロパティは代入された値を覚えるだけ。呼ばれたメソッドの回数を数える。
 */
export interface MockContext {
  ctx: CanvasRenderingContext2D;
  calls: Map<string, number>;
}

export function mockContext2D(size = 300): MockContext {
  const calls = new Map<string, number>();
  const canvas = { width: size, height: size };
  const state: Record<string | symbol, unknown> = {
    canvas,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    globalAlpha: 1,
  };
  const special: Record<string, (...a: number[]) => unknown> = {
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (_x = 0, _y = 0, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createConicGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
    isPointInStroke: () => false,
    getLineDash: () => [],
  };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop in state) return state[prop];
        if (typeof prop !== 'string') return undefined;
        const fn = special[prop];
        return (...args: number[]) => {
          calls.set(prop, (calls.get(prop) ?? 0) + 1);
          return fn ? fn(...args) : undefined;
        };
      },
      set(_t, prop, value) {
        state[prop] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
