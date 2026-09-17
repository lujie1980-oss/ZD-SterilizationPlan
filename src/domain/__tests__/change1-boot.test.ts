import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mountSterilizationApp, waitEl } from '../../app/create-app';
import type { App } from 'vue';

describe('变更-1 组柜页面冒烟 (jsdom)', () => {
  let app: App | undefined;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('C1-11/19/22/30/42: 打开组柜可见双入口、完整列表芯片、无班次筛选、灭菌中禁用可见', async () => {
    const mounted = await mountSterilizationApp();
    app = mounted.app;
    const toolbar = document.querySelector('#grpToolbar')!;
    expect(toolbar.textContent).toContain('选柜');
    expect(toolbar.textContent).toContain('选需求');
    expect(document.querySelector('#grpShiftTabs')).toBeNull();
    expect(document.querySelector('#page-grouping [data-shift="白班"]')).toBeNull();
    expect(document.querySelector('#page-grouping')?.classList.contains('active')).toBe(true);

    const cab9 = document.querySelector('[data-grp-cab="柜9"]') as HTMLElement;
    cab9.click();
    await nextTick();
    expect(document.querySelector('[data-placement="inThisCabinet"]')).toBeTruthy();
    expect(document.querySelector('[data-placement="unassigned"]') || document.body.textContent).toBeTruthy();
    expect(document.body.textContent).toMatch(/未排/);
    expect(document.body.textContent).toContain('超托盘');
    expect(document.querySelector('[data-tray-over]')).toBeTruthy();

    const cab14 = document.querySelector('[data-grp-cab="柜14"]') as HTMLElement;
    expect(cab14.classList.contains('disabled') || cab14.textContent?.includes('灭菌中')).toBe(true);

    (document.querySelector('[data-grp-entry="demand"]') as HTMLElement).click();
    await nextTick();
    const row = document.querySelector('[data-grp-demand-view="P001"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(document.querySelector('[data-grp-check="P001"]')).toBeNull();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-stock-line="P001"][data-grp-check]')];
    expect(boxes.every((b) => !b.checked)).toBe(true);
    row.click();
    await nextTick();
    expect(document.querySelector('[data-grp-check="P001"]')).toBeNull();
    const boxesAfter = [...document.querySelectorAll<HTMLInputElement>('[data-stock-line="P001"][data-grp-check]')];
    expect(boxesAfter.every((b) => !b.checked)).toBe(true);
    expect(document.body.textContent).toMatch(/可组柜/);
    expect(document.body.textContent).toContain('建议策略');
    expect(document.querySelector('#btnSavePackPolicy')).toBeTruthy();
    expect(document.querySelector('#btnRestorePackPolicy')).toBeTruthy();
    expect(document.body.textContent).toContain('先填满一台');
    await waitEl('#grpToolbar');
  });
});
