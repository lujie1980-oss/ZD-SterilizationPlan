import { defineStore } from 'pinia';
import {
  DEFAULT_DATE,
  DEMO_MIN_CABINETS,
  DEMO_MIN_LOADS,
  PLAN_SEED_VERSION,
  isDemoSeedEnabled,
} from '../../data/config-defaults';
import { CABINETS, TRAYS, cabinetById } from '../../data/seed-cabinets';
import { getDemoFurnaceSeed } from '../../data/seed-demo-plan';
import { createSeedPool } from '../../data/seed-pool';
import { PROCESSES } from '../../data/seed-processes';
import { normalizeCabinetContent } from '../../domain/cabinet-content';
import { demoRuntimeOverrides, deriveAllRuntimes } from '../../domain/cabinet-runtime';
import { applyGanttSchedule } from '../../domain/cabinet-task';
import type {
  AppConfig,
  CabinetTask,
  EntryLoad,
  FurnaceRun,
  FurnaceSchedule,
  GroupingEntry,
  PackSuggestPolicy,
  ScheduleSortPolicy,
  Shift,
  StockLine,
  ValidationIssue,
} from '../../domain/entities';
import { buildEntryLoads } from '../../domain/entry-scheduler';
import { buildDayPlanCsv } from '../../domain/export-csv';
import {
  autoPackCabinet,
  autoPackDemands,
  focusDemand,
  markLoadComplete,
  manualPackCabinet,
  replaceCabinetActive,
  toggleDemandCheck,
} from '../../domain/grouping';
import {
  applyAssign,
  applyChangeCabinet,
  cloneFurnaces,
  collectFurnaceIssues,
  commitSuggestCombine,
  decideCommit,
  extendPoolById,
  type IssueFilter,
} from '../../domain/commit-gate';
import { effectiveMinLoadM3, setProcessMinLoad } from '../../domain/min-load';
import {
  clonePackSuggestPolicy,
  commitPackSuggestPolicy,
  policyFromPreset,
  resolvePackSuggestPolicy,
  restoreDefaultPackSuggestPolicy,
} from '../../domain/pack-suggest-policy';
import {
  cloneScheduleSortPolicy,
  commitScheduleSortPolicy,
  resolveScheduleSortPolicy,
  restoreDefaultScheduleSortPolicy,
} from '../../domain/schedule-sort-policy';
import {
  assignedIds,
  currentFurnaces,
  isPlanSparse,
  mergeVirtualLinesIntoPool,
  unscheduledContents,
  upsertVirtualLine,
} from '../../domain/pool';
import { canAddFurnace, validateFurnace } from '../../domain/rule-engine';
import { applySplit, findSplitTarget } from '../../domain/split-wizard';
import { loadPlan, savePlan, type LoadedPlan } from '../../persistence/plan-store-v2';
import { useUiStore } from './uiStore';

const GROUPING_ISSUE_CODES = new Set(['REPACK_AFTER_LOAD_COMPLETE', 'ON_TRAY_QTY_OVERFLOW', 'TRAY_OVERFLOW']);

function toast(msg: string, type: 'success' | 'error' | 'warn' | 'info' = 'success'): void {
  useUiStore().toast(msg, type);
}

