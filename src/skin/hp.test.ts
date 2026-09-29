import { describe, expect, it } from 'vitest';
import { enemyHp, hpState, pCpu, playerHp, roundOutcome } from './hp';

describe('敵 HP = ceil(N × p_cpu)、p_cpu = clamp(直近3ラウンドの平均正答率 − 0.05, 0.65, 0.85)', () => {
  it('p_cpu のクランプ', () => {
    expect(pCpu([0.8, 0.8, 0.8])).toBeCloseTo(0.75, 10);
    expect(pCpu([1, 1, 1])).toBeCloseTo(0.85, 10);
    expect(pCpu([0.3, 0.4, 0.5])).toBeCloseTo(0.65, 10);
    expect(pCpu([0.5, 0.9, 0.9, 0.9])).toBeCloseTo(0.85, 10); // 直近3つだけ
    expect(pCpu([])).toBeCloseTo(0.75, 10); // 記録なし = 0.80 と仮定
  });

  it('浮動小数の誤差で1多くならない', () => {
    expect(enemyHp(20, [0.8])).toBe(15);
    expect(enemyHp(24, [0.9, 0.9, 0.9])).toBe(21); // 20.4 → 21
    expect(enemyHp(30, [0.7])).toBe(20); // 19.5 → 20
  });

  it('自分 HP = N − 敵 HP + 1、KO / PERFECT / 判定負け', () => {
    expect(playerHp(24, 18)).toBe(7);
    expect(roundOutcome(24, 24, 18)).toBe('perfect');
    expect(roundOutcome(24, 18, 18)).toBe('ko');
    expect(roundOutcome(24, 17, 18)).toBe('decision');
  });

  it('HP は試行結果の決定的な関数。誤答が自分 HP に達したらダウン（ラウンドは続く）', () => {
    expect(hpState(24, 18, 10, 3)).toEqual({ enemy: 8, enemyMax: 18, player: 4, playerMax: 7, down: false });
    expect(hpState(24, 18, 12, 7).down).toBe(true);
    expect(hpState(24, 18, 12, 9).player).toBe(0);
    expect(hpState(24, 18, 24, 0).enemy).toBe(0);
  });
});
