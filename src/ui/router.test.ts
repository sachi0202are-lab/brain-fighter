import { describe, expect, it } from 'vitest';
import { parseRoute } from './router';

describe('ハッシュルーティング', () => {
  it('既存の画面', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/play/double-hit')).toEqual({ name: 'play', gameId: 'double-hit' });
    expect(parseRoute('#/records')).toEqual({ name: 'records' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/unknown')).toEqual({ name: 'home' });
  });

  it('認定戦: 選ぶ画面と、実施（1ゲームでも複数でも）', () => {
    expect(parseRoute('#/cert')).toEqual({ name: 'cert' });
    expect(parseRoute('#/cert/run')).toEqual({ name: 'cert' });
    expect(parseRoute('#/cert/run/combo-recall')).toEqual({ name: 'certRun', games: ['combo-recall'] });
    expect(parseRoute('#/cert/run/double-hit,stance-change')).toEqual({ name: 'certRun', games: ['double-hit', 'stance-change'] });
  });

  it('初回の案内', () => {
    expect(parseRoute('#/welcome')).toEqual({ name: 'welcome' });
  });
});
