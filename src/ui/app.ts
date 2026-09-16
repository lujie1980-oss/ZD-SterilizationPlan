import {
  DEFAULT_DATE,
  DEMO_MIN_CABINETS,
  DEMO_MIN_LOADS,
  PLAN_SEED_VERSION,
  isDemoSeedEnabled,
} from '../data/config-defaults';
import { BOX_SPEC_CONCEPT_COUNT, BOX_SPECS } from '../data/seed-boxspecs';
import { CABINETS, TRAYS, cabinetById, traysForCabinet, usableCabinets } from '../data/seed-cabinets';
import { getDemoFurnaceSeed } from '../data/seed-demo-plan';
import { createSeedPool } from '../data/seed-pool';
import { PROCESSES } from '../data/seed-processes';
import { normalizeCabinetContent, trayCapacityM3 } from '../domain/cabinet-content';
import { demoRuntimeOverrides, deriveAllRuntimes } from '../domain/cabinet-runtime';
import { applyGanttSchedule } from '../domain/cabinet-task';
import { addDays, dayOffset, fmtDate, fmtDateTime } from '../domain/dates';
import type {
  AppConfig,
  CabinetTask,
  EntryLoad,
  FurnaceRun,
  FurnaceSchedule,
  GroupingEntry,
  Shift,
  StockLine,
  ValidationIssue,
} from '../domain/entities';
import { buildEntryLoads } from '../domain/entry-scheduler';
import { buildDayPlanCsv } from '../domain/export-csv';
import { deriveFacts } from '../domain/facts';
import {
  autoPackCabinet,
  focusDemand,
  listCandidateCabinets,
  listEligibleForCabinet,
  markLoadComplete,
  manualPackCabinet,
  replaceCabinetActive,
  toggleDemandCheck,
} from '../domain/grouping';
import {
  applyAssign,
  applyChangeCabinet,
  cloneFurnaces,
  collectFurnaceIssues,
  commitSuggestCombine,
  decideCommit,
  extendPoolById,
  filterAndSortIssues,
  type IssueFilter,
} from '../domain/commit-gate';
import { effectiveMinLoadM3, setProcessMinLoad } from '../domain/min-load';
import {
  assignedIds,
  currentFurnaces,
  furnaceBoxes,
  furnaceVol,
  isPlanSparse,
  mergeVirtualLinesIntoPool,
  needsSplit,
  unscheduledContents,
  upsertVirtualLine,
  visibleUnassignedPool,
} from '../domain/pool';
import { canAddFurnace, validateAll, validateFurnace } from '../domain/rule-engine';
import { applySplit, findSplitTarget } from '../domain/split-wizard';
import { loadPlan, savePlan, type LoadedPlan } from '../persistence/plan-store-v2';
import { $, $$, $opt, escapeHtml, toast } from './dom';
import {
  groupingLoadCompleteBannerHtml,
  groupingRuntimeTagsHtml,
  groupingToolbarContractHtml,
  placementChip,
  trayOverChip,
} from './grouping-view';

type Page = 'grouping' | 'workbench' | 'furnace-plan' | 'pool' | 'cabinets' | 'processes' | 'boxspecs' | 'validation';

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
  valFilter: IssueFilter;
  grpEntry: GroupingEntry;
  grpSelectedCabinetId: string | null;
  grpFocusedDemandId: string | null;
  grpCheckedDemandIds: Set<string>;
  grpLayerHint: boolean;
  tasks: CabinetTask[];
  schedules: FurnaceSchedule[];
  nextTaskSeq: number;
}

const PAGE_TITLES: Record<Page, string> = {
  grouping: '组柜 · 选柜 / 选需求',
  workbench: '已排期浏览（过渡）',
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
    contents: state.furnaces,
    tasks: state.tasks,
    schedules: state.schedules,
    nextFurnaceSeq: state.nextFurnaceSeq,
    nextTaskSeq: state.nextTaskSeq,
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

function ruleCtx(sameShift = currentFurnaces(state.furnaces, state.date, state.shift), lookup = poolById) {
  return {
    cabinets: CABINETS,
    processes: PROCESSES,
    poolById: lookup,
    config: state.config,
    sameShiftFurnaces: sameShift,
    trayMaster: TRAYS,
    allContents: sameShift,
    runtimes: deriveAllRuntimes(CABINETS, sameShift, demoRuntimeOverrides()),
  };
}

function ruleCtxFor(furnaces: FurnaceRun[], lookup = poolById) {
  return ruleCtx(currentFurnaces(furnaces, state.date, state.shift), lookup);
}

function scheduleMode(): 'auto' | 'manual' {
  return state.config.scheduleMode === 'manual' ? 'manual' : 'auto';
}

function applyDecision(
  decision: ReturnType<typeof decideCommit>,
  successToast: string,
): boolean {
  if (decision.aborted) {
    toast(decision.message, 'error');
    return false;
  }
  state.furnaces = decision.persisted;
  persist();
  render();
  if (decision.needsOverridePrompt) {
    toast(decision.message, 'warn');
    const viol = decision.persisted.find((f) => f.manualViolation);
    if (viol) showOverridePrompt(viol.id, decision.issues);
  } else {
    toast(successToast);
  }
  return true;
}

function minTarget(process: string): number {
  return effectiveMinLoadM3(process, state.config, PROCESSES);
}

function pendingTag(text?: string): string {
  if (!state.config.showPendingTags) return '';
  return `<span class="tag tag-pending">${escapeHtml(text || '待确认')}</span>`;
}

function seedDemoFurnaceLoadsIfEmpty(): boolean {
  if (!isDemoSeedEnabled(state.config)) return false;
  if (!isPlanSparse(state.furnaces, DEMO_MIN_LOADS, DEMO_MIN_CABINETS, state.virtualLines)) {
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
    const raw: FurnaceRun = {
      id: `F${state.nextFurnaceSeq++}`,
      cabinetId: d.cabinetId,
      shift: null,
      date: null,
      lines: free,
      demoSeed: true,
      scheduleStatus: 'unscheduled',
      status: 'active',
      loadComplete: false,
      taskId: null,
      seq: null,
    };
    state.furnaces.push(
      normalizeCabinetContent(raw, {
        trayMaster: TRAYS,
        poolById,
        largeBoxVol: state.config.box.largeBoxVol,
        cabinet: cabinetById(d.cabinetId),
      }),
    );
  });
  state.planSeedVersion = PLAN_SEED_VERSION;
  persist();
  return true;
}

