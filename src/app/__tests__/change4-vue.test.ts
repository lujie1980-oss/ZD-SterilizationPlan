import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mountSterilizationApp, waitEl } from '../create-app';

const root = resolve(process.cwd());

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

describe('C4-01 Vue 3 工程与关键页可指认', () => {
  it('package.json 依赖含 vue@3、vue-router、pinia、@vitejs/plugin-vue；build 含 vue-tsc', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps.vue).toBeTruthy();
    const vueVer = String(deps.vue);
    expect(vueVer.startsWith('^3') || vueVer.startsWith('3')).toBe(true);
    expect(deps['vue-router']).toBeTruthy();
    expect(deps.pinia).toBeTruthy();
    expect(deps['@vitejs/plugin-vue']).toBeTruthy();
    expect(deps['vue-tsc']).toBeTruthy();
    expect(pkg.scripts?.build).toContain('vue-tsc --noEmit');
    expect(pkg.scripts?.build).toContain('vite build');
  });

  it('入口为 createApp；路由可指认 /pool /pack /gantt /validation', () => {
    const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
    const createAppSrc = readFileSync(join(root, 'src/app/create-app.ts'), 'utf8');
    expect(main + createAppSrc).toContain('createApp');
    expect(main).not.toMatch(/from ['"]\.\/ui\/app['"]/);
    expect(main).not.toContain('bootApp');

    const router = readFileSync(join(root, 'src/app/router/index.ts'), 'utf8');
    expect(router).toMatch(/path:\s*['"]\/pool['"]/);
    expect(router).toMatch(/path:\s*['"]\/pack['"]/);
    expect(router).toMatch(/path:\s*['"]\/gantt['"]/);
    expect(router).toMatch(/path:\s*['"]\/validation['"]/);
    expect(router).toContain('DemandPoolView.vue');
    expect(router).toContain('PackCabinetView.vue');
    expect(router).toContain('GanttPlanView.vue');
    expect(router).toContain('ValidationCenterView.vue');
  });

  it('关键页面为 .vue 且旧 src/ui 不形成可运行入口', () => {
    const views = [
      'src/app/views/DemandPoolView.vue',
      'src/app/views/PackCabinetView.vue',
      'src/app/views/GanttPlanView.vue',
      'src/app/views/ValidationCenterView.vue',
    ];
    for (const v of views) {
      expect(readFileSync(join(root, v), 'utf8').length).toBeGreaterThan(20);
    }
    expect(readFileSync(join(root, 'src/App.vue'), 'utf8')).toContain('AppShell');

    const srcFiles = walk(join(root, 'src'));
    const uiTs = srcFiles.filter((f) => f.includes(`${join('src', 'ui')}`) && f.endsWith('.ts'));
    expect(uiTs, 'src/ui 命令式入口应下线').toEqual([]);
    expect(srcFiles.some((f) => f.endsWith(join('src', 'ui', 'app.ts')))).toBe(false);
  });

  it('.vue 不直接读写 localStorage；持久化经 persistence/planStore', () => {
    const vueFiles = walk(join(root, 'src')).filter((f) => f.endsWith('.vue'));
    expect(vueFiles.length).toBeGreaterThan(3);
    for (const f of vueFiles) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/localStorage/);
    }
    const store = readFileSync(join(root, 'src/app/stores/planStore.ts'), 'utf8');
    expect(store).toMatch(/from ['"].*persistence\/plan-store-v2['"]/);
    expect(store).not.toMatch(/localStorage\.(getItem|setItem)/);
  });
});

describe('C4-02 中度紧凑令牌', () => {
  it('tokens.css 镜像原型密度：侧栏 168px、行高 30px、顶栏 40px、控件 28px', () => {
    const css = readFileSync(join(root, 'src/app/styles/tokens.css'), 'utf8');
    expect(css).toMatch(/--sidebar-w:\s*168px/);
    expect(css).toMatch(/--row-h:\s*30px/);
    expect(css).toMatch(/--header-h:\s*34px/);
    expect(css).toMatch(/--topbar-h:\s*40px/);
    expect(css).toMatch(/--control-h:\s*28px/);
    expect(css).toMatch(/--space-1:\s*4px/);
    expect(css).toMatch(/--space-2:\s*8px/);
    expect(css).toMatch(/--space-3:\s*12px/);
    expect(css).toMatch(/--font-xs:\s*12px/);
    expect(css).toMatch(/--gantt-bar-h:\s*18px/);
  });
});

describe('C4-05 Docker 端口约定', () => {
  it('compose 映射 18080:80；nginx SPA fallback；Dockerfile npm ci + build', () => {
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
    expect(compose).toMatch(/["']18080:80["']/);
    const nginx = readFileSync(join(root, 'nginx.conf'), 'utf8');
    expect(nginx).toContain('try_files $uri $uri/ /index.html');
    const docker = readFileSync(join(root, 'Dockerfile'), 'utf8');
    expect(docker).toContain('npm ci');
    expect(docker).toContain('npm run build');
  });
});

describe('C4-01 运行时路由可打开', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('挂载后 /pack /pool /gantt /validation 均可渲染', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    expect(document.querySelector('#page-grouping')).toBeTruthy();
    await router.push('/pool');
    await waitEl('#page-pool');
    await router.push('/gantt');
    await waitEl('#page-furnace-plan');
    expect(document.querySelector('[data-testid="schedule-sort-policy"]')).toBeTruthy();
    await router.push('/validation');
    await waitEl('#page-validation');
    app.unmount();
  });
});
