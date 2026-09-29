import './styles.css';
import { App } from './ui/app';
import { SCREENS } from './ui/screens';
import { installTestHooks } from './ui/test-hooks';

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  installTestHooks(app);
  app.start(SCREENS);
}