function syncFurnacePlan(opts?: { silent?: boolean }): void {
  if (!state.fpStartDate) state.fpStartDate = state.date || DEFAULT_DATE;
  const seeded = seedDemoFurnaceLoadsIfEmpty();
  const scheduled = applyGanttSchedule({
    contents: state.furnaces,
    cabinets: CABINETS,
    processes: PROCESSES,
    config: state.config,
    poolById,
    trayMaster: TRAYS,
    startDate: state.fpStartDate,
    scheduleMode: scheduleMode(),
    epoch: DEFAULT_DATE,
    nextTaskSeq: state.nextTaskSeq,
  });
  if (scheduled.aborted) {
    if (!opts?.silent) toast(scheduled.message, 'error');
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
    return;
  }
  state.furnaces = scheduled.contents;
  state.tasks = scheduled.tasks;
  state.schedules = scheduled.schedules;
  persist();
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
        ? `已同步装炉结果（演示组柜 ${state.furnaces.filter((f) => !f.hidden).length} 柜）并写回上线日期`
        : scheduled.message,
      scheduled.issues.length ? 'warn' : 'success',
    );
  }
}

const GROUPING_ISSUE_CODES = new Set(['LOAD_COMPLETE_BLOCK', 'QTY_EXCEEDED', 'TRAY_OVER']);

function collectIssues(): ValidationIssue[] {
  const scheduled = currentFurnaces(state.furnaces, state.date, state.shift);
  const unsched = unscheduledContents(state.furnaces);
  const scheduledIssues = collectFurnaceIssues(scheduled, ruleCtx(scheduled), scheduleMode());
  const groupingIssues = collectFurnaceIssues(unsched, ruleCtx(unsched), scheduleMode()).filter((i) =>
    GROUPING_ISSUE_CODES.has(i.code),
  );
  return [...scheduledIssues, ...groupingIssues, ...state.fpConflicts];
}

function factStripHtml(line: StockLine): string {
  const facts = deriveFacts(line, PROCESSES, state.config, state.date);
  const dueCls = facts.dueTone === 'overdue' ? 'due-overdue' : facts.dueTone === 'soon' ? 'due-soon' : 'due-ok';
  const chips = facts.facts
    .map(
      (f) =>
        `<button type="button" class="fact-chip fact-${f.tone}" data-fact-open="${escapeHtml(line.id)}" data-fact-code="${escapeHtml(f.code)}">${escapeHtml(f.label)}</button>`,
    )
    .join('');
  return `<div class="fact-strip" data-fact-open="${escapeHtml(line.id)}" title="点击查看规则说明（只读事实，不代替校验中心）">
    <span class="fact-due ${dueCls}">${escapeHtml(facts.dueLabel)}</span>
    ${chips}
  </div>`;
}

function openFactDrawer(lineId: string): void {
  const line = poolById(lineId);
  if (!line) return;
  const facts = deriveFacts(line, PROCESSES, state.config, state.date);
  const proc = PROCESSES.find((p) => p.code === line.process);
  $('#factDrawerTitle').textContent = `规则事实 · ${line.id}`;
  $('#factDrawerBody').innerHTML = `
    <p>以下为待排行只读事实，<strong>不代替校验中心</strong>。点击芯片仅打开说明。</p>
    <h4>交期</h4>
    <p>${escapeHtml(facts.dueLabel)}（相对工作台日期 ${escapeHtml(state.date)}）</p>
    <h4>指定柜</h4>
    <p>${facts.hasDesignatedCabinet ? `是 · ${facts.allowedCabinets.map(escapeHtml).join('、')}` : '否 · 未指定柜'}</p>
    ${proc ? `<p class="hint">工艺 ${escapeHtml(proc.code)} ${escapeHtml(proc.name)} 主数据允许柜：${proc.cabinets.map(escapeHtml).join('、')}</p>` : ''}
    <h4>适用规则芯片</h4>
    ${facts.facts
      .map(
        (f) => `<div class="fact-detail-row">
        <span class="fact-chip fact-${f.tone}">${escapeHtml(f.label)}</span>
        <p>${escapeHtml(f.detail || f.code)}</p>
      </div>`,
      )
      .join('')}
    <p class="hint">硬约束以校验中心 / 提交闸门为准。自动排产拒绝 error 落盘；手工调整可保存并标「手工违例」。</p>
  `;
  $('#factDrawerMask').style.display = 'flex';
}

function closeFactDrawer(): void {
  const mask = $opt('#factDrawerMask');
  if (mask) mask.style.display = 'none';
}

function showOverridePrompt(furnaceId: string, issues: ValidationIssue[]): void {
  const existing = state.config.overrideNotes?.[furnaceId] || '';
  const errMsgs = issues
    .filter((i) => i.sev === 'error')
    .map((i) => escapeHtml(i.msg))
    .join('<br>');
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <div class="modal-hd">
        <span>手工违例 · ${escapeHtml(furnaceId)}</span>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-bd">
        <div class="strong-banner danger" style="margin-bottom:12px">已按手工调整保存。建议填写违例原因（可不填，不阻断）。</div>
        <p style="margin-bottom:8px">${errMsgs || '存在硬错误'}</p>
        <label class="label">违例原因（建议填写）</label>
        <textarea class="input" id="overrideNoteInput" style="width:100%;height:80px;margin-top:6px">${escapeHtml(existing)}</textarea>
      </div>
      <div class="modal-ft">
        <button class="btn" type="button" data-act="skip">跳过</button>
        <button class="btn btn-primary" type="button" data-act="save">保存原因</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  (mask.querySelector('.modal-close') as HTMLElement).onclick = close;
  (mask.querySelector('[data-act=skip]') as HTMLElement).onclick = close;
  (mask.querySelector('[data-act=save]') as HTMLElement).onclick = () => {
    const note = ((mask.querySelector('#overrideNoteInput') as HTMLTextAreaElement).value || '').trim();
    saveOverrideNote(furnaceId, note);
    close();
    toast(note ? '已保存违例原因' : '未填写原因，已保持保存结果', 'info');
  };
}

function saveOverrideNote(furnaceId: string, note: string): void {
  const notes = { ...(state.config.overrideNotes ?? {}) };
  if (note) notes[furnaceId] = note;
  else delete notes[furnaceId];
  state.config = { ...state.config, overrideNotes: notes };
  persist();
  render();
}

