import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mountSterilizationApp, waitEl } from '../create-app';
import { usePlanStore } from '../stores/planStore';

const NAV_LABELS = ['基础数据维护', '待排产需求确认', '组柜优化', '入炉计划', '结果发布'] as const;
const OLD_NAV_NAMES = ['校验中心', '已排期浏览', '待灭菌可排池', '进炉计划'];

function navItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.sidebar nav.nav a.nav-item')];
}

function navLabels(): string[] {
  return navItems().map((el) => el.querySelector('.nav-label')?.textContent?.trim() || '');
}

async function captureCsvDownload(click: () => void): Promise<{ filename: string; content: string }> {
  const blobs: Blob[] = [];
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origClick = HTMLAnchorElement.prototype.click;
  let filename = '';
  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob);
    return 'blob:c5-test';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = function clickAnchor(this: HTMLAnchorElement) {
    filename = this.download;
  };
  try {
    click();
    expect(blobs.length).toBeGreaterThan(0);
    const blob = blobs[0]!;
    const content =
      typeof (blob as Blob).text === 'function'
        ? await (blob as Blob).text()
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blob);
          });
    return { filename, content };
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    HTMLAnchorElement.prototype.click = origClick;
  }
}

describe('C5 信息架构重组', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('C5-01 侧栏仅五项且顺序固定，旧一级名不出现', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app } = await mountSterilizationApp();
    expect(navLabels()).toEqual([...NAV_LABELS]);
    for (const old of OLD_NAV_NAMES) {
      expect(navLabels()).not.toContain(old);
    }
    expect(navLabels()).not.toContain('组柜');
    for (const item of navItems()) {
      await item.click();
      await nextTick();
      expect(navLabels()).toEqual([...NAV_LABELS]);
    }
    app.unmount();
  });

  it('C5-02 全局顶栏无结果日与导出日计划 CSV；仅结果发布页内出现', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    const paths = ['/master', '/demand', '/pack', '/gantt', '/release'];
    for (const path of paths) {
      await router.push(path);
      await nextTick();
      const topbar = document.querySelector('.topbar');
      expect(topbar?.textContent).not.toContain('结果日');
      expect(topbar?.textContent).not.toContain('导出日计划 CSV');
      expect(topbar?.querySelector('#topResultDate')).toBeNull();
      expect(topbar?.querySelector('#btnExport')).toBeNull();
      if (path !== '/release') {
        expect(document.querySelector('#btnExport')).toBeNull();
        expect(document.querySelector('#releaseResultDate')).toBeNull();
      }
    }
    await waitEl('#page-release');
    expect(document.querySelector('#page-release')?.textContent).toContain('结果日');
    expect(document.querySelector('#page-release #releaseResultDate')).toBeTruthy();
    expect(document.querySelector('#page-release #btnExport')?.textContent).toContain('导出日计划 CSV');
    app.unmount();
  });

  it('C5-03 结果发布可改结果日；按上线日筛选；未排期不进视图与默认导出', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    const plan = usePlanStore();
    const dayA = '2026-07-24';
    const dayB = '2026-07-25';
    const dueDay = plan.poolById('P001')?.due;
    expect(dueDay).toBeTruthy();
    expect(dueDay).not.toBe(dayA);

    const fA = plan.furnaces[0]!;
    const fB = plan.furnaces[1]!;
    const fUnsched = plan.furnaces[2]!;
    fA.date = dayA;
    fA.shift = '白班';
    fA.scheduleStatus = 'scheduled';
    fB.date = dayB;
    fB.shift = '白班';
    fB.scheduleStatus = 'scheduled';
    fUnsched.date = null;
    fUnsched.shift = null;
    plan.setDate(dayA);
    plan.setShift('白班');

    await router.push('/release');
    await waitEl('#page-release');
    await nextTick();

    const dateInput = document.querySelector('#releaseResultDate') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    expect(dateInput.value).toBe(dayA);
    const gridA = document.querySelector('#furnaceGrid')?.textContent || '';
    expect(gridA).toContain(fA.id);
    expect(gridA).not.toContain(fB.id);
    expect(gridA).not.toContain(fUnsched.id);

    dateInput.value = dayB;
    dateInput.dispatchEvent(new Event('change'));
    await nextTick();
    expect(plan.date).toBe(dayB);
    const gridB = document.querySelector('#furnaceGrid')?.textContent || '';
    expect(gridB).toContain(fB.id);
    expect(gridB).not.toContain(fA.id);
    expect(gridB).not.toContain(fUnsched.id);

    dateInput.value = dueDay!;
    dateInput.dispatchEvent(new Event('change'));
    await nextTick();
    const gridDue = document.querySelector('#furnaceGrid')?.textContent || '';
    expect(gridDue).not.toContain(fA.id);
    expect(gridDue).not.toContain(fUnsched.id);

    dateInput.value = dayA;
    dateInput.dispatchEvent(new Event('change'));
    await nextTick();

    const csv = await captureCsvDownload(() => {
      (document.querySelector('#page-release #btnExport') as HTMLButtonElement).click();
    });
    expect(csv.filename).toContain(dayA);
    expect(csv.content).toContain(fA.lines[0]!);
    expect(csv.content).not.toContain(fUnsched.lines[0]!);
    expect(csv.content.split('\n').some((line) => line.includes(dayB))).toBe(false);

    (document.querySelector('[data-release-tab="issues"]') as HTMLElement).click();
    await nextTick();
    const issuesText = document.querySelector('#page-validation')?.textContent || '';
    expect(issuesText).not.toContain(fUnsched.id);
    app.unmount();
  });

  it('C5-04 组柜/甘特/策略/双模式仍可达；旧 path 重定向', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();

    await router.push('/pack');
    await waitEl('#page-grouping');
    expect(document.querySelector('[data-testid="pack-suggest-policy"], #grpPackPolicy, .grp-toolbar')).toBeTruthy();
    expect(document.body.textContent).toContain('建议策略');
    expect(document.querySelector('#grpScheduleModeTabs')).toBeTruthy();
    expect(document.querySelector('[data-mode="auto"]')).toBeTruthy();
    expect(document.querySelector('[data-mode="manual"]')).toBeTruthy();
    expect(document.querySelector('#btnSavePackPolicy')).toBeTruthy();

    await router.push('/gantt');
    await waitEl('#page-furnace-plan');
    expect(document.querySelector('[data-testid="schedule-sort-policy"]')).toBeTruthy();
    expect(document.body.textContent).toContain('排序策略');

    await router.push('/pool');
    await waitEl('#page-demand');
    expect(router.currentRoute.value.path).toBe('/demand');

    await router.push('/workbench');
    await waitEl('#page-release');
    expect(router.currentRoute.value.path).toBe('/release');

    await router.push('/validation');
    await waitEl('#page-release');
    expect(router.currentRoute.value.path).toBe('/release');
    expect(router.currentRoute.value.query.tab).toBe('issues');

    await router.push('/cabinets');
    await waitEl('#page-master');
    expect(router.currentRoute.value.path).toBe('/master/cabinets');
    await router.push('/processes');
    expect(router.currentRoute.value.path).toBe('/master/processes');
    await router.push('/boxspecs');
    expect(router.currentRoute.value.path).toBe('/master/boxspecs');
    app.unmount();
  });

  it('C5-05 无校验中心一级菜单；结果发布可看校验；组柜页内摘要链到 /release', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    expect(navLabels()).not.toContain('校验中心');
    expect(document.querySelector('.sidebar a.nav-item[href="/validation"]')).toBeNull();

    await router.push('/release');
    await waitEl('#page-release');
    expect(document.querySelector('[data-release-tab="issues"]')?.textContent).toContain('校验问题');
    (document.querySelector('[data-release-tab="issues"]') as HTMLElement).click();
    await nextTick();
    await waitEl('#page-validation');

    await router.push('/pack');
    await waitEl('#page-grouping');
    const summary = document.querySelector('[data-testid="pack-validation-summary"]');
    expect(summary).toBeTruthy();
    const link = summary?.querySelector('a') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href') || '').toMatch(/\/release/);
    app.unmount();
  });
});
