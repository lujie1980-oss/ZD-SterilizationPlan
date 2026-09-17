import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { STORAGE_KEY } from '../../data/config-defaults';
import { mountSterilizationApp, waitEl } from '../create-app';
import { MASTER_HEADERS } from '../../domain/master-data-io';
import { usePlanStore } from '../stores/planStore';

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

async function captureDownload(click: () => void): Promise<{ filename: string; blob: Blob; content: string }> {
  const blobs: Blob[] = [];
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origClick = HTMLAnchorElement.prototype.click;
  let filename = '';
  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob);
    return 'blob:c6-test';
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
      typeof blob.text === 'function'
        ? await blob.text()
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blob);
          });
    return { filename, blob, content };
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    HTMLAnchorElement.prototype.click = origClick;
  }
}

const IMPORTABLE = [
  { path: '/master/cabinets', entity: 'cabinets' as const, page: '#page-cabinets' },
  { path: '/master/trays', entity: 'trays' as const, page: '#page-trays' },
  { path: '/master/processes', entity: 'processes' as const, page: '#page-processes' },
  { path: '/master/boxspecs', entity: 'box_specs' as const, page: '#page-boxspecs' },
];

describe('C6 主数据导入导出 UI', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('C6-01: /master 四实体可导出 CSV 与 XLSX，表头与契约一致', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    for (const tab of IMPORTABLE) {
      await router.push(tab.path);
      await waitEl(tab.page);
      await nextTick();
      const csv = await captureDownload(() => {
        (document.querySelector('#btnMasterExportCsv') as HTMLButtonElement).click();
      });
      expect(csv.filename).toMatch(new RegExp(`${tab.entity}\\.csv$`));
      expect(csv.content.replace(/^\ufeff/, '').split(/\r?\n/)[0]).toBe(MASTER_HEADERS[tab.entity].join(','));

      const xlsx = await captureDownload(() => {
        (document.querySelector('#btnMasterExportXlsx') as HTMLButtonElement).click();
      });
      expect(xlsx.filename).toMatch(new RegExp(`${tab.entity}\\.xlsx$`));
      expect(xlsx.blob.size).toBeGreaterThan(20);
      expect(xlsx.blob.type).toMatch(/spreadsheetml|officedocument/);
    }
    app.unmount();
  });

  it('C6-02: 模板列=导入头；客户规则仅导出', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    for (const tab of IMPORTABLE) {
      await router.push(tab.path);
      await waitEl(tab.page);
      const tmpl = await captureDownload(() => {
        (document.querySelector('#btnMasterTemplateCsv') as HTMLButtonElement).click();
      });
      expect(tmpl.content.replace(/^\ufeff/, '').split(/\r?\n/)[0]).toBe(MASTER_HEADERS[tab.entity].join(','));
      expect(document.querySelector('#btnMasterImport')).toBeTruthy();
      expect(document.querySelector('#btnMasterTemplateXlsx')).toBeTruthy();
    }
    await router.push('/master/customer-rules');
    await waitEl('#page-customer-rules');
    expect(document.querySelector('#btnMasterExportCsv')).toBeTruthy();
    expect(document.querySelector('#btnMasterExportXlsx')).toBeTruthy();
    const importBtn = document.querySelector('#btnMasterImport') as HTMLButtonElement | null;
    const tmplBtn = document.querySelector('#btnMasterTemplateCsv') as HTMLButtonElement | null;
    if (importBtn) {
      expect(importBtn.disabled).toBe(true);
      expect(importBtn.getAttribute('title') || importBtn.getAttribute('data-tip') || '').toMatch(/P1/);
    } else {
      expect(importBtn).toBeNull();
    }
    if (tmplBtn) {
      expect(tmplBtn.disabled).toBe(true);
    }
    app.unmount();
  });

  it('C6-03/04: 合法导入确认后列表可见；硬错误确认按钮禁用且不写入', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    const plan = usePlanStore();
    await router.push('/master/cabinets');
    await waitEl('#page-cabinets');
    const before = plan.masterCabinets.length;

    const headers = MASTER_HEADERS.cabinets.join(',');
    const good = 'cab-77,柜77,柜77,新,70,70,70,可用,4,导入,合法';
    await plan.previewMasterImport('cabinets', enc(`\ufeff${headers}\n${good}`), 'csv');
    await nextTick();
    expect(document.querySelector('#masterImportDrawer')).toBeTruthy();
    const confirm = document.querySelector('#btnMasterConfirmImport') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(plan.masterCabinets.length).toBe(before);
    confirm.click();
    await nextTick();
    expect(plan.masterCabinets.some((c) => c.canonicalId === 'cab-77')).toBe(true);

    const bad = `${headers}\n,,,新,70,70,70,可用,4,,缺主键`;
    await plan.previewMasterImport('cabinets', enc(bad), 'csv');
    await nextTick();
    const confirm2 = document.querySelector('#btnMasterConfirmImport') as HTMLButtonElement;
    expect(confirm2.disabled).toBe(true);
    expect(document.querySelector('#masterImportDrawer')?.textContent).toContain('MD_REQUIRED');
    app.unmount();
  });

  it('C6-05: 导入只改主数据存储，plan 交易切片不变', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    const plan = usePlanStore();
    plan.seedDemoFurnaceLoadsIfEmpty();
    plan.persist();
    const planBefore = localStorage.getItem(STORAGE_KEY);
    expect(planBefore).toBeTruthy();
    const snap = JSON.parse(planBefore!);
    const contentsHash = JSON.stringify(snap.contents || snap.furnaces);
    const tasksHash = JSON.stringify(snap.tasks || []);
    const configHash = JSON.stringify(snap.config);
    const headers = MASTER_HEADERS.cabinets.join(',');
    const good = 'cab-66,柜66,柜66,老,50,50,50,报废,4,,停用导入';
    await plan.previewMasterImport('cabinets', enc(`\ufeff${headers}\n${good}`), 'csv');
    (document.querySelector('#btnMasterConfirmImport') as HTMLButtonElement).click();
    await nextTick();
    const planAfter = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(JSON.stringify(planAfter.contents || planAfter.furnaces)).toBe(contentsHash);
    expect(JSON.stringify(planAfter.tasks || [])).toBe(tasksHash);
    expect(JSON.stringify(planAfter.config)).toBe(configHash);
    expect(planAfter.virtualLines || []).toEqual(snap.virtualLines || []);
    expect(plan.masterCabinets.some((c) => c.canonicalId === 'cab-66' && c.status === '报废')).toBe(true);
    await router.push('/master/cabinets');
    await waitEl('#page-cabinets');
    expect(document.querySelector('#page-cabinets')?.textContent).toContain('柜66');
    app.unmount();
  });

  it('C6-06: 顶栏与其它一级菜单无主数据导入/模板入口', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    const { app, router } = await mountSterilizationApp();
    const others = ['/demand', '/pack', '/gantt', '/release'];
    for (const path of others) {
      await router.push(path);
      await nextTick();
      expect(document.querySelector('#btnMasterImport')).toBeNull();
      expect(document.querySelector('#btnMasterTemplateCsv')).toBeNull();
      expect(document.querySelector('.topbar')?.textContent).not.toContain('下载模板');
      expect(document.querySelector('.topbar')?.textContent).not.toMatch(/主数据导入/);
    }
    await router.push('/master/cabinets');
    await waitEl('#page-cabinets');
    expect(document.querySelector('#btnMasterImport')).toBeTruthy();
    app.unmount();
  });

  it('Vue 不直接读写 localStorage；主数据持久化走 planStore', () => {
    const vueFiles = walk(join(root, 'src')).filter((f) => f.endsWith('.vue'));
    for (const f of vueFiles) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/localStorage/);
    }
    const store = readFileSync(join(root, 'src/app/stores/planStore.ts'), 'utf8');
    expect(store).toMatch(/previewMasterImport|confirmMasterImport|persistMaster/);
  });
});

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
