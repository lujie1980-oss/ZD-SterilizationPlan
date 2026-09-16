import type {
  AppConfig,
  Cabinet,
  EditSource,
  FurnaceRun,
  Process,
  RuleContext,
  ScheduleMode,
  Shift,
  StockLine,
  ValidationIssue,
} from './entities';
import { currentFurnaces } from './pool';
import { validateAll, validateFurnace } from './rule-engine';
import { suggestCombineD002Cab9 } from './suggest-combine';

export type IssueFilter = 'all' | 'error' | 'manual';

export interface CommitDecision {
  ok: boolean;
  aborted: boolean;
  persisted: FurnaceRun[];
  issues: ValidationIssue[];
  needsOverridePrompt: boolean;
  message: string;
}

export function cloneFurnaces(furnaces: FurnaceRun[]): FurnaceRun[] {
  return furnaces.map((f) => ({ ...f, lines: [...f.lines] }));
}

export function applyAssign(furnaces: FurnaceRun[], furnaceId: string, lineIds: string[]): FurnaceRun[] {
  const next = cloneFurnaces(furnaces);
  const f = next.find((x) => x.id === furnaceId);
  if (!f) return next;
  for (const id of lineIds) {
    if (!f.lines.includes(id)) f.lines.push(id);
  }
  return next;
}

export function applyChangeCabinet(furnaces: FurnaceRun[], furnaceId: string, cabinetId: string): FurnaceRun[] {
  const next = cloneFurnaces(furnaces);
  const f = next.find((x) => x.id === furnaceId);
  if (f) f.cabinetId = cabinetId;
  return next;
}

export function extendPoolById(
  base: (id: string) => StockLine | undefined,
  extras: StockLine[],
): (id: string) => StockLine | undefined {
  const map = new Map(extras.map((l) => [l.id, l]));
  return (id) => map.get(id) ?? base(id);
}

function changedFurnaceIds(previous: FurnaceRun[], next: FurnaceRun[]): Set<string> {
  const prev = new Map(previous.map((f) => [f.id, f]));
  const ids = new Set<string>();
  for (const f of next) {
    const p = prev.get(f.id);
    if (!p) {
      ids.add(f.id);
      continue;
    }
    if (
      p.cabinetId !== f.cabinetId ||
      p.hidden !== f.hidden ||
      p.lines.length !== f.lines.length ||
      p.lines.some((id, i) => id !== f.lines[i])
    ) {
      ids.add(f.id);
    }
  }
  return ids;
}

function effectiveGate(editSource: EditSource, scheduleMode: ScheduleMode): ScheduleMode {
  if (editSource === 'auto') return 'auto';
  return scheduleMode === 'manual' ? 'manual' : 'auto';
}

function annotateIssues(issues: ValidationIssue[], gate: ScheduleMode, uiMode: ScheduleMode): ValidationIssue[] {
  return issues.map((i) => ({
    ...i,
    scheduleModeAtDetect: uiMode,
    blocking: gate === 'auto' && i.sev === 'error',
  }));
}

function formatAbortMessage(issues: ValidationIssue[]): string {
  const errors = issues.filter((i) => i.sev === 'error');
  if (!errors.length) return '存在硬错误，已拒绝落盘';
  if (errors.length === 1) return errors[0]!.msg;
  return `自动排产拒绝落盘：${errors.map((i) => i.msg).join('；')}`;
}

