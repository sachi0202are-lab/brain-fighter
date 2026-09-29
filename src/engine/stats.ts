/** 記録用の小さな統計関数 */

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function mean(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 連続 true の最長 */
export function maxStreak(values: readonly boolean[]): number {
  let best = 0;
  let run = 0;
  for (const v of values) {
    run = v ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** 標準正規分布の分位点（Acklam の近似。|誤差| < 1.2e-9） */
export function normInv(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  const A = (i: number): number => a[i] as number;
  const B = (i: number): number => b[i] as number;
  const C = (i: number): number => c[i] as number;
  const D = (i: number): number => d[i] as number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((C(0) * q + C(1)) * q + C(2)) * q + C(3)) * q + C(4)) * q + C(5)) / ((((D(0) * q + D(1)) * q + D(2)) * q + D(3)) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((C(0) * q + C(1)) * q + C(2)) * q + C(3)) * q + C(4)) * q + C(5)) / ((((D(0) * q + D(1)) * q + D(2)) * q + D(3)) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((A(0) * r + A(1)) * r + A(2)) * r + A(3)) * r + A(4)) * r + A(5)) * q) / (((((B(0) * r + B(1)) * r + B(2)) * r + B(3)) * r + B(4)) * r + 1);
}

/**
 * d′（信号検出の感度）。ヒット率・誤警報率が 0 や 1 になるのを避けるため log-linear 補正
 * （各セルに 0.5 を足す: Hautus, 1995）を使う。
 */
export function dPrime(hits: number, misses: number, falseAlarms: number, correctRejections: number): number {
  const hr = (hits + 0.5) / (hits + misses + 1);
  const far = (falseAlarms + 0.5) / (falseAlarms + correctRejections + 1);
  return normInv(hr) - normInv(far);
}
