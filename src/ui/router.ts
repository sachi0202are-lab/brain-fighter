/**
 * ハッシュルーティング（GitHub Pages 向け）:
 * #/ #/play/:gameId #/result #/records #/cert #/cert/run/:gameId[,:gameId...] #/settings #/welcome
 */
export type Route =
  | { name: 'home' }
  | { name: 'play'; gameId: string }
  | { name: 'result' }
  | { name: 'records' }
  | { name: 'cert' }
  | { name: 'certRun'; games: string[] }
  | { name: 'settings' }
  | { name: 'welcome' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\?.*$/, '');
  const parts = path.split('/').filter(Boolean);
  switch (parts[0]) {
    case undefined:
      return { name: 'home' };
    case 'play':
      return parts[1] ? { name: 'play', gameId: decodeURIComponent(parts[1]) } : { name: 'home' };
    case 'result':
      return { name: 'result' };
    case 'records':
      return { name: 'records' };
    case 'cert':
      if (parts[1] === 'run' && parts[2]) {
        return { name: 'certRun', games: decodeURIComponent(parts[2]).split(',').filter(Boolean) };
      }
      return { name: 'cert' };
    case 'settings':
      return { name: 'settings' };
    case 'welcome':
      return { name: 'welcome' };
    default:
      return { name: 'home' };
  }
}
