/** ハッシュルーティング（GitHub Pages 向け）: #/ #/play/:gameId #/result #/records #/cert #/settings */
export type Route =
  | { name: 'home' }
  | { name: 'play'; gameId: string }
  | { name: 'result' }
  | { name: 'records' }
  | { name: 'cert' }
  | { name: 'settings' };

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
      return { name: 'cert' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}