export function decideCommit(opts: {
  previous: FurnaceRun[];
  next: FurnaceRun[];
  config: AppConfig;
  ctx: RuleContext;
  editSource: EditSource;
}): CommitDecision {
  const uiMode: ScheduleMode = opts.config.scheduleMode === 'manual' ? 'manual' : 'auto';
  const gate = effectiveGate(opts.editSource, uiMode);
  const changed = changedFurnaceIds(opts.previous, opts.next);
  const targets = opts.next.filter((f) => !f.hidden && changed.has(f.id));
  const raw = targets.flatMap((f) => validateFurnace(f, opts.ctx));
  const issues = annotateIssues(raw, gate, uiMode);
  const hasError = issues.some((i) => i.sev === 'error');

  if (gate === 'auto' && hasError) {
    return {
      ok: false,
      aborted: true,
      persisted: cloneFurnaces(opts.previous),
      issues,
      needsOverridePrompt: false,
      message: formatAbortMessage(issues),
    };
  }

  const persisted = opts.next.map((f) => {
    if (f.hidden || !changed.has(f.id)) return { ...f, lines: [...f.lines] };
    const ferr = validateFurnace(f, opts.ctx).some((i) => i.sev === 'error');
    if (gate === 'manual' && ferr) return { ...f, lines: [...f.lines], manualViolation: true };
    if (!ferr) return { ...f, lines: [...f.lines], manualViolation: false };
    return { ...f, lines: [...f.lines] };
  });

  return {
    ok: true,
    aborted: false,
    persisted,
    issues,
    needsOverridePrompt: gate === 'manual' && hasError,
    message: hasError ? '已按手工调整保存（存在硬错误，建议填写违例原因）' : '已保存',
  };
}

export function commitSuggestCombine(opts: {
  pool: StockLine[];
  furnaces: FurnaceRun[];
  assigned: Set<string>;
  date: string;
  shift: Shift;
  nextSeq: number;
  minLoad: number;
  poolById: (id: string) => StockLine | undefined;
  config: AppConfig;
  cabinets: Cabinet[];
  processes: Process[];
}): CommitDecision & { nextSeq: number; selectedFurnaceId?: string } {
  const previous = cloneFurnaces(opts.furnaces);
  const working = cloneFurnaces(opts.furnaces);
  const suggestion = suggestCombineD002Cab9({
    pool: opts.pool,
    furnaces: working,
    assigned: opts.assigned,
    date: opts.date,
    shift: opts.shift,
    nextSeq: opts.nextSeq,
    minLoad: opts.minLoad,
    poolById: opts.poolById,
  });
  if (!suggestion.result.ok) {
    return {
      ok: false,
      aborted: false,
      persisted: opts.furnaces,
      issues: [],
      needsOverridePrompt: false,
      message: suggestion.result.message,
      nextSeq: opts.nextSeq,
    };
  }
  const next = suggestion.furnaces;
  const ctx: RuleContext = {
    cabinets: opts.cabinets,
    processes: opts.processes,
    poolById: opts.poolById,
    config: opts.config,
    sameShiftFurnaces: currentFurnaces(next, opts.date, opts.shift),
  };
  const decision = decideCommit({
    previous,
    next,
    config: opts.config,
    ctx,
    editSource: 'auto',
  });
  if (decision.aborted) {
    return {
      ...decision,
      message: `建议拼炉已回滚：${decision.message}`,
      nextSeq: opts.nextSeq,
    };
  }
  return {
    ...decision,
    message: suggestion.result.message,
    nextSeq: suggestion.nextSeq,
    selectedFurnaceId: suggestion.selectedFurnaceId,
  };
}

export function filterAndSortIssues(
  issues: ValidationIssue[],
  furnaces: FurnaceRun[],
  filter: IssueFilter,
): ValidationIssue[] {
  const viol = new Set(furnaces.filter((f) => f.manualViolation).map((f) => f.id));
  let list = issues.slice();
  if (filter === 'error') list = list.filter((i) => i.sev === 'error');
  if (filter === 'manual') list = list.filter((i) => Boolean(i.furnaceId && viol.has(i.furnaceId)));
  const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
  return list.sort((a, b) => {
    const am = a.furnaceId && viol.has(a.furnaceId) ? 0 : 1;
    const bm = b.furnaceId && viol.has(b.furnaceId) ? 0 : 1;
    if (am !== bm) return am - bm;
    return (order[a.sev] ?? 9) - (order[b.sev] ?? 9);
  });
}

export function collectFurnaceIssues(furnaces: FurnaceRun[], ctx: RuleContext, uiMode: ScheduleMode): ValidationIssue[] {
  const gate = uiMode === 'manual' ? 'manual' : 'auto';
  return annotateIssues(validateAll(furnaces, ctx), gate, uiMode);
}
