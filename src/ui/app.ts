import {
  DEFAULT_DATE,
  DEMO_MIN_CABINETS,
  DEMO_MIN_LOADS,
  PLAN_SEED_VERSION,
  isDemoSeedEnabled,
} from '../data/config-defaults';
import { BOX_SPEC_CONCEPT_COUNT, BOX_SPECS } from '../data/seed-boxspecs';
import { CABINETS, cabinetById, usableCabinets } from '../data/seed-cabinets';
import { getDemoFurnaceSeed } from '../data/seed-demo-plan';
import { createSeedPool } from '../data/seed-pool';
import { PROCESSES, processMinLoad } from '../data/seed-processes';
import { addDays, dayOffset, fmtDate, fmtDateTime } from '../domain/dates';
import type { AppConfig, EntryLoad, FurnaceRun, Shift, StockLine, ValidationIssue } from '../domain/entities';
import { buildEntryLoads } from '../domain/entry-scheduler';
import { buildDayPlanCsv } from '../domain/export-csv';
import {
  assignedIds,
  currentFurnaces,
  furnaceBoxes,
  furnaceVol,
  isPlanSparse,
  mergeVirtualLinesIntoPool,
  needsSplit,
  upsertVirtualLine,
  visibleUnassignedPool,
} from '../domain/pool';
import { canAddFurnace, sortIssues, validateAll, validateFurnace } from '../domain/rule-engine';
import { applySplit, findSplitTarget } from '../domain/split-wizard';
import { suggestCombineD002Cab9 } from '../domain/suggest-combine';
import { loadPlan, savePlan, type LoadedPlan } from '../persistence/plan-store-v2';
import { $, $$, $opt, escapeHtml, toast } from './dom';

type Page = 'workbench' | 'furnace-plan' | 'pool' | 'cabinets' | 'processes' | 'boxspecs' | 'validation';

interface UiState {
  page: Page;
  date: string;
  shift: Shift;
  selectedPool: Set<string>;
  selectedFurnaceId: string | null;
  furnaces: FurnaceRun[];
  filters: { q: string; customer: string; process: string; urgentOnly: boolean };
  config: AppConfig;
  nextFurnaceSeq: number;
  fpStartDate: string;
  fpHorizon: number;
  fpShiftFilter: string;
  fpSelectedCab: string | null;
  fpLoads: EntryLoad[];
  fpConflicts: ValidationIssue[];
  virtualLines: StockLine[];
  planSeedVersion: number;
  pool: StockLine[];
}

const PAGE_TITLES: Record<Page, string> = {
  workbench: '日排产工作台',
  'furnace-plan': '进炉计划 · 工艺周期甘特',
  pool: '待灭菌可排池',
  cabinets: '主数据 · 灭菌柜',
  processes: '主数据 · 工艺与指定柜',
  boxspecs: '主数据 · 箱规',
  validation: '校验中心',
};

let state: UiState;

function persist(): void {
  const plan: LoadedPlan = {
    date: state.date,
    shift: state.shift,
    furnaces: state.furnaces,
    nextFurnaceSeq: state.nextFurnaceSeq,
    virtualLines: state.virtualLines,
    config: state.config,
    planSeedVersion: state.planSeedVersion,
    sparseWiped: false,
  };
  savePlan(plan);
}

function poolById(id: string): StockLine | undefined {
  return state.pool.find((p) => p.id === id) || state.virtualLines.find((p) => p.id === id);
}

function ruleCtx(sameShift = currentFurnaces(state.furnaces, state.date, state.shift)) {
  return {
    cabinets: CABINETS,
    processes: PROCESSES,
    poolById,
    config: state.config,
    sameShiftFurnaces: sameShift,
  };
}

function minTarget(process: string): number {
  return processMinLoad(process, state.config.load.d002MinM3, state.config.load.defaultMinM3, PROCESSES);
}

function pendingTag(text?: string): string {
  if (!state.config.showPendingTags) return '';
  return `<span class="tag tag-pending">${escapeHtml(text || '待确认')}</span>`;
}

function seedDemoFurnaceLoadsIfEmpty(): boolean {
  if (!isDemoSeedEnabled(state.config)) return false;
  if (!isPlanSparse(state.furnaces, DEMO_MIN_LOADS, DEMO_MIN_CABINETS)) {
    if ((state.planSeedVersion || 0) < PLAN_SEED_VERSION) {
      state.planSeedVersion = PLAN_SEED_VERSION;
      persist();
    }
    return false;
  }
  state.furnaces = [];
  state.nextFurnaceSeq = 1;
  state.selectedFurnaceId = null;
  state.pool = mergeVirtualLinesIntoPool(state.pool, state.virtualLines);

  getDemoFurnaceSeed().forEach((d) => {
    const free = d.lines.filter((id) => poolById(id) && !assignedIds(state.furnaces).has(id));
    if (!free.length) return;
    state.furnaces.push({
      id: `F${state.nextFurnaceSeq++}`,
      cabinetId: d.cabinetId,
      shift: d.shift,
      date: d.date,
      lines: free,
      demoSeed: true,
    });
  });
  state.planSeedVersion = PLAN_SEED_VERSION;
  persist();
  return true;
}

function syncFurnacePlan(opts?: { silent?: boolean }): void {
  if (!state.fpStartDate) state.fpStartDate = state.date || DEFAULT_DATE;
  const seeded = seedDemoFurnaceLoadsIfEmpty();
  const { loads, conflicts } = buildEntryLoads({
    furnaces: state.furnaces,
    cabinets: CABINETS,
    processes: PROCESSES,
    config: state.config,
    poolById,
    epoch: DEFAULT_DATE,
  });
  state.fpLoads = loads;
  state.fpConflicts = conflicts;
  if (!opts?.silent) {
    toast(
      seeded
        ? `已同步装炉结果（并写入演示炉次 ${state.fpLoads.length} 条）`
        : `已同步装炉结果 · ${state.fpLoads.length} 条进炉载荷`,
      seeded ? 'info' : 'success',
    );
  }
}

