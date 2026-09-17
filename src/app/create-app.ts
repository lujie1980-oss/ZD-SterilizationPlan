import { createApp, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createWebHistory, type Router } from 'vue-router';
import AppRoot from '../App.vue';
import { createAppRouter } from './router';

export function createSterilizationApp(opts?: { memory?: boolean }): { app: App; router: Router } {
  const app = createApp(AppRoot);
  const pinia = createPinia();
  const history = opts?.memory ? createMemoryHistory() : createWebHistory();
  const router = createAppRouter(history);
  app.use(pinia);
  app.use(router);
  return { app, router };
}

export async function waitEl(selector: string, timeout = 4000): Promise<Element> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitEl timeout: ${selector}`);
}

export async function mountSterilizationApp(target?: HTMLElement): Promise<{
  app: App;
  router: Router;
  el: HTMLElement;
}> {
  const el =
    target ??
    document.getElementById('app') ??
    Object.assign(document.createElement('div'), { id: 'app' });
  if (!el.parentNode) document.body.appendChild(el);
  const memory = import.meta.env.MODE === 'test';
  const { app, router } = createSterilizationApp({ memory });
  if (memory) await router.push('/pack');
  await router.isReady();
  app.mount(el);
  await waitEl('#page-grouping');
  return { app, router, el };
}
