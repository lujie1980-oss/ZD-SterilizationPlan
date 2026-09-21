import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick, type App } from 'vue';
import { STORAGE_KEY } from '../../data/config-defaults';
import { furnaceSortPolicyPanelHtml } from '../../app/components/gantt/sort-policy-contract';
import { mountSterilizationApp, waitEl } from '../../app/create-app';
import { defaultScheduleSortPolicy } from '../schedule-sort-policy';

describe('变更-2 排序策略面板 UI', () => {
  it('面板含中文文案、核心键调序/升降、可选键开关、保存/恢复默认、铁律', () => {
    const html = furnaceSortPolicyPanelHtml(defaultScheduleSortPolicy());
    expect(html).toContain('排序策略');
    expect(html).toContain('date↑ · shift↑ · volume↓ · (id)');
    expect(html).toContain('上线日期');
    expect(html).toContain('班次');
    expect(html).toContain('体积');
    expect(html).toContain('交期');
    expect(html).toContain('加急');
    expect(html).toContain('装柜率');
    expect(html).toContain('上移');
    expect(html).toContain('下移');
    expect(html).toContain('升');
    expect(html).toContain('保存');
    expect(html).toContain('恢复默认');
    expect(html).toContain('未排 Content 靠后');
    expect(html).toContain('下次甘特同步');
    expect(html).toContain('按柜建链');
    expect(html).toContain('不改交期');
    expect(html).toContain('组柜不建 Task');
    expect(html).toContain('data-testid="schedule-sort-policy"');
    expect(html).not.toContain('>系统破平<');
  });
});

describe('变更-2 进炉计划 jsdom', () => {
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

  it('C2 面板挂在进炉计划；保存不同步不改 Task；恢复默认预览正确', async () => {
    const mounted = await mountSterilizationApp();
    app = mounted.app;
    (document.querySelector('[data-page="furnace-plan"]') as HTMLElement).click();
    await waitEl('[data-testid="schedule-sort-policy"]');
    const panel = document.querySelector('[data-testid="schedule-sort-policy"]');
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain('排序策略');
    expect(panel?.textContent).toContain('date↑ · shift↑ · volume↓ · (id)');
    expect(document.querySelector('#btnSaveSortPolicy')).toBeTruthy();
    expect(document.querySelector('#btnRestoreSortPolicy')).toBeTruthy();
    expect(document.body.textContent).toContain('按柜建链');

    const rawBefore = localStorage.getItem(STORAGE_KEY);
    expect(rawBefore).toBeTruthy();
    const snapBefore = JSON.parse(rawBefore!);
    const tasksBefore = JSON.stringify(snapBefore.tasks || []);
    const contentsBefore = JSON.stringify(snapBefore.contents || snapBefore.furnaces || []);

    const volDir = document.querySelector('[data-sort-code="volume"] [data-sort-dir]') as HTMLElement;
    volDir.click();
    await nextTick();
    (document.querySelector('#btnSaveSortPolicy') as HTMLElement).click();
    await nextTick();

    const rawAfterSave = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(rawAfterSave.config.scheduleSortPolicy.keys.find((k: { code: string }) => k.code === 'volume').direction).toBe('asc');
    expect(JSON.stringify(rawAfterSave.tasks || [])).toBe(tasksBefore);
    expect(JSON.stringify(rawAfterSave.contents || rawAfterSave.furnaces || [])).toBe(contentsBefore);
    expect(rawAfterSave.config.packSuggestPolicy.preset).toBe('fillFirst');

    (document.querySelector('#btnRestoreSortPolicy') as HTMLElement).click();
    await nextTick();
    const preview = document.querySelector('[data-testid="sort-policy-preview"]')?.textContent;
    expect(preview).toContain('date↑ · shift↑ · volume↓ · (id)');
  });
});