function setScheduleMode(mode: 'auto' | 'manual'): void {
  if (scheduleMode() === mode) return;
  state.config = { ...state.config, scheduleMode: mode };
  persist();
  render();
  if (mode === 'auto') {
    const furns = currentFurnaces(state.furnaces, state.date, state.shift);
    const hasErr = furns.some((f) => validateFurnace(f, ruleCtx(furns)).some((i) => i.sev === 'error'));
    if (hasErr) toast('已切回自动排产：存在违例炉次需手工处理或改回合法。新的自动写入若含 error 将被拒绝。', 'warn');
  } else {
    toast('已切换为手工调整：error 可落盘，炉次将标「手工违例」，建议填写原因。', 'info');
  }
}

function renderModeBanner(): void {
  const el = $opt('#wbModeBanner');
  if (!el) return;
  const furns = currentFurnaces(state.furnaces, state.date, state.shift);
  const ctx = ruleCtx(furns);
  const errFurnaces = furns.filter((f) => validateFurnace(f, ctx).some((i) => i.sev === 'error'));
  if (!errFurnaces.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  if (scheduleMode() === 'manual') {
    el.className = 'strong-banner danger';
    el.innerHTML =
      '手工违例：当前班次存在硬错误，已允许保存。建议填写违例原因。请到校验中心查看（可筛「仅手工违例」）。';
  } else {
    el.className = 'strong-banner warn';
    el.innerHTML =
      '需手工处理或改回合法：自动排产模式下这些炉次含硬错误，新的自动写入（含建议拼炉）若仍有 error 将被拒绝。';
  }
  el.style.display = '';
}

function navigate(page: Page): void {
  state.page = page;
  if (page === 'grouping') {
    seedDemoFurnaceLoadsIfEmpty();
  }
  if (page === 'furnace-plan') {
    if (!state.fpStartDate) state.fpStartDate = state.date || DEFAULT_DATE;
    syncFurnacePlan({ silent: true });
  }
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  const exp = $opt('#btnExport');
  if (exp) exp.style.display = page === 'furnace-plan' || page === 'grouping' ? 'none' : '';
  const topDate = $opt('#topResultDate');
  const topHint = $opt('#topDateHint');
  if (topDate) {
    (topDate as HTMLInputElement).disabled = page === 'grouping';
    topDate.style.display = page === 'grouping' ? 'none' : '';
  }
  if (topHint) topHint.style.display = page === 'grouping' ? 'none' : '';
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
  const next = applyAssign(state.furnaces, f.id, toAdd);
  const decision = decideCommit({
    previous: state.furnaces,
    next,
    config: state.config,
    ctx: ruleCtxFor(next),
    editSource: 'manual',
  });
  if (!decision.aborted) state.selectedPool.clear();
  applyDecision(decision, `已分配 ${toAdd.length} 行至 ${f.cabinetId}（${f.id}）`);
}

function changeFurnaceCabinet(furnaceId: string, cabinetId: string): void {
  const f = state.furnaces.find((x) => x.id === furnaceId);
  if (!f || f.cabinetId === cabinetId) return;
  const next = applyChangeCabinet(state.furnaces, furnaceId, cabinetId);
  const decision = decideCommit({
    previous: state.furnaces,
    next,
    config: state.config,
    ctx: ruleCtxFor(next),
    editSource: 'manual',
  });
  applyDecision(decision, `已将 ${furnaceId} 改至 ${cabinetId}`);
}

function removeFromFurnace(furnaceId: string, lineId: string): void {
  const next = cloneFurnaces(state.furnaces);
  const f = next.find((x) => x.id === furnaceId);
  if (!f) return;
  f.lines = f.lines.filter((id) => id !== lineId);
  const decision = decideCommit({
    previous: state.furnaces,
    next,
    config: state.config,
    ctx: ruleCtxFor(next),
    editSource: 'manual',
  });
  if (decision.aborted) {
    toast(decision.message, 'error');
    return;
  }
  state.furnaces = decision.persisted;
  persist();
  render();
}

function deleteFurnace(furnaceId: string): void {
  state.furnaces = state.furnaces.filter((f) => f.id !== furnaceId);
  if (state.selectedFurnaceId === furnaceId) state.selectedFurnaceId = null;
  if (state.config.overrideNotes?.[furnaceId]) {
    const notes = { ...state.config.overrideNotes };
    delete notes[furnaceId];
    state.config = { ...state.config, overrideNotes: notes };
  }
  persist();
  render();
  toast('已删除炉次');
}

function suggestCombine(): void {
  const assigned = assignedIds(state.furnaces);
  const result = commitSuggestCombine({
    pool: state.pool,
    furnaces: state.furnaces,
    assigned,
    date: state.date,
    shift: state.shift,
    nextSeq: state.nextFurnaceSeq,
    minLoad: effectiveMinLoadM3('D002', state.config, PROCESSES),
    poolById,
    config: state.config,
    cabinets: CABINETS,
    processes: PROCESSES,
  });
  if (!result.ok && !result.aborted) {
    toast(result.message, 'info');
    return;
  }
  if (result.aborted) {
    toast(result.message, 'error');
    return;
  }
  state.furnaces = result.persisted;
  state.nextFurnaceSeq = result.nextSeq;
  if (result.selectedFurnaceId) state.selectedFurnaceId = result.selectedFurnaceId;
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
          ${line.boxVol >= state.config.box.largeBoxVol ? ` · <span class="tag tag-pending">大箱（单箱≥${state.config.box.largeBoxVol}）合计 ≤${state.config.box.maxBoxesWhenLarge}箱/炉</span>` : ''}
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
    const extras = [applied.rowA, applied.rowB];
    const nextFurnaces = [...cloneFurnaces(state.furnaces), ...applied.furnaces];
    const lookup = extendPoolById(poolById, extras);
    const decision = decideCommit({
      previous: state.furnaces,
      next: nextFurnaces,
      config: state.config,
      ctx: ruleCtxFor(nextFurnaces, lookup),
      editSource: 'manual',
    });
    if (decision.aborted) {
      toast(decision.message, 'error');
      return;
    }
    const upA = upsertVirtualLine(state.virtualLines, state.pool, applied.rowA);
    const upB = upsertVirtualLine(upA.virtualLines, upA.pool, applied.rowB);
    state.virtualLines = upB.virtualLines;
    state.pool = upB.pool;
    state.selectedPool.delete(line.id);
    state.furnaces = decision.persisted;
    state.nextFurnaceSeq = applied.nextSeq;
    state.selectedFurnaceId = applied.furnaces[0]!.id;
    persist();
    close();
    render();
    if (decision.needsOverridePrompt) {
      toast(decision.message, 'warn');
      const viol = decision.persisted.find((x) => x.manualViolation);
      if (viol) showOverridePrompt(viol.id, decision.issues);
    } else {
      toast(`已拆为两炉：${applied.rowA.id}（${applied.rowA.boxes}箱）/ ${applied.rowB.id}（${applied.rowB.boxes}箱）→ ${cab}`);
    }
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

function currentRuntimes() {
  return deriveAllRuntimes(CABINETS, state.furnaces, demoRuntimeOverrides());
}

function eligiblePool(): StockLine[] {
  return state.pool.filter((p) => !p.splitOf);
}

function renderLayerStack(cabinetId: string | null): string {
  if (!cabinetId) {
    return `<div class="empty"><div class="hint">请选择灭菌柜或需求以查看分层 → 装柜</div></div>`;
  }
  const content = state.furnaces.find((f) => f.cabinetId === cabinetId && !f.hidden);
  const cab = cabinetById(cabinetId);
  const trays = traysForCabinet(cabinetId);
  const fill = content?.fillRate ?? 0;
  const unscheduled = !content?.date;
  const steps = state.grpLayerHint
    ? `<div class="grp-steps"><span class="tag tag-blue">① 分层</span> → <span class="tag tag-green">② 装柜</span></div>`
    : `<div class="hint">组柜过程：先分层（托盘主数据）再装柜</div>`;
  const layers = (content?.trays?.length ? content.trays : trays.map((t) => ({ trayId: t.id, level: t.level, vol: 0, boxes: 0, largeBoxes: 0, onTray: [] as never[], id: t.id, contentId: '' })))
    .slice()
    .sort((a, b) => b.level - a.level);
  const cards = layers
    .map((t) => {
      const md = trays.find((x) => x.id === t.trayId);
      const names = (t.onTray || []).map((o) => o.stockLineId).join('、') || '空层';
      const cap = trayCapacityM3(md);
      const overChip = trayOverChip(t.vol, cap);
      const overCls = overChip ? ' tray-over' : '';
      return `<div class="grp-layer${overCls}"${overChip ? ' data-tray-over="layer"' : ''}>
        <div class="grp-layer-hd">${escapeHtml(md?.displayName || `第${t.level}层`)} · <span class="mono">${escapeHtml(t.trayId)}</span> ${overChip}</div>
        <div class="grp-layer-bd">${escapeHtml(names)} · ${t.vol.toFixed(1)} m³ / 容积 ${cap || '—'} m³ · ${t.boxes}箱</div>
      </div>`;
    })
    .join('');
  return `${steps}
    <div class="grp-cab-summary">
      <strong>${escapeHtml(cab?.displayCode || cabinetId)}</strong>
      ${unscheduled ? '<span class="tag tag-default">未排</span>' : `<span class="tag tag-blue">${escapeHtml(content?.date || '')} ${escapeHtml(content?.shift || '')}</span>`}
      <div class="hint">装柜率 ${(fill * 100).toFixed(0)}% ＝ 已装体积 / 额定 ${cab?.ratedLoadM3 ?? '—'} m³</div>
      <div class="progress-bar"><div class="fill ${fill >= 0.56 ? 'ok' : 'low'}" style="width:${Math.min(100, fill * 100)}%"></div></div>
    </div>
    <div class="grp-layers">${cards || '<div class="hint">尚无托盘装载</div>'}</div>`;
}

function runAutoPack(): void {
  const runtimes = currentRuntimes();
  if (state.grpEntry === 'cabinet') {
    if (!state.grpSelectedCabinetId) {
      toast('请先选择灭菌柜', 'warn');
      return;
    }
    const packed = autoPackCabinet({
      cabinetId: state.grpSelectedCabinetId,
      pool: eligiblePool(),
      contents: state.furnaces,
      cabinets: CABINETS,
      processes: PROCESSES,
      trayMaster: TRAYS,
      runtimes,
      config: state.config,
      nextId: `CC${state.nextFurnaceSeq++}`,
      poolById,
    });
    if (!packed.ok || !packed.content) {
      toast(packed.message, 'error');
      return;
    }
    const replaced = replaceCabinetActive(state.furnaces, packed.content);
    if (!replaced.ok) {
      toast(replaced.issue?.msg || '无法写入', 'error');
      return;
    }
    const decision = decideCommit({
      previous: state.furnaces,
      next: replaced.contents,
      config: state.config,
      ctx: ruleCtx(replaced.contents),
      editSource: 'auto',
    });
    if (decision.aborted) {
      toast(decision.message, 'error');
      return;
    }
    state.furnaces = decision.persisted;
    state.grpLayerHint = true;
    persist();
    render();
    toast(packed.message);
    return;
  }
  const ids = state.grpCheckedDemandIds.size ? [...state.grpCheckedDemandIds] : state.grpFocusedDemandId ? [state.grpFocusedDemandId] : [];
  if (!ids.length) {
    toast('请勾选需求后再自动组柜（单击行仅查看）', 'warn');
    return;
  }
  const cabs = listCandidateCabinets({ lineIds: ids, poolById, cabinets: CABINETS, runtimes }).filter((r) => !r.autoPackBlocked);
  const target = cabs[0];
  if (!target) {
    toast('没有可自动组入的柜（灭菌中/装填完毕已排除）', 'warn');
    return;
  }
  const packed = autoPackCabinet({
    cabinetId: target.cabinetId,
    pool: eligiblePool(),
    contents: state.furnaces,
    cabinets: CABINETS,
    processes: PROCESSES,
    trayMaster: TRAYS,
    runtimes,
    config: state.config,
    nextId: `CC${state.nextFurnaceSeq++}`,
    poolById,
    selectedLineIds: ids,
  });
  if (!packed.ok || !packed.content) {
    toast(packed.message, 'error');
    return;
  }
  const replaced = replaceCabinetActive(state.furnaces, packed.content);
  if (!replaced.ok) {
    toast(replaced.issue?.msg || '无法写入', 'error');
    return;
  }
  const decision = decideCommit({
    previous: state.furnaces,
    next: replaced.contents,
    config: state.config,
    ctx: ruleCtx(replaced.contents),
    editSource: 'auto',
  });
  if (decision.aborted) {
    toast(decision.message, 'error');
    return;
  }
  state.furnaces = decision.persisted;
  state.grpSelectedCabinetId = target.cabinetId;
  state.grpLayerHint = true;
  persist();
  render();
  toast(packed.message);
}

function runManualPack(): void {
  const runtimes = currentRuntimes();
  let cabinetId = state.grpSelectedCabinetId;
  const ids =
    state.grpEntry === 'demand'
      ? state.grpCheckedDemandIds.size
        ? [...state.grpCheckedDemandIds]
        : []
      : [...state.grpCheckedDemandIds];
  if (state.grpEntry === 'demand' && !cabinetId) {
    toast('请先点选目标灭菌柜（查看行不会勾选需求）', 'warn');
    return;
  }
  if (state.grpEntry === 'cabinet' && !cabinetId) {
    toast('请先选择灭菌柜', 'warn');
    return;
  }
  if (!ids.length) {
    toast('请勾选要组入的需求（单击行仅查看）', 'warn');
    return;
  }
  const packed = manualPackCabinet({
    cabinetId: cabinetId!,
    lineIds: ids,
    contents: state.furnaces,
    cabinets: CABINETS,
    trayMaster: TRAYS,
    runtimes,
    config: state.config,
    nextId: `CC${state.nextFurnaceSeq++}`,
    poolById,
    allowInOther: false,
  });
  if (!packed.ok || !packed.content) {
    toast(packed.message, 'error');
    return;
  }
  const replaced = replaceCabinetActive(state.furnaces, packed.content);
  const next = replaced.ok ? replaced.contents : state.furnaces;
  const decision = decideCommit({
    previous: state.furnaces,
    next,
    config: state.config,
    ctx: ruleCtx(next),
    editSource: 'manual',
  });
  if (decision.aborted) {
    toast(decision.message, 'error');
    return;
  }
  state.furnaces = decision.persisted;
  state.grpLayerHint = true;
  persist();
  render();
  toast(packed.message, decision.needsOverridePrompt ? 'warn' : 'success');
  if (decision.needsOverridePrompt) {
    const viol = decision.persisted.find((x) => x.manualViolation);
    if (viol) showOverridePrompt(viol.id, decision.issues);
  }
}

function runMarkLoadComplete(): void {
  const cabinetId = state.grpSelectedCabinetId;
  if (!cabinetId) {
    toast('请先选择灭菌柜', 'warn');
    return;
  }
  const content = state.furnaces.find((f) => f.cabinetId === cabinetId && !f.hidden);
  if (!content) {
    toast('该柜尚无组柜载荷', 'warn');
    return;
  }
  const issues = validateFurnace(content, ruleCtx(state.furnaces));
  const marked = markLoadComplete({ content, issues, scheduleMode: scheduleMode() });
  if (!marked.ok) {
    toast(marked.message, 'error');
    return;
  }
  state.furnaces = state.furnaces.map((f) => (f.id === content.id ? marked.content : f));
  persist();
  render();
  toast(marked.message, marked.content.manualViolation ? 'warn' : 'success');
}

function renderGroupingModeBanner(): void {
  const el = $opt('#grpModeBanner');
  if (!el) return;
  const cabId = state.grpSelectedCabinetId;
  const rt = cabId ? currentRuntimes().find((r) => r.cabinetId === cabId) : undefined;
  if (rt?.status === 'loadComplete') {
    el.className = scheduleMode() === 'manual' ? 'strong-banner danger' : 'strong-banner warn';
    el.innerHTML = groupingLoadCompleteBannerHtml(scheduleMode());
    el.style.display = '';
    return;
  }
  const content = cabId ? state.furnaces.find((f) => f.cabinetId === cabId && !f.hidden) : undefined;
  const qty = content
    ? validateFurnace(content, ruleCtx(state.furnaces)).find((i) => i.code === 'QTY_EXCEEDED')
    : undefined;
  if (qty) {
    el.className = 'strong-banner danger';
    el.innerHTML = escapeHtml(qty.msg);
    el.style.display = '';
    return;
  }
  el.style.display = 'none';
  el.innerHTML = '';
}

function renderGrouping(): void {
  const toolbar = $opt('#grpToolbar');
  if (!toolbar) return;
  toolbar.innerHTML = groupingToolbarContractHtml();
  $$('#grpEntryTabs .shift-tab').forEach((t) => t.classList.toggle('active', t.dataset.grpEntry === state.grpEntry));
  $$('#grpScheduleModeTabs .shift-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === scheduleMode()));
  renderGroupingModeBanner();

  const runtimes = currentRuntimes();
  const body = $('#grpBody');
  if (state.grpEntry === 'cabinet') {
    const cabId = state.grpSelectedCabinetId;
    const rows = cabId
      ? listEligibleForCabinet({
          cabinetId: cabId,
          pool: eligiblePool(),
          contents: state.furnaces,
          cabinets: CABINETS,
          config: state.config,
        })
      : [];
    const groups = {
      inThisCabinet: rows.filter((r) => r.placement === 'inThisCabinet'),
      unassigned: rows.filter((r) => r.placement === 'unassigned'),
      inOtherCabinet: rows.filter((r) => r.placement === 'inOtherCabinet'),
    };
    const cabCards = usableCabinets()
      .map((c) => {
        const rt = runtimes.find((r) => r.cabinetId === c.id);
        const status = rt?.status || 'idle';
        const disabled = status === 'sterilizing' || status === 'outOfService';
        const sel = cabId === c.id ? 'selected' : '';
        const load = state.furnaces.find((f) => f.cabinetId === c.id && !f.hidden);
        return `<div class="grp-cab ${sel} ${disabled ? 'disabled' : ''}" data-grp-cab="${escapeHtml(c.id)}">
          <div class="fname">${escapeHtml(c.displayCode)} <span class="hint">${escapeHtml(c.canonicalId)}</span></div>
          <div class="sub">${c.base}基地 · 额定 ${c.ratedLoadM3} m³</div>
          <div>${groupingRuntimeTagsHtml(status)}
            ${load ? `<span class="tag tag-green">${(load.fillRate || 0) * 100 | 0}%</span>` : ''}
            ${load && !load.date ? '<span class="tag tag-default">未排</span>' : ''}
          </div>
        </div>`;
      })
      .join('');
    const demandBlock = (title: string, list: typeof rows, emptyHint: string) => `
      <div class="grp-part">
        <div class="grp-part-hd">${escapeHtml(title)} · ${list.length}</div>
        ${
          list.length
            ? list
                .map((r) => {
                  const checked = state.grpCheckedDemandIds.has(r.lineId) ? 'checked' : '';
                  const facts = factStripHtml(r.line);
                  return `<div class="grp-demand ${checked ? 'selected' : ''}" data-grp-demand-view="${escapeHtml(r.lineId)}">
                    <input type="checkbox" data-grp-check="${escapeHtml(r.lineId)}" ${checked} ${r.placement === 'inOtherCabinet' ? 'disabled' : ''} />
                    <div>
                      <div><strong class="mono">${escapeHtml(r.lineId)}</strong> ${placementChip(r.placement, r.otherCabinetId)} ${escapeHtml(r.line.name)}</div>
                      <div class="sub">${r.line.vol} m³ · SO ${escapeHtml(r.line.salesOrderNo || r.line.wo)} · ${r.line.dimL || '—'}×${r.line.dimW || '—'}×${r.line.dimH || '—'} · 交期 ${escapeHtml(r.line.due)}</div>
                      ${facts}
                    </div>
                  </div>`;
                })
                .join('')
            : `<div class="hint">${escapeHtml(emptyHint)}</div>`
        }
      </div>`;
    const emptyUnassignedHint =
      groups.inThisCabinet.length && !groups.unassigned.length ? '还可排入为空，柜并非空闲（见已进本柜）' : '暂无未排可进需求';
    body.innerHTML = `<div class="grp-cols">
      <div class="grp-col"><div class="grp-col-hd">选柜</div><div class="grp-scroll">${cabCards}</div></div>
      <div class="grp-col"><div class="grp-col-hd">完整可进需求</div><div class="grp-scroll">
        ${cabId ? demandBlock('已进本柜', groups.inThisCabinet, '本柜尚无载荷') + demandBlock('还可排入', groups.unassigned, emptyUnassignedHint) + demandBlock('已进其他柜', groups.inOtherCabinet, '无') : '<div class="empty"><div class="hint">请选择左侧灭菌柜</div></div>'}
      </div></div>
      <div class="grp-col"><div class="grp-col-hd">分层 → 装柜</div><div class="grp-scroll">${renderLayerStack(cabId)}</div></div>
    </div>`;
    return;
  }

  const demands = eligiblePool().filter((p) => p.stockStatus !== '限制');
  const demandRows = demands
    .map((p) => {
      const checked = state.grpCheckedDemandIds.has(p.id) ? 'checked' : '';
      const focused = state.grpFocusedDemandId === p.id ? 'focused' : '';
      return `<div class="grp-demand ${focused} ${checked ? 'selected' : ''}" data-grp-demand-view="${escapeHtml(p.id)}">
        <input type="checkbox" data-grp-check="${escapeHtml(p.id)}" ${checked} />
        <div>
          <div><strong class="mono">${escapeHtml(p.id)}</strong> ${escapeHtml(p.name)} ${p.urgent ? '<span class="tag tag-urgent">加急</span>' : ''}</div>
          <div class="sub">${p.vol} m³ · SO ${escapeHtml(p.salesOrderNo || p.wo)} · ${p.dimL || '—'}×${p.dimW || '—'}×${p.dimH || '—'} · 允许 ${escapeHtml(p.allowed.join(','))}</div>
          ${factStripHtml(p)}
        </div>
      </div>`;
    })
    .join('');
  const viewIds = state.grpFocusedDemandId ? [state.grpFocusedDemandId] : [];
  const cabRows = viewIds.length
    ? listCandidateCabinets({ lineIds: viewIds, poolById, cabinets: CABINETS, runtimes })
    : [];
  const cabList = cabRows
    .map((r) => {
      const sel = state.grpSelectedCabinetId === r.cabinetId ? 'selected' : '';
      return `<div class="grp-cab ${sel} ${r.selectable ? '' : 'disabled'}" data-grp-cab="${escapeHtml(r.cabinetId)}">
        <div class="fname">${escapeHtml(r.cabinet.displayCode)}</div>
        <div>${groupingRuntimeTagsHtml(r.runtime)}</div>
        ${r.disabledReason ? `<div class="hint">${escapeHtml(r.disabledReason)}</div>` : ''}
      </div>`;
    })
    .join('');
  body.innerHTML = `<div class="grp-cols">
    <div class="grp-col"><div class="grp-col-hd">选需求 · 单击查看 / 勾选批量</div><div class="grp-scroll">${demandRows}</div></div>
    <div class="grp-col"><div class="grp-col-hd">可组柜（允许设备 ∩ 运行态）</div><div class="grp-scroll">${cabRows.length ? cabList : '<div class="empty"><div class="hint">单击左侧需求行查看可组柜（不会勾选）</div></div>'}</div></div>
    <div class="grp-col"><div class="grp-col-hd">分层 → 装柜</div><div class="grp-scroll">${renderLayerStack(state.grpSelectedCabinetId)}</div></div>
  </div>`;
}

function render(): void {
  if (state.page === 'grouping') renderGrouping();
  else if (state.page === 'workbench') renderWorkbench();
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
  $$('#scheduleModeTabs .shift-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === scheduleMode()));
  renderModeBanner();
  $('#chipVol').textContent = `${totalVol.toFixed(1)} m³`;
  $('#chipTarget').textContent = furns.length ? `${furns.length} 炉` : '—';
  $('#chipIssues').textContent = String(errCount + warnCount);
  $('#chipIssuesWrap').className = `chip ${errCount ? 'err' : warnCount ? 'warn' : 'ok'}`;
  $('#cfgFiller').classList.toggle('on', state.config.allowFiller);
  $('#cfgMix').classList.toggle('on', state.config.mixCustomerWarn);
  ($('#cfgPreheat') as HTMLInputElement).value = String(state.config.cycle.preheatDays);
  ($('#cfgSterilize') as HTMLInputElement).value = String(state.config.cycle.sterilizeDays);
  ($('#cfgBiDays') as HTMLInputElement).value = String(state.config.cycle.biDays);
  ($('#cfgD002Min') as HTMLInputElement).value = String(
    effectiveMinLoadM3('D002', state.config, PROCESSES),
  );
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
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty"><div class="emoji">📭</div><div>无可排行（已全部排入或筛选为空）</div></div></td></tr>`;
  } else {
    tbody.innerHTML = list
      .map((p) => {
        const checked = state.selectedPool.has(p.id) ? 'checked' : '';
        const short = p.name.length > 12 ? `${p.name.slice(0, 12)}…` : p.name;
        return `<tr class="${checked ? 'selected' : ''}" data-id="${escapeHtml(p.id)}">
          <td><input type="checkbox" data-pool="${escapeHtml(p.id)}" ${checked}></td>
          <td class="mono">${escapeHtml(p.id)}</td>
          <td class="pool-name-cell" title="${escapeHtml(p.name)}">
            ${needsSplit(p, state.config) ? '<span class="tag tag-orange">需拆炉</span> ' : ''}
            ${p.suggest ? `<span class="tag tag-purple" title="${escapeHtml(p.suggest)}">拼</span> ` : ''}
            <strong>${escapeHtml(short)}</strong>
            <div class="sub">${escapeHtml(p.process)} · ${p.boxes}箱 · <strong>${p.vol}</strong> m³ · ${escapeHtml(p.customer.replace('C-', ''))}</div>
          </td>
          <td class="facts-cell">${factStripHtml(p)}</td>
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
        const showManualBar = fu.manualViolation || (scheduleMode() === 'manual' && hasErr);
        const showNeedFix = scheduleMode() === 'auto' && hasErr;
        const borderCls = hasErr ? 'has-error' : hasWarn ? 'has-warn' : '';
        const manualCls = showManualBar || showNeedFix ? 'has-manual' : '';
        const note = state.config.overrideNotes?.[fu.id] || '';
        const cabOpts = usableCabinets()
          .map(
            (c) =>
              `<option value="${escapeHtml(c.id)}" ${c.id === fu.cabinetId ? 'selected' : ''}>${escapeHtml(c.id)}</option>`,
          )
          .join('');
        const violationBar = showNeedFix
          ? '<div class="furnace-violation need-fix">需手工处理或改回合法</div>'
          : showManualBar
            ? '<div class="furnace-violation">手工违例</div>'
            : '';
        return `<div class="furnace-card ${sel} ${borderCls} ${manualCls}" data-fid="${escapeHtml(fu.id)}">
          ${violationBar}
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
              <select class="select cab-change" data-change-cab="${escapeHtml(fu.id)}" title="改柜">${cabOpts}</select>
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
          ${
            showManualBar || showNeedFix
              ? `<div class="furnace-actions" style="flex-direction:column;align-items:stretch">
            <input class="input override-note" data-override-note="${escapeHtml(fu.id)}" placeholder="违例原因（建议填写）" value="${escapeHtml(note)}" />
          </div>`
              : ''
          }
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
        <td class="mono">${escapeHtml(p.salesOrderNo || p.wo)}</td>
        <td>${escapeHtml(p.factory)}</td>
        <td>${escapeHtml(p.workshop)}</td>
        <td>${escapeHtml(p.matType)}</td>
        <td class="mono">${escapeHtml(p.ref)}</td>
        <td>${escapeHtml(p.name)} ${p.urgent ? '<span class="tag tag-urgent">加急</span>' : ''}
            ${p.suggest ? `<span class="tag tag-purple">${escapeHtml(p.suggest)}</span>` : ''}
            ${p.useCab21 ? pendingTag('含柜21') : ''}
        </td>
        <td class="facts-cell">${factStripHtml(p)}</td>
        <td>${escapeHtml(p.customer)}</td>
        <td>${escapeHtml(p.due)}</td>
        <td class="mono">${escapeHtml(p.wo)}</td>
        <td class="mono">${p.dimL ?? '—'}×${p.dimW ?? '—'}×${p.dimH ?? '—'}</td>
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
        <td><strong>${escapeHtml(c.displayCode)}</strong></td>
        <td class="mono">${escapeHtml(c.canonicalId)}</td>
        <td>${c.base}基地</td>
        <td>${c.ratedLoadM3} m³</td>
        <td>${c.capacity} m³</td>
        <td>${traysForCabinet(c.id).length} 层</td>
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
      <h4>大箱 单箱 ≥ ${cfg.box.largeBoxVol} m³</h4>
      <p>只统计大箱箱数合计，上限 <strong>≤ ${cfg.box.maxBoxesWhenLarge} 箱</strong>。炉总箱数不触发；超限须拆炉或减载。</p>
    </div>
    <div class="rule-card">
      <h4>D002 最低拼载</h4>
      <p>单炉体积目标 <strong>≥ ${effectiveMinLoadM3('D002', cfg, PROCESSES)} m³</strong>。不足时告警，建议与同工艺拼货。</p>
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
        <td>${b.vol >= cfg.box.largeBoxVol ? `<span class="tag tag-orange">大箱合计 ≤${cfg.box.maxBoxesWhenLarge}箱/炉</span>` : '<span class="tag tag-green">常规</span>'}
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
  const raw = collectIssues();
  const issues = filterAndSortIssues(raw, state.furnaces, state.valFilter);
  const box = $('#issueList');
  $('#valErr').textContent = String(raw.filter((i) => i.sev === 'error').length);
  $('#valWarn').textContent = String(raw.filter((i) => i.sev === 'warning').length);
  $('#valInfo').textContent = String(raw.filter((i) => i.sev === 'info').length);
  $$('#valFilterTabs .shift-tab').forEach((t) => t.classList.toggle('active', t.dataset.valFilter === state.valFilter));
  const viol = new Set(state.furnaces.filter((f) => f.manualViolation).map((f) => f.id));
  if (!issues.length) {
    box.innerHTML = `<div class="empty"><div class="emoji">✅</div><div>${raw.length ? '当前筛选下无条目' : '当前班次无校验问题'}</div><div class="hint">在工作台分配炉次后点击「运行校验」</div></div>`;
    return;
  }
  box.innerHTML = issues
    .map((i) => {
      const manual = Boolean(i.furnaceId && viol.has(i.furnaceId));
      return `
      <div class="issue-item ${manual ? 'manual-hit' : ''}" data-jump="${escapeHtml(i.furnaceId || '')}">
        <div class="issue-sev">
          <span class="tag ${i.sev === 'error' ? 'tag-red' : i.sev === 'warning' ? 'tag-orange' : 'tag-blue'}">
            ${i.sev === 'error' ? '错误' : i.sev === 'warning' ? '警告' : '信息'}
          </span>
          ${manual ? '<span class="tag tag-red">手工违例</span>' : ''}
        </div>
        <div class="issue-body">
          <div class="msg">${escapeHtml(i.msg)}</div>
          <div class="meta">代码 ${escapeHtml(i.code)}${i.furnaceId ? ` · 炉次 ${escapeHtml(i.furnaceId)}` : ''}${i.pendingFlag ? ' · 待确认' : ''}${i.scheduleModeAtDetect ? ` · 检测时 ${i.scheduleModeAtDetect === 'manual' ? '手工调整' : '自动排产'}` : ''} · 点击跳转工作台</div>
        </div>
      </div>`;
    })
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
  $opt('#topResultDate')?.addEventListener('change', (e) => {
    state.date = (e.target as HTMLInputElement).value;
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
  $$('#scheduleModeTabs .shift-tab').forEach((t) => {
    t.addEventListener('click', () => {
      const mode = t.dataset.mode === 'manual' ? 'manual' : 'auto';
      setScheduleMode(mode);
    });
  });
  $opt('#factDrawerClose')?.addEventListener('click', closeFactDrawer);
  $opt('#factDrawerMask')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFactDrawer();
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
    const handler = (e: Event) => {
      const n = Number((e.target as HTMLInputElement).value);
      if (!Number.isFinite(n) || n < 0) return;
      apply(n);
      persist();
      if (state.fpLoads.length) syncFurnacePlan({ silent: true });
      render();
    };
    $(sel).addEventListener('change', handler);
    $(sel).addEventListener('input', handler);
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
    state.config = setProcessMinLoad(state.config, 'D002', n);
  });
  bindNum('#cfgDefaultMin', (n) => {
    state.config.load.defaultMinM3 = n;
  });

  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    const cabSel = t.closest('[data-change-cab]') as HTMLSelectElement | null;
    if (cabSel) {
      changeFurnaceCabinet(cabSel.dataset.changeCab!, cabSel.value);
      return;
    }
    const noteInp = t.closest('[data-override-note]') as HTMLInputElement | null;
    if (noteInp) {
      saveOverrideNote(noteInp.dataset.overrideNote!, noteInp.value);
      return;
    }
    const cb = t.closest('[data-pool]') as HTMLInputElement | null;
    if (cb) {
      const id = cb.dataset.pool!;
      if (cb.checked) state.selectedPool.add(id);
      else state.selectedPool.delete(id);
      renderWorkbench();
      return;
    }
    const grpCheck = t.closest('[data-grp-check]') as HTMLInputElement | null;
    if (grpCheck) {
      const next = toggleDemandCheck(
        { focusedId: state.grpFocusedDemandId, checkedIds: [...state.grpCheckedDemandIds] },
        grpCheck.dataset.grpCheck!,
        grpCheck.checked,
      );
      state.grpCheckedDemandIds = new Set(next.checkedIds);
      renderGrouping();
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const grpEntry = t.closest('[data-grp-entry]') as HTMLElement | null;
    if (grpEntry?.dataset.grpEntry) {
      state.grpEntry = grpEntry.dataset.grpEntry === 'demand' ? 'demand' : 'cabinet';
      renderGrouping();
      return;
    }
    if (t.id === 'btnAutoPack' || t.closest('#btnAutoPack')) {
      runAutoPack();
      return;
    }
    if (t.id === 'btnManualPack' || t.closest('#btnManualPack')) {
      runManualPack();
      return;
    }
    if (t.id === 'btnLoadComplete' || t.closest('#btnLoadComplete')) {
      runMarkLoadComplete();
      return;
    }
    const grpMode = t.closest('#grpScheduleModeTabs [data-mode]') as HTMLElement | null;
    if (grpMode?.dataset.mode) {
      setScheduleMode(grpMode.dataset.mode === 'manual' ? 'manual' : 'auto');
      return;
    }
    const grpCab = t.closest('[data-grp-cab]') as HTMLElement | null;
    if (grpCab?.dataset.grpCab) {
      const id = grpCab.dataset.grpCab;
      const rt = currentRuntimes().find((r) => r.cabinetId === id);
      if (rt?.status === 'sterilizing') {
        state.grpSelectedCabinetId = id;
        renderGrouping();
        toast('灭菌中：可查看但不可组柜', 'warn');
        return;
      }
      state.grpSelectedCabinetId = id;
      renderGrouping();
      return;
    }
    const grpDemand = t.closest('[data-grp-demand-view]') as HTMLElement | null;
    if (grpDemand && !t.closest('[data-grp-check]')) {
      const id = grpDemand.dataset.grpDemandView!;
      const next = focusDemand({ focusedId: state.grpFocusedDemandId, checkedIds: [...state.grpCheckedDemandIds] }, id);
      state.grpFocusedDemandId = next.focusedId;
      state.grpCheckedDemandIds = new Set(next.checkedIds);
      renderGrouping();
      return;
    }
    const fact = t.closest('[data-fact-open]') as HTMLElement | null;
    if (fact?.dataset.factOpen) {
      e.preventDefault();
      openFactDrawer(fact.dataset.factOpen);
      return;
    }
    const vf = t.closest('[data-val-filter]') as HTMLElement | null;
    if (vf?.dataset.valFilter) {
      state.valFilter = vf.dataset.valFilter as IssueFilter;
      renderValidation();
      return;
    }
    if (t.closest('[data-change-cab], [data-override-note]')) return;
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
  const lookup = (id: string) => pool.find((p) => p.id === id) || loaded.virtualLines.find((p) => p.id === id);
  const furnaces = (loaded.furnaces || []).map((f) =>
    normalizeCabinetContent(
      { ...f, date: f.date ?? null, shift: f.shift ?? null },
      {
        trayMaster: TRAYS,
        poolById: lookup,
        largeBoxVol: loaded.config.box.largeBoxVol,
        cabinet: cabinetById(f.cabinetId),
      },
    ),
  );
  state = {
    page: 'grouping',
    date: loaded.date,
    shift: loaded.shift,
    selectedPool: new Set(),
    selectedFurnaceId: null,
    furnaces,
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
    valFilter: 'all',
    grpEntry: 'cabinet',
    grpSelectedCabinetId: '柜9',
    grpFocusedDemandId: null,
    grpCheckedDemandIds: new Set(),
    grpLayerHint: false,
    tasks: loaded.tasks || [],
    schedules: loaded.schedules || [],
    nextTaskSeq: loaded.nextTaskSeq || 1,
  };
  bind();
  navigate('grouping');
}