function collectIssues(): ValidationIssue[] {
  const furns = currentFurnaces(state.furnaces, state.date, state.shift);
  const furnaceIssues = validateAll(furns, ruleCtx(furns));
  return sortIssues([...furnaceIssues, ...state.fpConflicts]);
}

function navigate(page: Page): void {
  state.page = page;
  if (page === 'furnace-plan') {
    if (!state.fpStartDate) state.fpStartDate = state.date || DEFAULT_DATE;
    syncFurnacePlan({ silent: true });
  }
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  const exp = $opt('#btnExport');
  if (exp) exp.style.display = page === 'furnace-plan' ? 'none' : '';
  $('#topbarTitle').textContent = PAGE_TITLES[page] || page;
  render();
}

function addFurnace(cabinetId: string): void {
  const check = canAddFurnace(cabinetId, ruleCtx());
  if (!check.ok) {
    toast(check.issue.msg || '该灭菌柜不可用', 'error');
    return;
  }
  const id = `F${state.nextFurnaceSeq++}`;
  state.furnaces.push({ id, cabinetId, shift: state.shift, date: state.date, lines: [] });
  state.selectedFurnaceId = id;
  persist();
  render();
  toast(`已新建炉次 ${id} → ${cabinetId}`);
}

function assignSelected(): void {
  if (!state.selectedFurnaceId) {
    toast('请先选中右侧炉次卡片', 'warn');
    return;
  }
  const f = state.furnaces.find((x) => x.id === state.selectedFurnaceId);
  if (!f) return;
  const assigned = assignedIds(state.furnaces);
  const toAdd = [...state.selectedPool].filter((id) => !assigned.has(id));
  if (!toAdd.length) {
    toast('请勾选可排池中未分配的行', 'warn');
    return;
  }
  toAdd.forEach((id) => f.lines.push(id));
  state.selectedPool.clear();
  persist();
  render();
  toast(`已分配 ${toAdd.length} 行至 ${f.cabinetId}（${f.id}）`);
}

function removeFromFurnace(furnaceId: string, lineId: string): void {
  const f = state.furnaces.find((x) => x.id === furnaceId);
  if (!f) return;
  f.lines = f.lines.filter((id) => id !== lineId);
  persist();
  render();
}

function deleteFurnace(furnaceId: string): void {
  state.furnaces = state.furnaces.filter((f) => f.id !== furnaceId);
  if (state.selectedFurnaceId === furnaceId) state.selectedFurnaceId = null;
  persist();
  render();
  toast('已删除炉次');
}

function suggestCombine(): void {
  const assigned = assignedIds(state.furnaces);
  const { result, furnaces, nextSeq, selectedFurnaceId } = suggestCombineD002Cab9({
    pool: state.pool,
    furnaces: state.furnaces,
    assigned,
    date: state.date,
    shift: state.shift,
    nextSeq: state.nextFurnaceSeq,
    minLoad: state.config.load.d002MinM3,
    poolById,
  });
  if (!result.ok) {
    toast(result.message, 'info');
    return;
  }
  state.furnaces = furnaces;
  state.nextFurnaceSeq = nextSeq;
  if (selectedFurnaceId) state.selectedFurnaceId = selectedFurnaceId;
  persist();
  render();
  toast(result.message, 'info');
}

function openSplitWizard(): void {
  const assigned = assignedIds(state.furnaces);
  const target = findSplitTarget(state.pool, state.selectedPool, assigned, state.config, poolById);
  if (!target) {
    toast('当前无可拆大单，请勾选体积过大或箱数超限的行', 'warn');
    return;
  }
  showSplitModal(target);
}