export const usePlanStore = defineStore('plan', {
  state: () => ({
    ready: false,
    date: DEFAULT_DATE,
    shift: '白班' as Shift,
    selectedPool: [] as string[],
    selectedFurnaceId: null as string | null,
    furnaces: [] as FurnaceRun[],
    filters: { q: '', customer: '', process: '', urgentOnly: false },
    config: {} as AppConfig,
    nextFurnaceSeq: 1,
    fpStartDate: DEFAULT_DATE,
    fpHorizon: 14,
    fpShiftFilter: '',
    fpSelectedCab: null as string | null,
    fpLoads: [] as EntryLoad[],
    fpConflicts: [] as ValidationIssue[],
    virtualLines: [] as StockLine[],
    planSeedVersion: 0,
    pool: [] as StockLine[],
    valFilter: 'all' as IssueFilter,
    grpEntry: 'cabinet' as GroupingEntry,
    grpSelectedCabinetId: '柜9' as string | null,
    grpFocusedDemandId: null as string | null,
    grpCheckedDemandIds: [] as string[],
    grpLayerHint: false,
    grpPolicyDraft: null as PackSuggestPolicy | null,
    fpSortPolicyDraft: null as ScheduleSortPolicy | null,
    tasks: [] as CabinetTask[],
    schedules: [] as FurnaceSchedule[],
    nextTaskSeq: 1,
  }),
  getters: {
    scheduleMode(): 'auto' | 'manual' {
      return this.config.scheduleMode === 'manual' ? 'manual' : 'auto';
    },
    packPolicy(): PackSuggestPolicy {
      return this.grpPolicyDraft || resolvePackSuggestPolicy(this.config);
    },
    sortPolicy(): ScheduleSortPolicy {
      return this.fpSortPolicyDraft || resolveScheduleSortPolicy(this.config);
    },
  },
  actions: {
    hydrate(): void {
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
      this.date = loaded.date;
      this.shift = loaded.shift;
      this.selectedPool = [];
      this.selectedFurnaceId = null;
      this.furnaces = furnaces;
      this.filters = { q: '', customer: '', process: '', urgentOnly: false };
      this.config = loaded.config;
      this.nextFurnaceSeq = loaded.nextFurnaceSeq;
      this.fpStartDate = loaded.date || DEFAULT_DATE;
      this.fpHorizon = loaded.config.fp.defaultHorizon;
      this.fpShiftFilter = '';
      this.fpSelectedCab = null;
      this.fpLoads = [];
      this.fpConflicts = [];
      this.virtualLines = loaded.virtualLines;
      this.planSeedVersion = loaded.planSeedVersion;
      this.pool = pool;
      this.valFilter = 'all';
      this.grpEntry = 'cabinet';
      this.grpSelectedCabinetId = '柜9';
      this.grpFocusedDemandId = null;
      this.grpCheckedDemandIds = [];
      this.grpLayerHint = false;
      this.grpPolicyDraft = clonePackSuggestPolicy(resolvePackSuggestPolicy(loaded.config));
      this.fpSortPolicyDraft = cloneScheduleSortPolicy(resolveScheduleSortPolicy(loaded.config));
      this.tasks = loaded.tasks || [];
      this.schedules = loaded.schedules || [];
      this.nextTaskSeq = loaded.nextTaskSeq || 1;
      this.ready = true;
    },
    persist(): void {
      const plan: LoadedPlan = {
        date: this.date,
        shift: this.shift,
        furnaces: this.furnaces,
        contents: this.furnaces,
        tasks: this.tasks,
        schedules: this.schedules,
        nextFurnaceSeq: this.nextFurnaceSeq,
        nextTaskSeq: this.nextTaskSeq,
        virtualLines: this.virtualLines,
        config: this.config,
        planSeedVersion: this.planSeedVersion,
        sparseWiped: false,
      };
      savePlan(plan);
    },
    poolById(id: string): StockLine | undefined {
      return this.pool.find((p) => p.id === id) || this.virtualLines.find((p) => p.id === id);
    },
    ruleCtx(sameShift?: FurnaceRun[], lookup?: (id: string) => StockLine | undefined) {
      const shiftFurnaces = sameShift ?? currentFurnaces(this.furnaces, this.date, this.shift);
      const look = lookup ?? ((id: string) => this.poolById(id));
      return {
        cabinets: CABINETS,
        processes: PROCESSES,
        poolById: look,
        config: this.config,
        sameShiftFurnaces: shiftFurnaces,
        trayMaster: TRAYS,
        allContents: shiftFurnaces,
        runtimes: deriveAllRuntimes(CABINETS, shiftFurnaces, demoRuntimeOverrides()),
      };
    },
    ruleCtxFor(furnaces: FurnaceRun[], lookup?: (id: string) => StockLine | undefined) {
      return this.ruleCtx(currentFurnaces(furnaces, this.date, this.shift), lookup);
    },
    currentRuntimes() {
      return deriveAllRuntimes(CABINETS, this.furnaces, demoRuntimeOverrides());
    },
    eligiblePool(): StockLine[] {
      return this.pool.filter((p) => !p.splitOf);
    },
    applyDecision(decision: ReturnType<typeof decideCommit>, successToast: string): boolean {
      if (decision.aborted) {
        toast(decision.message, 'error');
        return false;
      }
      this.furnaces = decision.persisted;
      this.persist();
      if (decision.needsOverridePrompt) {
        toast(decision.message, 'warn');
        const viol = decision.persisted.find((f) => f.manualViolation);
        if (viol) useUiStore().openOverride(viol.id, decision.issues);
      } else {
        toast(successToast);
      }
      return true;
    },
    saveOverrideNote(furnaceId: string, note: string): void {
      const notes = { ...(this.config.overrideNotes ?? {}) };
      if (note) notes[furnaceId] = note;
      else delete notes[furnaceId];
      this.config = { ...this.config, overrideNotes: notes };
      this.persist();
    },
    setScheduleMode(mode: 'auto' | 'manual'): void {
      if (this.scheduleMode === mode) return;
      this.config = { ...this.config, scheduleMode: mode };
      this.persist();
      if (mode === 'auto') {
        const furns = currentFurnaces(this.furnaces, this.date, this.shift);
        const hasErr = furns.some((f) => validateFurnace(f, this.ruleCtx(furns)).some((i) => i.sev === 'error'));
        if (hasErr) toast('已切回自动排产：存在违例炉次需手工处理或改回合法。新的自动写入若含 error 将被拒绝。', 'warn');
      } else {
        toast('已切换为手工调整：error 可落盘，炉次将标「手工违例」，建议填写原因。', 'info');
      }
    },
    setDate(date: string): void {
      this.date = date;
      this.selectedFurnaceId = null;
      this.persist();
    },
    setShift(shift: Shift): void {
      this.shift = shift;
      this.selectedFurnaceId = null;
      this.persist();
    },
    seedDemoFurnaceLoadsIfEmpty(): boolean {
      if (!isDemoSeedEnabled(this.config)) return false;
      if (!isPlanSparse(this.furnaces, DEMO_MIN_LOADS, DEMO_MIN_CABINETS, this.virtualLines)) {
        if ((this.planSeedVersion || 0) < PLAN_SEED_VERSION) {
          this.planSeedVersion = PLAN_SEED_VERSION;
          this.persist();
        }
        return false;
      }
      this.furnaces = [];
      this.nextFurnaceSeq = 1;
      this.selectedFurnaceId = null;
      this.pool = mergeVirtualLinesIntoPool(this.pool, this.virtualLines);
      getDemoFurnaceSeed().forEach((d) => {
        const free = d.lines.filter((id) => this.poolById(id) && !assignedIds(this.furnaces).has(id));
        if (!free.length) return;
        const raw: FurnaceRun = {
          id: `F${this.nextFurnaceSeq++}`,
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
        this.furnaces.push(
          normalizeCabinetContent(raw, {
            trayMaster: TRAYS,
            poolById: (id) => this.poolById(id),
            largeBoxVol: this.config.box.largeBoxVol,
            cabinet: cabinetById(d.cabinetId),
          }),
        );
      });
      this.planSeedVersion = PLAN_SEED_VERSION;
      this.persist();
      return true;
    },
    enterGrouping(): void {
      this.seedDemoFurnaceLoadsIfEmpty();
    },
    syncFurnacePlan(opts?: { silent?: boolean }): void {
      if (!this.fpStartDate) this.fpStartDate = this.date || DEFAULT_DATE;
      const seeded = this.seedDemoFurnaceLoadsIfEmpty();
      const scheduled = applyGanttSchedule({
        contents: this.furnaces,
        cabinets: CABINETS,
        processes: PROCESSES,
        config: this.config,
        poolById: (id) => this.poolById(id),
        trayMaster: TRAYS,
        startDate: this.fpStartDate,
        scheduleMode: this.scheduleMode,
        epoch: DEFAULT_DATE,
        nextTaskSeq: this.nextTaskSeq,
      });
      if (scheduled.aborted) {
        if (!opts?.silent) toast(scheduled.message, 'error');
        const built = buildEntryLoads({
          furnaces: this.furnaces,
          cabinets: CABINETS,
          processes: PROCESSES,
          config: this.config,
          poolById: (id) => this.poolById(id),
          epoch: DEFAULT_DATE,
        });
        this.fpLoads = built.loads;
        this.fpConflicts = built.conflicts;
        return;
      }
      this.furnaces = scheduled.contents;
      this.tasks = scheduled.tasks;
      this.schedules = scheduled.schedules;
      this.persist();
      const { loads, conflicts } = buildEntryLoads({
        furnaces: this.furnaces,
        cabinets: CABINETS,
        processes: PROCESSES,
        config: this.config,
        poolById: (id) => this.poolById(id),
        epoch: DEFAULT_DATE,
      });
      this.fpLoads = loads;
      this.fpConflicts = conflicts;
      if (!opts?.silent) {
        toast(
          seeded
            ? `已同步装炉结果（演示组柜 ${this.furnaces.filter((f) => !f.hidden).length} 柜）并写回上线日期`
            : scheduled.message,
          scheduled.issues.length ? 'warn' : 'success',
        );
      }
    },
    enterGantt(): void {
      if (!this.fpStartDate) this.fpStartDate = this.date || DEFAULT_DATE;
      this.syncFurnacePlan({ silent: true });
    },
    collectIssues(): ValidationIssue[] {
      const scheduled = currentFurnaces(this.furnaces, this.date, this.shift);
      const unsched = unscheduledContents(this.furnaces);
      const scheduledIssues = collectFurnaceIssues(scheduled, this.ruleCtx(scheduled), this.scheduleMode);
      const groupingIssues = collectFurnaceIssues(unsched, this.ruleCtx(unsched), this.scheduleMode).filter((i) =>
        GROUPING_ISSUE_CODES.has(i.code),
      );
      return [...scheduledIssues, ...groupingIssues, ...this.fpConflicts];
    },
    refreshValidationLoads(): void {
      const built = buildEntryLoads({
        furnaces: this.furnaces,
        cabinets: CABINETS,
        processes: PROCESSES,
        config: this.config,
        poolById: (id) => this.poolById(id),
        epoch: DEFAULT_DATE,
      });
      this.fpLoads = built.loads;
      this.fpConflicts = built.conflicts;
    },
    markPolicyDraftCustom(): void {
      if (!this.grpPolicyDraft) return;
      this.grpPolicyDraft.preset = 'custom';
      this.grpPolicyDraft.id = 'custom';
      this.grpPolicyDraft.name = '自定义';
    },
    savePackPolicyFromDraft(): void {
      const previous = resolvePackSuggestPolicy(this.config);
      const result = commitPackSuggestPolicy(previous, this.packPolicy);
      if (!result.ok) {
        toast(`${result.code}：${result.message}`, 'error');
        return;
      }
      this.config = { ...this.config, packSuggestPolicy: result.policy };
      this.grpPolicyDraft = clonePackSuggestPolicy(result.policy);
      this.persist();
      toast('建议策略已保存，将在下次自动组柜生效');
    },
    restorePackPolicyDefaults(): void {
      const previous = resolvePackSuggestPolicy(this.config);
      const next = restoreDefaultPackSuggestPolicy(previous);
      this.config = { ...this.config, packSuggestPolicy: next };
      this.grpPolicyDraft = clonePackSuggestPolicy(next);
      this.persist();
      toast('已恢复默认建议策略（填满优先 80%，交期簇关），下次自动组柜生效');
    },
    applyPackPreset(preset: string): void {
      const draft = this.packPolicy;
      if (preset === 'dueCluster' || preset === 'balanced' || preset === 'fillFirst') {
        this.grpPolicyDraft = policyFromPreset(preset, draft);
      } else {
        this.markPolicyDraftCustom();
      }
    },
    setFillMode(mode: 'fillOneFirst' | 'balanceAcrossCabinets'): void {
      this.grpPolicyDraft = { ...this.packPolicy, fillMode: mode };
      this.markPolicyDraftCustom();
    },
    setDueClusterEnabled(on: boolean): void {
      const dims = this.packPolicy.dimensions.map((d) => (d.code === 'dueCluster' ? { ...d, enabled: on } : { ...d }));
      if (!dims.some((d) => d.code === 'dueCluster')) dims.push({ code: 'dueCluster', enabled: on });
      this.grpPolicyDraft = { ...this.packPolicy, dimensions: dims };
      this.markPolicyDraftCustom();
    },
    setDueWindowDays(n: number): void {
      if (!Number.isInteger(n)) return;
      this.grpPolicyDraft = { ...this.packPolicy, dueWindowDays: n };
      this.markPolicyDraftCustom();
    },
    setTargetFillRatePct(pct: number): void {
      if (!Number.isFinite(pct)) return;
      this.grpPolicyDraft = { ...this.packPolicy, targetFillRate: pct / 100 };
      this.markPolicyDraftCustom();
    },
    movePackDim(i: number, dir: -1 | 1): void {
      const dims = this.packPolicy.dimensions.slice();
      const j = i + dir;
      if (j < 0 || j >= dims.length) return;
      const tmp = dims[i]!;
      dims[i] = dims[j]!;
      dims[j] = tmp;
      this.grpPolicyDraft = { ...this.packPolicy, dimensions: dims };
      this.markPolicyDraftCustom();
    },
    saveSortPolicyFromDraft(): void {
      const previous = resolveScheduleSortPolicy(this.config);
      const result = commitScheduleSortPolicy(previous, this.sortPolicy);
      if (!result.ok) {
        toast(`${result.code}：${result.message}`, 'error');
        return;
      }
      this.config = { ...this.config, scheduleSortPolicy: result.policy };
      this.fpSortPolicyDraft = cloneScheduleSortPolicy(result.policy);
      this.persist();
      toast('排序策略已保存，将在下次甘特同步生效');
    },
    restoreSortPolicyDefaults(): void {
      const previous = resolveScheduleSortPolicy(this.config);
      const next = restoreDefaultScheduleSortPolicy(previous);
      this.config = { ...this.config, scheduleSortPolicy: next };
      this.fpSortPolicyDraft = cloneScheduleSortPolicy(next);
      this.persist();
      toast('已恢复默认排序策略（date↑ · shift↑ · volume↓ · id↑），下次甘特同步生效');
    },
    toggleSortEnable(i: number, enabled: boolean): void {
      const keys = this.sortPolicy.keys.slice();
      const cur = keys[i];
      if (!cur) return;
      keys[i] = { ...cur, enabled };
      this.fpSortPolicyDraft = { ...this.sortPolicy, keys, id: 'custom', name: '自定义' };
    },
    moveSortKey(i: number, dir: -1 | 1): void {
      const keys = this.sortPolicy.keys.slice();
      const j = i + dir;
      if (j < 0 || j >= keys.length) return;
      const tmp = keys[i]!;
      keys[i] = keys[j]!;
      keys[j] = tmp;
      this.fpSortPolicyDraft = { ...this.sortPolicy, keys, id: 'custom', name: '自定义' };
    },
    toggleSortDir(i: number): void {
      const keys = this.sortPolicy.keys.slice();
      const cur = keys[i];
      if (!cur) return;
      keys[i] = { ...cur, direction: cur.direction === 'asc' ? 'desc' : 'asc' };
      this.fpSortPolicyDraft = { ...this.sortPolicy, keys, id: 'custom', name: '自定义' };
    },
    addFurnace(cabinetId: string): void {
      const check = canAddFurnace(cabinetId, this.ruleCtx());
      if (!check.ok) {
        toast(check.issue.msg || '该灭菌柜不可用', 'error');
        return;
      }
      const id = `F${this.nextFurnaceSeq++}`;
      this.furnaces.push({ id, cabinetId, shift: this.shift, date: this.date, lines: [] });
      this.selectedFurnaceId = id;
      this.persist();
      toast(`已新建炉次 ${id} → ${cabinetId}`);
    },
    assignSelected(): void {
      if (!this.selectedFurnaceId) {
        toast('请先选中右侧炉次卡片', 'warn');
        return;
      }
      const f = this.furnaces.find((x) => x.id === this.selectedFurnaceId);
      if (!f) return;
      const assigned = assignedIds(this.furnaces);
      const toAdd = this.selectedPool.filter((id) => !assigned.has(id));
      if (!toAdd.length) {
        toast('请勾选可排池中未分配的行', 'warn');
        return;
      }
      const next = applyAssign(this.furnaces, f.id, toAdd);
      const decision = decideCommit({
        previous: this.furnaces,
        next,
        config: this.config,
        ctx: this.ruleCtxFor(next),
        editSource: 'manual',
      });
      if (!decision.aborted) this.selectedPool = [];
      this.applyDecision(decision, `已分配 ${toAdd.length} 行至 ${f.cabinetId}（${f.id}）`);
    },
    changeFurnaceCabinet(furnaceId: string, cabinetId: string): void {
      const f = this.furnaces.find((x) => x.id === furnaceId);
      if (!f || f.cabinetId === cabinetId) return;
      const next = applyChangeCabinet(this.furnaces, furnaceId, cabinetId);
      const decision = decideCommit({
        previous: this.furnaces,
        next,
        config: this.config,
        ctx: this.ruleCtxFor(next),
        editSource: 'manual',
      });
      this.applyDecision(decision, `已将 ${furnaceId} 改至 ${cabinetId}`);
    },
    removeFromFurnace(furnaceId: string, lineId: string): void {
      const next = cloneFurnaces(this.furnaces);
      const f = next.find((x) => x.id === furnaceId);
      if (!f) return;
      f.lines = f.lines.filter((id) => id !== lineId);
      const decision = decideCommit({
        previous: this.furnaces,
        next,
        config: this.config,
        ctx: this.ruleCtxFor(next),
        editSource: 'manual',
      });
      if (decision.aborted) {
        toast(decision.message, 'error');
        return;
      }
      this.furnaces = decision.persisted;
      this.persist();
    },
    deleteFurnace(furnaceId: string): void {
      this.furnaces = this.furnaces.filter((f) => f.id !== furnaceId);
      if (this.selectedFurnaceId === furnaceId) this.selectedFurnaceId = null;
      if (this.config.overrideNotes?.[furnaceId]) {
        const notes = { ...this.config.overrideNotes };
        delete notes[furnaceId];
        this.config = { ...this.config, overrideNotes: notes };
      }
      this.persist();
      toast('已删除炉次');
    },
    suggestCombine(): void {
      const assigned = assignedIds(this.furnaces);
      const result = commitSuggestCombine({
        pool: this.pool,
        furnaces: this.furnaces,
        assigned,
        date: this.date,
        shift: this.shift,
        nextSeq: this.nextFurnaceSeq,
        minLoad: effectiveMinLoadM3('D002', this.config, PROCESSES),
        poolById: (id) => this.poolById(id),
        config: this.config,
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
      this.furnaces = result.persisted;
      this.nextFurnaceSeq = result.nextSeq;
      if (result.selectedFurnaceId) this.selectedFurnaceId = result.selectedFurnaceId;
      this.persist();
      toast(result.message, 'info');
    },
    confirmSplit(line: StockLine, boxesA: number, cabinetId: string): void {
      const applied = applySplit({
        parent: line,
        boxesA,
        cabinetId,
        date: this.date,
        shift: this.shift,
        nextSeq: this.nextFurnaceSeq,
      });
      const extras = [applied.rowA, applied.rowB];
      const nextFurnaces = [...cloneFurnaces(this.furnaces), ...applied.furnaces];
      const lookup = extendPoolById((id) => this.poolById(id), extras);
      const decision = decideCommit({
        previous: this.furnaces,
        next: nextFurnaces,
        config: this.config,
        ctx: this.ruleCtxFor(nextFurnaces, lookup),
        editSource: 'manual',
      });
      if (decision.aborted) {
        toast(decision.message, 'error');
        return;
      }
      const upA = upsertVirtualLine(this.virtualLines, this.pool, applied.rowA);
      const upB = upsertVirtualLine(upA.virtualLines, upA.pool, applied.rowB);
      this.virtualLines = upB.virtualLines;
      this.pool = upB.pool;
      this.selectedPool = this.selectedPool.filter((id) => id !== line.id);
      this.furnaces = decision.persisted;
      this.nextFurnaceSeq = applied.nextSeq;
      this.selectedFurnaceId = applied.furnaces[0]!.id;
      this.persist();
      if (decision.needsOverridePrompt) {
        toast(decision.message, 'warn');
        const viol = decision.persisted.find((x) => x.manualViolation);
        if (viol) useUiStore().openOverride(viol.id, decision.issues);
      } else {
        toast(`已拆为两炉：${applied.rowA.id}（${applied.rowA.boxes}箱）/ ${applied.rowB.id}（${applied.rowB.boxes}箱）→ ${cabinetId}`);
      }
    },
    openSplitWizard(): void {
      const assigned = assignedIds(this.furnaces);
      const target = findSplitTarget(this.pool, new Set(this.selectedPool), assigned, this.config, (id) => this.poolById(id));
      if (!target) {
        toast('当前无可拆大单，请勾选体积过大或箱数超限的行', 'warn');
        return;
      }
      useUiStore().openSplit();
    },
    findSplitLine(): StockLine | undefined {
      const assigned = assignedIds(this.furnaces);
      return findSplitTarget(this.pool, new Set(this.selectedPool), assigned, this.config, (id) => this.poolById(id));
    },
    exportCSV(): void {
      const issues = this.collectIssues();
      const hasError = issues.some((i) => i.sev === 'error');
      if (hasError && this.config.export.blockOnError) {
        toast('存在硬错误，已按配置阻止导出', 'error');
        return;
      }
      const csv = buildDayPlanCsv({
        date: this.date,
        shift: this.shift,
        furnaces: currentFurnaces(this.furnaces, this.date, this.shift),
        cabinets: CABINETS,
        poolById: (id) => this.poolById(id),
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
    },
    runAutoPack(): void {
      const runtimes = this.currentRuntimes();
      if (this.grpEntry === 'cabinet') {
        if (!this.grpSelectedCabinetId) {
          toast('请先选择灭菌柜', 'warn');
          return;
        }
        const packed = autoPackCabinet({
          cabinetId: this.grpSelectedCabinetId,
          pool: this.eligiblePool(),
          contents: this.furnaces,
          cabinets: CABINETS,
          processes: PROCESSES,
          trayMaster: TRAYS,
          runtimes,
          config: this.config,
          nextId: `CC${this.nextFurnaceSeq++}`,
          poolById: (id) => this.poolById(id),
        });
        if (!packed.ok || !packed.content) {
          toast(packed.message, 'error');
          return;
        }
        const replaced = replaceCabinetActive(this.furnaces, packed.content);
        if (!replaced.ok) {
          toast(replaced.issue?.msg || '无法写入', 'error');
          return;
        }
        const decision = decideCommit({
          previous: this.furnaces,
          next: replaced.contents,
          config: this.config,
          ctx: this.ruleCtx(replaced.contents),
          editSource: 'auto',
        });
        if (decision.aborted) {
          toast(decision.message, 'error');
          return;
        }
        this.furnaces = decision.persisted;
        this.grpLayerHint = true;
        this.persist();
        toast(packed.message);
        return;
      }
      const ids = this.grpCheckedDemandIds.length
        ? [...this.grpCheckedDemandIds]
        : this.grpFocusedDemandId
          ? [this.grpFocusedDemandId]
          : [];
      if (!ids.length) {
        toast('请勾选需求后再自动组柜（单击行仅查看）', 'warn');
        return;
      }
      const packed = autoPackDemands({
        lineIds: ids,
        pool: this.eligiblePool(),
        contents: this.furnaces,
        cabinets: CABINETS,
        processes: PROCESSES,
        trayMaster: TRAYS,
        runtimes,
        config: this.config,
        nextSeq: this.nextFurnaceSeq,
        poolById: (id) => this.poolById(id),
      });
      if (!packed.ok) {
        toast(packed.message, 'error');
        return;
      }
      const decision = decideCommit({
        previous: this.furnaces,
        next: packed.contents,
        config: this.config,
        ctx: this.ruleCtx(packed.contents),
        editSource: 'auto',
      });
      if (decision.aborted) {
        toast(decision.message, 'error');
        return;
      }
      this.furnaces = decision.persisted;
      this.nextFurnaceSeq = packed.nextSeq;
      const firstCab = packed.contents.find((c) => c.lines.length && !c.hidden)?.cabinetId;
      if (firstCab) this.grpSelectedCabinetId = firstCab;
      this.grpLayerHint = true;
      this.persist();
      const extra = packed.unplaced.length ? `；未组入 ${packed.unplaced.length} 行` : '';
      toast(`${packed.message}${extra}`);
    },
    runManualPack(): void {
      const runtimes = this.currentRuntimes();
      let cabinetId = this.grpSelectedCabinetId;
      const ids = this.grpEntry === 'demand' ? [...this.grpCheckedDemandIds] : [...this.grpCheckedDemandIds];
      if (this.grpEntry === 'demand' && !cabinetId) {
        toast('请先点选目标灭菌柜（查看行不会勾选需求）', 'warn');
        return;
      }
      if (this.grpEntry === 'cabinet' && !cabinetId) {
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
        contents: this.furnaces,
        cabinets: CABINETS,
        trayMaster: TRAYS,
        runtimes,
        config: this.config,
        nextId: `CC${this.nextFurnaceSeq++}`,
        poolById: (id) => this.poolById(id),
        allowInOther: false,
      });
      if (!packed.ok || !packed.content) {
        toast(packed.message, 'error');
        return;
      }
      const replaced = replaceCabinetActive(this.furnaces, packed.content);
      const next = replaced.ok ? replaced.contents : this.furnaces;
      const decision = decideCommit({
        previous: this.furnaces,
        next,
        config: this.config,
        ctx: this.ruleCtx(next),
        editSource: 'manual',
      });
      if (decision.aborted) {
        toast(decision.message, 'error');
        return;
      }
      this.furnaces = decision.persisted;
      this.grpLayerHint = true;
      this.persist();
      toast(packed.message, decision.needsOverridePrompt ? 'warn' : 'success');
      if (decision.needsOverridePrompt) {
        const viol = decision.persisted.find((x) => x.manualViolation);
        if (viol) useUiStore().openOverride(viol.id, decision.issues);
      }
    },
    runMarkLoadComplete(): void {
      const cabinetId = this.grpSelectedCabinetId;
      if (!cabinetId) {
        toast('请先选择灭菌柜', 'warn');
        return;
      }
      const content = this.furnaces.find((f) => f.cabinetId === cabinetId && !f.hidden);
      if (!content) {
        toast('该柜尚无组柜载荷', 'warn');
        return;
      }
      const issues = validateFurnace(content, this.ruleCtx(this.furnaces));
      const marked = markLoadComplete({ content, issues, scheduleMode: this.scheduleMode });
      if (!marked.ok) {
        toast(marked.message, 'error');
        return;
      }
      this.furnaces = this.furnaces.map((f) => (f.id === content.id ? marked.content : f));
      this.persist();
      toast(marked.message, marked.content.manualViolation ? 'warn' : 'success');
    },
    selectGroupingCabinet(id: string): void {
      const rt = this.currentRuntimes().find((r) => r.cabinetId === id);
      this.grpSelectedCabinetId = id;
      if (rt?.status === 'sterilizing') {
        toast('灭菌中：可查看但不可组柜', 'warn');
      }
    },
    focusGroupingDemand(id: string): void {
      const next = focusDemand({ focusedId: this.grpFocusedDemandId, checkedIds: this.grpCheckedDemandIds }, id);
      this.grpFocusedDemandId = next.focusedId;
      this.grpCheckedDemandIds = next.checkedIds;
    },
    checkGroupingDemand(id: string, checked: boolean): void {
      const next = toggleDemandCheck(
        { focusedId: this.grpFocusedDemandId, checkedIds: this.grpCheckedDemandIds },
        id,
        checked,
      );
      this.grpCheckedDemandIds = next.checkedIds;
    },
    togglePoolSelect(id: string, checked: boolean): void {
      if (checked) {
        if (!this.selectedPool.includes(id)) this.selectedPool = [...this.selectedPool, id];
      } else {
        this.selectedPool = this.selectedPool.filter((x) => x !== id);
      }
    },
    setAllowFiller(on: boolean): void {
      this.config.allowFiller = on;
      this.persist();
      toast(on ? '已开启「允许填充物」开关（待确认项）' : '已关闭填充物开关', 'info');
    },
    setMixCustomer(on: boolean): void {
      this.config.mixCustomerWarn = on;
      this.persist();
    },
    setCycleNum(field: 'preheatDays' | 'sterilizeDays' | 'biDays', n: number): void {
      if (!Number.isFinite(n) || n < 0) return;
      this.config.cycle[field] = n;
      this.persist();
      if (this.fpLoads.length) this.syncFurnacePlan({ silent: true });
    },
    setD002Min(n: number): void {
      if (!Number.isFinite(n) || n < 0) return;
      this.config = setProcessMinLoad(this.config, 'D002', n);
      this.persist();
    },
    setDefaultMin(n: number): void {
      if (!Number.isFinite(n) || n < 0) return;
      this.config.load.defaultMinM3 = n;
      this.persist();
    },
  },
});
