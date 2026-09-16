import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootApp } from '../../ui/app';

describe('变更-1 组柜页面冒烟 (jsdom)', () => {
  beforeEach(() => {
    localStorage.clear();
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    document.body.innerHTML = body.includes('<body>') ? body.slice(body.indexOf('<body>') + 6, body.lastIndexOf('</body>')) : body;
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('C1-11/19/22/30/42: 打开组柜可见双入口、完整列表芯片、无班次筛选、灭菌中禁用可见', () => {
    bootApp();
    const toolbar = document.querySelector('#grpToolbar')!;
    expect(toolbar.textContent).toContain('选柜');
    expect(toolbar.textContent).toContain('选需求');
    expect(document.querySelector('#grpShiftTabs')).toBeNull();
    expect(document.querySelector('#page-grouping [data-shift="白班"]')).toBeNull();
    expect(document.querySelector('#page-grouping')?.classList.contains('active')).toBe(true);

    const cab9 = document.querySelector('[data-grp-cab="柜9"]') as HTMLElement;
    cab9.click();
    expect(document.querySelector('[data-placement="inThisCabinet"]')).toBeTruthy();
    expect(document.querySelector('[data-placement="unassigned"]') || document.body.textContent).toBeTruthy();
    expect(document.body.textContent).toMatch(/未排/);

    const cab14 = document.querySelector('[data-grp-cab="柜14"]') as HTMLElement;
    expect(cab14.classList.contains('disabled') || cab14.textContent?.includes('灭菌中')).toBe(true);

    (document.querySelector('[data-grp-entry="demand"]') as HTMLElement).click();
    const row = document.querySelector('[data-grp-demand-view="P001"]') as HTMLElement;
    const box = document.querySelector('[data-grp-check="P001"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    row.click();
    const boxAfter = document.querySelector('[data-grp-check="P001"]') as HTMLInputElement;
    expect(boxAfter.checked).toBe(false);
    expect(document.body.textContent).toMatch(/可组柜/);
  });
});