function showSplitModal(line: StockLine): void {
  const halfBoxes1 = Math.ceil(line.boxes / 2);
  const halfBoxes2 = line.boxes - halfBoxes1;
  const cabOpts = line.allowed
    .map((c) => {
      const cab = cabinetById(c);
      const disabled = !cab || cab.status === '报废';
      return `<option value="${escapeHtml(c)}" ${disabled ? 'disabled' : ''}>${escapeHtml(c)}${cab ? `（${cab.base}基地 · ${cab.capacity}m³）` : '（主数据缺失）'}</option>`;
    })
    .join('');

  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <div class="modal-hd">
        <span>拆炉向导 · ${escapeHtml(line.id)}</span>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-bd">
        <p style="margin-bottom:12px">将大单 <strong>${escapeHtml(line.name)}</strong>（${line.boxes}箱 / ${line.vol}m³）拆为两炉载荷。</p>
        <div class="config-bar" style="margin-bottom:12px">
          <span class="tag tag-pending">待确认</span>
          <span>拆炉虚拟行写入 plan v2.virtualLines，刷新可还原；不回写库存。</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div class="stat-box">
            <div class="lbl">炉次 A 箱数</div>
            <input class="input" id="splitA" type="number" value="${halfBoxes1}" min="1" max="${line.boxes - 1}" style="width:100%;margin-top:6px;font-size:18px;font-weight:600">
          </div>
          <div class="stat-box">
            <div class="lbl">炉次 B 箱数</div>
            <div class="num" id="splitBLabel" style="margin-top:6px">${halfBoxes2}</div>
          </div>
        </div>
        <div style="margin-bottom:8px">
          <span class="label">目标灭菌柜</span>
          <select class="select" id="splitCab" style="width:100%;margin-top:4px">${cabOpts}</select>
        </div>
        <p class="hint">单箱体积 ${line.boxVol} m³ · 工艺 ${escapeHtml(line.process)}
          ${line.boxVol >= state.config.box.largeBoxVol ? ` · <span class="tag tag-pending">单箱≥${state.config.box.largeBoxVol} → 每炉≤${state.config.box.maxBoxesWhenLarge}箱</span>` : ''}
        </p>
      </div>
      <div class="modal-ft">
        <button class="btn" type="button" data-act="cancel">取消</button>
        <button class="btn btn-primary" type="button" data-act="ok">确认拆炉并分配</button>
      </div>
    </div>`;
  document.body.appendChild(mask);

  const inpA = mask.querySelector('#splitA') as HTMLInputElement;
  const lblB = mask.querySelector('#splitBLabel') as HTMLElement;
  inpA.addEventListener('input', () => {
    let a = parseInt(inpA.value, 10) || 1;
    if (a < 1) a = 1;
    if (a > line.boxes - 1) a = line.boxes - 1;
    lblB.textContent = String(line.boxes - a);
  });

  const close = () => mask.remove();
  (mask.querySelector('.modal-close') as HTMLElement).onclick = close;
  (mask.querySelector('[data-act=cancel]') as HTMLElement).onclick = close;
  (mask.querySelector('[data-act=ok]') as HTMLElement).onclick = () => {
    let a = parseInt(inpA.value, 10) || 1;
    const cab = (mask.querySelector('#splitCab') as HTMLSelectElement).value;
    if (!cab) {
      toast('请选择目标灭菌柜（允许列表 ∩ 柜台账）', 'warn');
      return;
    }
    const applied = applySplit({
      parent: line,
      boxesA: a,
      cabinetId: cab,
      date: state.date,
      shift: state.shift,
      nextSeq: state.nextFurnaceSeq,
    });
    const upA = upsertVirtualLine(state.virtualLines, state.pool, applied.rowA);
    const upB = upsertVirtualLine(upA.virtualLines, upA.pool, applied.rowB);
    state.virtualLines = upB.virtualLines;
    state.pool = upB.pool;
    state.selectedPool.delete(line.id);
    state.furnaces.push(...applied.furnaces);
    state.nextFurnaceSeq = applied.nextSeq;
    state.selectedFurnaceId = applied.furnaces[0]!.id;
    persist();
    close();
    render();
    toast(`已拆为两炉：${applied.rowA.id}（${applied.rowA.boxes}箱）/ ${applied.rowB.id}（${applied.rowB.boxes}箱）→ ${cab}`);
  };
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
}

function exportCSV(): void {
  const issues = collectIssues();
  const hasError = issues.some((i) => i.sev === 'error');
  if (hasError && state.config.export.blockOnError) {
    toast('存在硬错误，已按配置阻止导出', 'error');
    return;
  }
  const csv = buildDayPlanCsv({
    date: state.date,
    shift: state.shift,
    furnaces: currentFurnaces(state.furnaces, state.date, state.shift),
    cabinets: CABINETS,
    poolById,
  });
  if (csv.rowCount === 0) {
    toast('当前班次无已排数据可导出', 'warn');
    return;
  }
  const blob = new Blob([csv.content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = csv.filename;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(hasError ? '日计划 CSV 已下载（当前存在硬错误，请回工作台修正）' : '日计划 CSV 已下载', hasError ? 'warn' : 'success');
}

function render(): void {
  if (state.page === 'workbench') renderWorkbench();
  else if (state.page === 'furnace-plan') renderFurnacePlan();
  else if (state.page === 'pool') renderPool();
  else if (state.page === 'cabinets') renderCabinets();
  else if (state.page === 'processes') renderProcesses();
  else if (state.page === 'boxspecs') renderBoxSpecs();
  else if (state.page === 'validation') renderValidation();
}

function renderWorkbench(): void {
  const issues = validateAll(
    currentFurnaces(state.furnaces, state.date, state.shift),
    ruleCtx(),
  );
  const furns = currentFurnaces(state.furnaces, state.date, state.shift);
  const totalVol = furns.reduce((s, f) => s + furnaceVol(f, poolById), 0);
  const errCount = issues.filter((i) => i.sev === 'error').length;
  const warnCount = issues.filter((i) => i.sev === 'warning').length;

  ($('#wbDate') as HTMLInputElement).value = state.date;
  $$('#wbShiftTabs .shift-tab').forEach((t) => t.classList.toggle('active', t.dataset.shift === state.shift));
  $('#chipVol').textContent = `${totalVol.toFixed(1)} m³`;
  $('#chipTarget').textContent = furns.length ? `${furns.length} 炉` : '—';
  $('#chipIssues').textContent = String(errCount + warnCount);
  $('#chipIssuesWrap').className = `chip ${errCount ? 'err' : warnCount ? 'warn' : 'ok'}`;
  $('#cfgFiller').classList.toggle('on', state.config.allowFiller);
  $('#cfgMix').classList.toggle('on', state.config.mixCustomerWarn);
  ($('#cfgPreheat') as HTMLInputElement).value = String(state.config.cycle.preheatDays);
  ($('#cfgSterilize') as HTMLInputElement).value = String(state.config.cycle.sterilizeDays);
  ($('#cfgBiDays') as HTMLInputElement).value = String(state.config.cycle.biDays);
  ($('#cfgD002Min') as HTMLInputElement).value = String(state.config.load.d002MinM3);
  ($('#cfgDefaultMin') as HTMLInputElement).value = String(state.config.load.defaultMinM3);

  let list = visibleUnassignedPool(state.pool, state.furnaces, state.config);
  const f = state.filters;
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter((p) =>
      [p.name, p.ref, p.customer, p.process, p.wo, p.id].join('|').toLowerCase().includes(q),
    );
  }
  if (f.customer) list = list.filter((p) => p.customer === f.customer);
  if (f.process) list = list.filter((p) => p.process === f.process);
  if (f.urgentOnly) list = list.filter((p) => p.urgent);

  const customers = [...new Set(state.pool.filter((p) => !p.splitOf).map((p) => p.customer))];
  const processes = [...new Set(state.pool.filter((p) => !p.splitOf).map((p) => p.process))];
  $('#filterCustomer').innerHTML =
    '<option value="">全部客户</option>' +
    customers.map((c) => `<option value="${escapeHtml(c)}" ${f.customer === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  $('#filterProcess').innerHTML =
    '<option value="">全部工艺</option>' +
    processes.map((c) => `<option value="${escapeHtml(c)}" ${f.process === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  ($('#filterQ') as HTMLInputElement).value = f.q;
  ($('#filterUrgent') as HTMLInputElement).checked = f.urgentOnly;

  const tbody = $('#poolTableBody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty"><div class="emoji">📭</div><div>无可排行（已全部排入或筛选为空）</div></div></td></tr>`;
  } else {
    tbody.innerHTML = list
      .map((p) => {
        const checked = state.selectedPool.has(p.id) ? 'checked' : '';
        const short = p.name.length > 10 ? `${p.name.slice(0, 10)}…` : p.name;
        return `<tr class="${checked ? 'selected' : ''}" data-id="${escapeHtml(p.id)}">
          <td><input type="checkbox" data-pool="${escapeHtml(p.id)}" ${checked}></td>
          <td>${p.urgent ? '<span class="tag tag-urgent">加急</span>' : ''}
              ${p.useCab21 || p.pendingAllow ? pendingTag() : ''}
              ${p.suggest ? `<span class="tag tag-purple" title="${escapeHtml(p.suggest)}">拼</span>` : ''}
              ${needsSplit(p, state.config) ? '<span class="tag tag-orange">需拆炉</span>' : ''}
          </td>
          <td class="mono">${escapeHtml(p.id)}</td>
          <td title="${escapeHtml(p.name)}">${escapeHtml(short)}</td>
          <td>${escapeHtml(p.process)}</td>
          <td>${escapeHtml(p.customer.replace('C-', ''))}</td>
          <td>${p.boxes}</td>
          <td><strong>${p.vol}</strong></td>
          <td class="hint">${escapeHtml(p.allowed.join('/'))}</td>
        </tr>`;
      })
      .join('');
  }
  $('#poolCount').textContent = `可排 ${list.length} 行`;

  const grid = $('#furnaceGrid');
  if (!furns.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1;background:#fff;border-radius:8px;border:1px dashed #d9d9d9">
        <div class="emoji">🏭</div>
        <div>本班次尚未建炉</div>
        <div class="hint">点击下方「添加炉次」选择灭菌柜，或使用「建议拼炉」</div>
      </div>`;
  } else {
    grid.innerHTML = furns
      .map((fu) => {
        const vol = furnaceVol(fu, poolById);
        const boxes = furnaceBoxes(fu, poolById);
        const lines = fu.lines.map(poolById).filter((l): l is StockLine => Boolean(l));
        const proc = lines[0]?.process;
        const target = proc ? minTarget(proc) : state.config.load.defaultMinM3;
        const pct = Math.min(100, (vol / target) * 100);
        const fillClass = vol >= target ? 'ok' : 'low';
        const fissues = validateFurnace(fu, ruleCtx());
        const hasErr = fissues.some((i) => i.sev === 'error');
        const hasWarn = fissues.some((i) => i.sev === 'warning');
        const cab = cabinetById(fu.cabinetId);
        const sel = state.selectedFurnaceId === fu.id ? 'selected' : '';
        const borderCls = hasErr ? 'has-error' : hasWarn ? 'has-warn' : '';
        return `<div class="furnace-card ${sel} ${borderCls}" data-fid="${escapeHtml(fu.id)}">
          <div class="furnace-hd" data-select-furnace="${escapeHtml(fu.id)}">
            <div>
              <div class="fname">${escapeHtml(fu.cabinetId)}
                ${cab?.pending ? pendingTag('主数据待确认') : ''}
                <span class="hint">· ${escapeHtml(fu.id)}</span>
              </div>
              <div class="furnace-stats">
                <span>${cab?.base || ''}基地</span>
                <span>已装 <strong>${vol.toFixed(1)}</strong> m³</span>
                <span>${boxes} 箱</span>
                <span>目标 ≥${target}</span>
              </div>
              <div class="progress-bar"><div class="fill ${fillClass}" style="width:${pct}%"></div></div>
            </div>
          </div>
          <div class="furnace-body">
            ${
              lines.length
                ? lines
                    .map(
                      (l) => `
              <div class="furnace-row">
                <span>${l.urgent ? '🔥' : ''} ${escapeHtml(l.id)} ${escapeHtml(l.name.slice(0, 8))} · ${l.vol}m³</span>
                <span class="rm" data-rm="${escapeHtml(fu.id)}|${escapeHtml(l.id)}" title="移除">×</span>
              </div>`,
                    )
                    .join('')
                : '<div class="empty" style="padding:16px"><div class="hint">空炉 · 勾选左侧行后点「分配」</div></div>'
            }
          </div>
          <div class="furnace-badges">
            ${fissues
              .slice(0, 3)
              .map(
                (i) =>
                  `<span class="tag ${i.sev === 'error' ? 'tag-red' : i.sev === 'warning' ? 'tag-orange' : 'tag-blue'}">${i.sev === 'error' ? '错误' : i.sev === 'warning' ? '警告' : '提示'}</span>`,
              )
              .join('')}
            ${fissues.length > 3 ? `<span class="tag tag-default">+${fissues.length - 3}</span>` : ''}
          </div>
          <div class="furnace-actions">
            <button class="btn btn-sm btn-danger" data-del-furnace="${escapeHtml(fu.id)}">删除炉次</button>
          </div>
        </div>`;
      })
      .join('');
  }

  $('#addCabSelect').innerHTML = usableCabinets()
    .map(
      (c) =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.id)}（${c.base} · ${c.capacity}m³${c.pending ? ' · 待确认' : ''}）</option>`,
    )
    .join('');
}

function renderPool(): void {
  const eligible = state.pool.filter((p) => !p.splitOf && p.stockStatus === '非限制' && state.config.eligibility.locations.includes(p.loc));
  $('#fullPoolBody').innerHTML = eligible
    .map(
      (p) => `
      <tr>
        <td class="mono">${escapeHtml(p.id)}</td>
        <td>${escapeHtml(p.factory)}</td>
        <td>${escapeHtml(p.workshop)}</td>
        <td>${escapeHtml(p.matType)}</td>
        <td class="mono">${escapeHtml(p.ref)}</td>
        <td>${escapeHtml(p.name)} ${p.urgent ? '<span class="tag tag-urgent">加急</span>' : ''}
            ${p.suggest ? `<span class="tag tag-purple">${escapeHtml(p.suggest)}</span>` : ''}
            ${p.useCab21 ? pendingTag('含柜21') : ''}
            ${p.splitOf ? '' : ''}
        </td>
        <td>${escapeHtml(p.customer)}</td>
        <td>${escapeHtml(p.due)}</td>
        <td class="mono">${escapeHtml(p.wo)}</td>
        <td>${p.boxes}</td>
        <td>${p.boxVol}</td>
        <td><strong>${p.vol}</strong></td>
        <td>${escapeHtml(p.batch)}</td>
        <td>${escapeHtml(p.loc)}</td>
        <td>${escapeHtml(p.stockStatus)}</td>
        <td>${escapeHtml(p.process)}</td>
        <td>${escapeHtml(p.allowed.join(', '))}</td>
      </tr>`,
    )
    .join('');
  $('#poolStatTotal').textContent = String(eligible.length);
  $('#poolStatVol').textContent = eligible.reduce((s, p) => s + p.vol, 0).toFixed(1);
  $('#poolStatUrgent').textContent = String(eligible.filter((p) => p.urgent).length);
}

function renderCabinets(): void {
  $('#cabBody').innerHTML = CABINETS.map(
    (c) => `
      <tr>
        <td><strong>${escapeHtml(c.id)}</strong></td>
        <td>${c.base}基地</td>
        <td>${c.capacity} m³</td>
        <td>${
          c.status === '可用'
            ? '<span class="tag tag-green">可用</span>'
            : c.status === '报废'
              ? '<span class="tag tag-red">报废</span>'
              : pendingTag('待确认·未进产能主数据')
        }</td>
        <td>${escapeHtml(c.note || '—')}</td>
        <td>${c.tags.map((t) => `<span class="tag tag-blue">${escapeHtml(t)}</span>`).join(' ') || '—'}</td>
      </tr>`,
  ).join('');
}

function renderProcesses(): void {
  $('#procBody').innerHTML = PROCESSES.map(
    (p) => `
      <tr>
        <td><strong>${escapeHtml(p.code)}</strong> ${p.pending ? pendingTag() : ''}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.cabinets.map((c) => `<span class="tag tag-default">${escapeHtml(c)}</span>`).join(' ')}</td>
        <td>${p.aerateDays}d ${p.aerateConfirmed ? '' : pendingTag('解析待确认')}</td>
        <td>${escapeHtml(p.note || '—')} ${p.pending ? pendingTag('规则待确认') : ''}</td>
      </tr>`,
  ).join('');
}

function renderBoxSpecs(): void {
  const cfg = state.config;
  $('#boxSpecConcept').textContent = String(BOX_SPEC_CONCEPT_COUNT);
  $('#boxSpecSample').textContent = String(BOX_SPECS.length);
  $('#boxRuleGrid').innerHTML = `
    <div class="rule-card">
      <h4>单箱 ≥ ${cfg.box.largeBoxVol} m³</h4>
      <p>触发每炉箱数上限 <strong>≤ ${cfg.box.maxBoxesWhenLarge} 箱</strong>。超限须拆炉或减载。</p>
    </div>
    <div class="rule-card">
      <h4>D002 最低拼载</h4>
      <p>单炉体积目标 <strong>≥ ${cfg.load.d002MinM3} m³</strong>。不足时告警，建议与同工艺拼货。</p>
    </div>
    <div class="rule-card">
      <h4>其他工艺目标拼载</h4>
      <p>单炉体积目标 <strong>≥ ${cfg.load.defaultMinM3} m³</strong>。是否允许填充物补足见工作台开关。</p>
    </div>
    <div class="rule-card pending">
      <h4>~${cfg.box.boardsPerFurnaceHint} 板/炉 <span class="tag tag-pending">经验值·待确认</span></h4>
      <p>现场经验参考值，未纳入硬约束引擎；仅作排产提示。</p>
    </div>`;
  $('#boxSpecBody').innerHTML = BOX_SPECS.map(
    (b) => `
      <tr>
        <td class="mono">${escapeHtml(b.sku)}</td>
        <td>${escapeHtml(b.name)}</td>
        <td><strong>${b.vol}</strong> m³</td>
        <td>${b.vol >= cfg.box.largeBoxVol ? `<span class="tag tag-orange">≥${cfg.box.largeBoxVol} → ≤${cfg.box.maxBoxesWhenLarge}箱/炉</span>` : '<span class="tag tag-green">常规</span>'}
            ${b.note ? `<span class="hint"> ${escapeHtml(b.note)}</span>` : ''}
        </td>
      </tr>`,
  ).join('');
}

function renderValidation(): void {
  const built = buildEntryLoads({
    furnaces: state.furnaces,
    cabinets: CABINETS,
    processes: PROCESSES,
    config: state.config,
    poolById,
    epoch: DEFAULT_DATE,
  });
  state.fpLoads = built.loads;
  state.fpConflicts = built.conflicts;
  const issues = collectIssues();
  const box = $('#issueList');
  $('#valErr').textContent = String(issues.filter((i) => i.sev === 'error').length);
  $('#valWarn').textContent = String(issues.filter((i) => i.sev === 'warning').length);
  $('#valInfo').textContent = String(issues.filter((i) => i.sev === 'info').length);
  if (!issues.length) {
    box.innerHTML = `<div class="empty"><div class="emoji">✅</div><div>当前班次无校验问题</div><div class="hint">在工作台分配炉次后点击「运行校验」</div></div>`;
    return;
  }
  box.innerHTML = issues
    .map(
      (i) => `
      <div class="issue-item" data-jump="${escapeHtml(i.furnaceId || '')}">
        <div class="issue-sev">
          <span class="tag ${i.sev === 'error' ? 'tag-red' : i.sev === 'warning' ? 'tag-orange' : 'tag-blue'}">
            ${i.sev === 'error' ? '错误' : i.sev === 'warning' ? '警告' : '信息'}
          </span>
        </div>
        <div class="issue-body">
          <div class="msg">${escapeHtml(i.msg)}</div>
          <div class="meta">代码 ${escapeHtml(i.code)}${i.furnaceId ? ` · 炉次 ${escapeHtml(i.furnaceId)}` : ''}${i.pendingFlag ? ' · 待确认' : ''} · 点击跳转工作台</div>
        </div>
      </div>`,
    )
    .join('');
}

function renderFurnacePlan(): void {
  if (!state.fpLoads.length) syncFurnacePlan({ silent: true });
  const start = state.fpStartDate || state.date || DEFAULT_DATE;
  const horizon = state.fpHorizon || state.config.fp.defaultHorizon;
  const dayW = 72;

  ($('#fpStartDate') as HTMLInputElement).value = start;
  $$('#fpHorizonTabs .shift-tab').forEach((t) => {
    t.classList.toggle('active', Number(t.dataset.days) === horizon);
  });
  ($('#fpShiftFilter') as HTMLSelectElement).value = state.fpShiftFilter || '';

  let loads = state.fpLoads.slice();
  if (state.fpShiftFilter) loads = loads.filter((l) => l.shift === state.fpShiftFilter);

  const cabIds = [...new Set(loads.map((l) => l.cabinetId))];
  const cabOrder = CABINETS.map((c) => c.id);
  cabIds.sort((a, b) => {
    const ia = cabOrder.indexOf(a);
    const ib = cabOrder.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  const warnEl = $('#fpWarnBadge');
  if (state.fpConflicts.length) {
    warnEl.style.display = '';
    warnEl.textContent = `${state.fpConflicts.length} 项校验警告`;
  } else {
    warnEl.style.display = 'none';
  }

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const days = [];
  for (let i = 0; i < horizon; i++) {
    const dt = addDays(start, i);
    days.push({
      date: fmtDate(dt),
      label: `${dt.getMonth() + 1}/${dt.getDate()}`,
      wd: `周${weekdays[dt.getDay()]}`,
      weekend: dt.getDay() === 0 || dt.getDay() === 6,
    });
  }

  const gantt = $('#fpGantt');
  gantt.style.setProperty('--day-w', `${dayW}px`);

  if (!cabIds.length) {
    gantt.innerHTML = `<div class="fp-empty"><div class="emoji">📭</div><div>暂无装炉结果</div><div class="hint">请先在日排产工作台分配炉次，或点击「同步装炉结果」加载演示数据</div></div>`;
    renderFpQueue(null);
    return;
  }

  let html = '';
  html += `<div class="fp-axis-corner">柜号 / 基地</div>`;
  html += `<div class="fp-axis" style="width:${horizon * dayW}px">`;
  days.forEach((d) => {
    html += `<div class="fp-day${d.weekend ? ' weekend' : ''}" style="width:${dayW}px">
        <span class="fp-day-label">${d.label}</span>
        <span class="fp-day-wd">${d.wd}</span>
        <span class="fp-day-half"></span>
      </div>`;
  });
  html += `</div>`;

  cabIds.forEach((cabId) => {
    const cab = cabinetById(cabId);
    const cabLoads = loads.filter((l) => l.cabinetId === cabId);
    const hasConflict = cabLoads.some((l) => l.conflict);
    const maxSeq = Math.max(...cabLoads.map((l) => l.seq), 1);
    const rowH = Math.max(56, 12 + maxSeq * 26);
    const sel = state.fpSelectedCab === cabId ? 'selected' : '';
    html += `<div class="fp-cab-label ${sel}${hasConflict ? ' has-conflict' : ''}" data-fp-cab="${escapeHtml(cabId)}" style="min-height:${rowH}px">
        <div class="cab-id">${escapeHtml(cabId)}
          ${cab?.pending || cabId === '柜21' ? '<span class="tag tag-pending">待确认</span>' : ''}
          ${hasConflict ? '<span class="tag tag-red">冲突</span>' : ''}
        </div>
        <div class="cab-meta">${cab?.base || '—'}基地 · ${cab?.status || '—'} · ${cabLoads.length} 炉次</div>
      </div>`;
    html += `<div class="fp-row-track ${sel}" data-fp-cab-track="${escapeHtml(cabId)}" style="width:${horizon * dayW}px;min-height:${rowH}px;height:${rowH}px">`;
    cabLoads.forEach((load) => {
      const ph = load.phases;
      const barStart = ph.preheat ? ph.preheat.start : ph.sterilize.start;
      const barEnd = ph.bi.end;
      const left = dayOffset(start, barStart) * dayW;
      const width = dayOffset(barStart, barEnd) * dayW;
      const viewEnd = horizon * dayW;
      if (left + width < 0 || left > viewEnd) return;
      const top = 8 + (load.seq - 1) * 26;
      const segs: Array<{ cls: string; w: number }> = [];
      if (ph.preheat) segs.push({ cls: 'preheat', w: Math.max(2, dayOffset(ph.preheat.start, ph.preheat.end) * dayW) });
      segs.push({ cls: 'sterilize', w: Math.max(2, dayOffset(ph.sterilize.start, ph.sterilize.end) * dayW) });
      segs.push({ cls: 'aerate', w: Math.max(2, dayOffset(ph.aerate.start, ph.aerate.end) * dayW) });
      segs.push({ cls: 'bi', w: Math.max(2, dayOffset(ph.bi.start, ph.bi.end) * dayW) });
      const shortCust = (load.customer || '').replace(/^C-/, '');
      const label = `#${load.seq} ${load.process}/${shortCust} ${load.vol.toFixed(0)}m³`;
      const tip = JSON.stringify({
        furnaceId: load.furnaceId,
        seq: load.seq,
        customer: load.customer,
        process: load.process,
        shift: load.shift,
        vol: load.vol,
        boxes: load.boxes,
        preheat: ph.preheat ? `${fmtDateTime(ph.preheat.start)} → ${fmtDateTime(ph.preheat.end)}` : '—',
        sterilize: `${fmtDateTime(ph.sterilize.start)} → ${fmtDateTime(ph.sterilize.end)}`,
        aerate: `${fmtDateTime(ph.aerate.start)} → ${fmtDateTime(ph.aerate.end)}`,
        bi: `${fmtDateTime(ph.bi.start)} → ${fmtDateTime(ph.bi.end)}`,
        notes: load.pendingNotes.join('；') || '',
        lines: load.lineIds.join(', '),
      }).replace(/'/g, '&#39;');
      html += `<div class="fp-bar${load.conflict ? ' conflict' : ''}${load.pending ? ' pending-guess' : ''}" style="left:${left}px;width:${Math.max(width, 8)}px;top:${top}px"
          data-fp-load="${escapeHtml(load.furnaceId)}" data-fp-cab="${escapeHtml(cabId)}" data-tip='${tip}'>
          ${segs.map((s) => `<div class="fp-seg ${s.cls}" style="width:${s.w}px"></div>`).join('')}
          <div class="fp-bar-label">${escapeHtml(label)}</div>
        </div>`;
    });
    html += `</div>`;
  });

  gantt.innerHTML = html;
  const selected = state.fpSelectedCab && cabIds.includes(state.fpSelectedCab) ? state.fpSelectedCab : cabIds[0]!;
  if (!state.fpSelectedCab || !cabIds.includes(state.fpSelectedCab)) state.fpSelectedCab = selected;
  renderFpQueue(selected);
}

function renderFpQueue(cabinetId: string | null): void {
  const title = $('#fpQueueTitle');
  const sub = $('#fpQueueSub');
  const body = $('#fpQueueBody');
  if (!cabinetId) {
    title.textContent = '进炉顺序队列';
    sub.textContent = '点击柜行查看';
    body.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="hint">选择左侧柜行</div></div></td></tr>`;
    return;
  }
  const cab = cabinetById(cabinetId);
  title.textContent = `${cabinetId} · 进炉顺序队列`;
  sub.textContent = `${cab?.base || ''}基地${cab?.pending || cabinetId === '柜21' ? ' · 待确认' : ''}`;
  let loads = state.fpLoads.filter((l) => l.cabinetId === cabinetId);
  if (state.fpShiftFilter) loads = loads.filter((l) => l.shift === state.fpShiftFilter);
  loads = loads.slice().sort((a, b) => a.seq - b.seq);
  if (!loads.length) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="hint">该柜无载荷</div></div></td></tr>`;
    return;
  }
  body.innerHTML = loads
    .map((l) => {
      const ph = l.phases;
      return `<tr class="${l.conflict ? 'selected' : ''}" style="${l.conflict ? 'outline:1px solid #ff4d4f' : ''}">
        <td><strong>${l.seq}</strong>${l.conflict ? ' <span class="tag tag-red">冲突</span>' : ''}</td>
        <td class="mono">${escapeHtml(l.furnaceId)}<div class="hint">${escapeHtml(l.shift)} · ${escapeHtml(l.process)}</div></td>
        <td>${escapeHtml(fmtDateTime(ph.sterilize.start))}</td>
        <td>${escapeHtml(fmtDateTime(ph.sterilize.end))}</td>
        <td>${escapeHtml(fmtDateTime(ph.aerate.end))}${ph.aerate.pending ? ' <span class="tag tag-pending">待确认</span>' : ''}</td>
        <td>${escapeHtml(fmtDateTime(ph.bi.end))}</td>
      </tr>`;
    })
    .join('');
  const msgs = state.fpConflicts.filter((c) => c.cabinetId === cabinetId);
  if (msgs.length) {
    body.innerHTML += msgs
      .map((m) => `<tr><td colspan="6"><span class="tag tag-orange">校验</span> <span class="hint">${escapeHtml(m.msg)}</span></td></tr>`)
      .join('');
  }
}

function bind(): void {
  $$('.nav-item').forEach((n) => {
    n.addEventListener('click', () => navigate(n.dataset.page as Page));
  });
  $('#wbDate').addEventListener('change', (e) => {
    state.date = (e.target as HTMLInputElement).value;
    state.selectedFurnaceId = null;
    persist();
    render();
  });
  $$('#wbShiftTabs .shift-tab').forEach((t) => {
    t.addEventListener('click', () => {
      state.shift = t.dataset.shift as Shift;
      state.selectedFurnaceId = null;
      persist();
      render();
    });
  });
  $('#btnAssign').addEventListener('click', assignSelected);
  $('#btnSuggest').addEventListener('click', suggestCombine);
  $('#btnSplit').addEventListener('click', openSplitWizard);
  $('#btnValidate').addEventListener('click', () => {
    navigate('validation');
    toast('校验完成', 'info');
  });
  $('#btnExport').addEventListener('click', exportCSV);
  $('#btnAddFurnace').addEventListener('click', () => addFurnace(($('#addCabSelect') as HTMLSelectElement).value));
  $('#btnGotoFurnacePlan').addEventListener('click', () => {
    state.fpStartDate = state.date || DEFAULT_DATE;
    syncFurnacePlan();
    navigate('furnace-plan');
  });
  $('#btnFpSync').addEventListener('click', () => {
    syncFurnacePlan();
    renderFurnacePlan();
  });
  $('#fpStartDate').addEventListener('change', (e) => {
    state.fpStartDate = (e.target as HTMLInputElement).value || DEFAULT_DATE;
    renderFurnacePlan();
  });
  $$('#fpHorizonTabs .shift-tab').forEach((t) => {
    t.addEventListener('click', () => {
      state.fpHorizon = Number(t.dataset.days) || 14;
      renderFurnacePlan();
    });
  });
  $('#fpShiftFilter').addEventListener('change', (e) => {
    state.fpShiftFilter = (e.target as HTMLSelectElement).value;
    renderFurnacePlan();
  });
  $('#filterQ').addEventListener('input', (e) => {
    state.filters.q = (e.target as HTMLInputElement).value;
    renderWorkbench();
  });
  $('#filterCustomer').addEventListener('change', (e) => {
    state.filters.customer = (e.target as HTMLSelectElement).value;
    renderWorkbench();
  });
  $('#filterProcess').addEventListener('change', (e) => {
    state.filters.process = (e.target as HTMLSelectElement).value;
    renderWorkbench();
  });
  $('#filterUrgent').addEventListener('change', (e) => {
    state.filters.urgentOnly = (e.target as HTMLInputElement).checked;
    renderWorkbench();
  });
  $('#cfgFiller').addEventListener('click', () => {
    state.config.allowFiller = !state.config.allowFiller;
    persist();
    render();
    toast(state.config.allowFiller ? '已开启「允许填充物」开关（待确认项）' : '已关闭填充物开关', 'info');
  });
  $('#cfgMix').addEventListener('click', () => {
    state.config.mixCustomerWarn = !state.config.mixCustomerWarn;
    persist();
    render();
  });
  const bindNum = (sel: string, apply: (n: number) => void) => {
    $(sel).addEventListener('change', (e) => {
      const n = Number((e.target as HTMLInputElement).value);
      if (!Number.isFinite(n) || n < 0) return;
      apply(n);
      persist();
      if (state.fpLoads.length) syncFurnacePlan({ silent: true });
      render();
    });
  };
  bindNum('#cfgPreheat', (n) => {
    state.config.cycle.preheatDays = n;
  });
  bindNum('#cfgSterilize', (n) => {
    state.config.cycle.sterilizeDays = n;
  });
  bindNum('#cfgBiDays', (n) => {
    state.config.cycle.biDays = n;
  });
  bindNum('#cfgD002Min', (n) => {
    state.config.load.d002MinM3 = n;
  });
  bindNum('#cfgDefaultMin', (n) => {
    state.config.load.defaultMinM3 = n;
  });

  document.addEventListener('change', (e) => {
    const cb = (e.target as HTMLElement).closest('[data-pool]') as HTMLInputElement | null;
    if (cb) {
      const id = cb.dataset.pool!;
      if (cb.checked) state.selectedPool.add(id);
      else state.selectedPool.delete(id);
      renderWorkbench();
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sel = t.closest('[data-select-furnace]') as HTMLElement | null;
    if (sel) {
      state.selectedFurnaceId = sel.dataset.selectFurnace!;
      renderWorkbench();
      return;
    }
    const rm = t.closest('[data-rm]') as HTMLElement | null;
    if (rm) {
      const [fid, lid] = rm.dataset.rm!.split('|');
      removeFromFurnace(fid!, lid!);
      return;
    }
    const del = t.closest('[data-del-furnace]') as HTMLElement | null;
    if (del) {
      deleteFurnace(del.dataset.delFurnace!);
      return;
    }
    const jump = t.closest('[data-jump]') as HTMLElement | null;
    if (jump && jump.dataset.jump) {
      state.selectedFurnaceId = jump.dataset.jump;
      navigate('workbench');
      return;
    }
    const fpCab = t.closest('[data-fp-cab]') as HTMLElement | null;
    if (fpCab && !t.closest('.fp-bar')) {
      state.fpSelectedCab = fpCab.dataset.fpCab!;
      renderFurnacePlan();
      return;
    }
    const fpBar = t.closest('[data-fp-load]') as HTMLElement | null;
    if (fpBar) {
      state.fpSelectedCab = fpBar.dataset.fpCab!;
      renderFurnacePlan();
    }
  });

  let tipEl: HTMLElement | null = null;
  document.addEventListener('mousemove', (e) => {
    const bar = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
    if (!bar || state.page !== 'furnace-plan') {
      if (tipEl) {
        tipEl.remove();
        tipEl = null;
      }
      return;
    }
    let data: Record<string, string>;
    try {
      data = JSON.parse(bar.getAttribute('data-tip') || '{}') as Record<string, string>;
    } catch {
      return;
    }
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'fp-tooltip';
      document.body.appendChild(tipEl);
    }
    tipEl.innerHTML = `
        <div class="tt-title">炉次 ${escapeHtml(String(data.furnaceId))} · 进炉顺序 #${escapeHtml(String(data.seq))}</div>
        <div class="tt-row">物料/客户：${escapeHtml(String(data.lines))} · ${escapeHtml(String(data.customer))}</div>
        <div class="tt-row">工艺 ${escapeHtml(String(data.process))} · 班次 ${escapeHtml(String(data.shift))}</div>
        <div class="tt-row">体积 ${escapeHtml(String(data.vol))} m³ · 箱数 ${escapeHtml(String(data.boxes))}</div>
        <div class="tt-row">预热：${escapeHtml(String(data.preheat))}</div>
        <div class="tt-row">进炉/灭菌：${escapeHtml(String(data.sterilize))}</div>
        <div class="tt-row">解析：${escapeHtml(String(data.aerate))}</div>
        <div class="tt-row">BI：${escapeHtml(String(data.bi))}</div>
        ${data.notes ? `<div class="tt-pending">⚠ ${escapeHtml(String(data.notes))}</div>` : ''}
      `;
    const x = Math.min(e.clientX + 14, window.innerWidth - 340);
    const y = Math.min(e.clientY + 14, window.innerHeight - 200);
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  });
}

export function bootApp(): void {
  const loaded = loadPlan();
  const pool = mergeVirtualLinesIntoPool(createSeedPool(), loaded.virtualLines);
  state = {
    page: 'workbench',
    date: loaded.date,
    shift: loaded.shift,
    selectedPool: new Set(),
    selectedFurnaceId: null,
    furnaces: loaded.furnaces,
    filters: { q: '', customer: '', process: '', urgentOnly: false },
    config: loaded.config,
    nextFurnaceSeq: loaded.nextFurnaceSeq,
    fpStartDate: loaded.date || DEFAULT_DATE,
    fpHorizon: loaded.config.fp.defaultHorizon,
    fpShiftFilter: '',
    fpSelectedCab: null,
    fpLoads: [],
    fpConflicts: [],
    virtualLines: loaded.virtualLines,
    planSeedVersion: loaded.planSeedVersion,
    pool,
  };
  bind();
  navigate('workbench');
}
