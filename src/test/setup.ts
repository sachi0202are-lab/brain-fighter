/** Vitest（Node 環境）用の最小限の下準備 */

// Canvas の Path2D は Node に無いので、描画テストで使えるように何もしない代用品を置く
if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
  class Path2DStub {
    addPath(): void {}
    arc(): void {}
    arcTo(): void {}
    bezierCurveTo(): void {}
    closePath(): void {}
    ellipse(): void {}
    lineTo(): void {}
    moveTo(): void {}
    quadraticCurveTo(): void {}
    rect(): void {}
    roundRect(): void {}
  }
  (globalThis as { Path2D?: unknown }).Path2D = Path2DStub;
}
