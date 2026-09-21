import { createSterilizationApp } from './app/create-app';
import './app/styles/tokens.css';
import './app/styles/compact.css';

const { app, router } = createSterilizationApp();
router.isReady().then(() => {
  app.mount('#app');
});
