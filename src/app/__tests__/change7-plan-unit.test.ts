import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick, type App } from 'vue';
import { mountSterilizationApp, waitEl } from '../../app/create-app';
import { usePlanStore } from '../../app/stores/planStore';

describe('变更-7 PlanUnit UI', () => {
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

  it('C7-01/02: 待排产确认后自动生成单元，重跑按钮可见', async () => {
    const mounted = await mountSterilizationApp();
    app = mounted.app;
    await mounted.router.push('/demand');
    await nextTick();
    await waitEl('#page-demand');
    const confirm = document.querySelector('[data-confirm-demand="P016"]') as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    confirm.click();
    await nextTick();
    const plan = usePlanStore();
    expect(plan.unitsOfDemand('P016')).toHaveLength(3);
    expect(plan.creationOfDemand('P016')?.ruleCode).toBe('oneBoxOneUnit');
    expect(document.querySelector('[data-rerun-split="P016"]')).toBeTruthy();
    expect(document.querySelector('[data-plan-units="P016"]') || document.body.textContent).toBeTruthy();
    const expand = document.querySelector('[data-toggle-units="P016"]') as HTMLButtonElement | null;
    if (expand && !document.querySelector('[data-plan-units="P016"]')) {
      expand.click();
      await nextTick();
    }
    expect(document.querySelector('[data-plan-units="P016"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-plan-unit]').length).toBeGreaterThanOrEqual(3);
  });
});
