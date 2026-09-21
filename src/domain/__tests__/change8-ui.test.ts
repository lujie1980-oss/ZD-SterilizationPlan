import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mountSterilizationApp, waitEl } from '../../app/create-app';
import {
  groupingPolicyPanelHtml,
  packConstraintBanner,
} from '../../app/components/pack/grouping-contract';
import { defaultPackSuggestPolicy } from '../pack-suggest-policy';

const root = resolve(process.cwd());

describe('变更-8 组柜 UI 体积口径', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('C8-01 UI: /pack 以体积装柜率为真源，托盘层可选，无拆 tray 主路径', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    await router.push('/pack');
    await waitEl('#page-grouping');
    expect(document.querySelector('[data-testid="pack-volume-summary"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="pack-large-boxes"]')?.textContent).toMatch(/大箱/);
    expect(document.querySelector('[data-testid="pack-large-boxes"]')?.textContent).toMatch(/280/);
    expect(document.querySelector('[data-testid="pack-remaining-vol"]')?.textContent).toMatch(/剩余体积/);
    expect(document.querySelector('[data-testid="pack-trays-optional"]')).toBeTruthy();
    const html = document.querySelector('#page-grouping')?.innerHTML || '';
    expect(html).not.toContain('分层 → 装柜');
    expect(html).not.toContain('先分层（托盘主数据）再装柜');
    expect(html).not.toContain('PlanUnit');
    expect(html).not.toContain('一箱一单元');
    app.unmount();
  });

  it('VOL_OVERFLOW 与 BOX_LIMIT 文案可区分', () => {
    expect(packConstraintBanner('VOL_OVERFLOW', '已装 12m³ > 额定 10m³')).toContain('VOL_OVERFLOW');
    expect(packConstraintBanner('VOL_OVERFLOW', '已装 12m³ > 额定 10m³')).toContain('体积超柜容');
    expect(packConstraintBanner('BOX_LIMIT', '合计 281 箱')).toContain('BOX_LIMIT');
    expect(packConstraintBanner('BOX_LIMIT', '合计 281 箱')).toContain('大箱超 280');
  });

  it('策略铁律含体积与大箱约束、不把托盘拆分当主路径', () => {
    const html = groupingPolicyPanelHtml(defaultPackSuggestPolicy());
    expect(html).toContain('VOL_OVERFLOW');
    expect(html).toContain('BOX_LIMIT');
    expect(html).toContain('不拆托盘');
    const vue = readFileSync(join(root, 'src/app/views/PackCabinetView.vue'), 'utf8');
    expect(vue).toContain('data-testid="pack-volume-summary"');
    expect(vue).toContain('data-box-limit-blocked');
    expect(vue).not.toContain('分层 → 装柜');
  });
});
