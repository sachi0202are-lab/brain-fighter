import type { Mount } from '../app';
import type { Route } from '../router';
import { mountCert } from './cert';
import { mountHome } from './home';
import { mountPlay } from './play';
import { mountRecords } from './records';
import { mountResult } from './result';
import { mountSettings } from './settings';

export const SCREENS: Record<Route['name'], Mount> = {
  home: (app, root) => mountHome(app, root),
  play: (app, root, route) => mountPlay(app, root, route.name === 'play' ? route.gameId : ''),
  result: (app, root) => mountResult(app, root),
  records: (app, root) => mountRecords(app, root),
  cert: (app, root) => mountCert(app, root),
  settings: (app, root) => mountSettings(app, root),
};
