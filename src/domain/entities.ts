export type Shift = '白班' | '夜班';
export type CabinetStatus = '可用' | '报废' | '待确认';
export type Base = '老' | '新';
export type IssueSeverity = 'error' | 'warning' | 'info';
export type MatType = 'N' | 'K';
export type SterilizationMethod = 'EO' | '电子束' | '伽玛' | '委外';
export type ScheduleMode = 'auto' | 'manual';
export type EditSource = 'auto' | 'manual';
export type FactTone = 'neutral' | 'warn' | 'pending' | 'danger';
export type DueTone = 'ok' | 'soon' | 'overdue';
export type TrayStatus = '可用' | '停用';
export type ContentStatus = 'draft' | 'active' | 'scheduled' | 'inSterilization' | 'closed';
export type ScheduleStatus = 'unscheduled' | 'scheduled';
export type PlacementStatus = 'inThisCabinet' | 'inOtherCabinet' | 'unassigned';
export type RuntimeStatus = 'idle' | 'loading' | 'loadComplete' | 'sterilizing' | 'outOfService';
export type RuntimeSource = 'derived' | 'manual' | 'equipment';
export type GroupingEntry = 'cabinet' | 'demand';
export type FillMode = 'fillOneFirst' | 'balanceAcrossCabinets';
export type PackDimensionCode = 'gapMin' | 'targetFill' | 'dueCluster';
export type PackSuggestPreset = 'fillFirst' | 'dueCluster' | 'balanced' | 'custom';
export type PackSuggestApplyMode = 'nextAutoPackOnly';

export interface PackDimensionSpec {
  code: PackDimensionCode;
  enabled: boolean;
}

export interface PackSuggestPolicy {
  id: string;
  name: string;
  version: number;
  preset: PackSuggestPreset;
  fillMode: FillMode;
  targetFillRate: number;
  dueWindowDays: number;
  dimensions: PackDimensionSpec[];
  applyMode: PackSuggestApplyMode;
  updatedAt: string;
}

export interface Tray {
  id: string;
  cabinetId: string;
  level: number;
  displayName?: string;
  /** 托盘额定容积；超此体积须提示「超托盘」。旧快照可仅有 ratedLoadM3 */
  capacityM3?: number;
  /** @deprecated 迁移别名，等同 capacityM3 */
  ratedLoadM3?: number;
  maxBoxes?: number;
  maxBoards?: number;
  status: TrayStatus;
  note?: string;
}

export interface Cabinet {
  id: string;
  /** 规范码，如 cab-9；展示仍用 displayCode / id=柜9 以兼容一期 */
  canonicalId: string;
  displayCode: string;
  base: Base;
  /** 日产能 m³（OVER_CAP / 占用） */
  capacity: number;
  /** 装柜率分母；默认与额定装载一致 */
  ratedLoadM3: number;
  dailyCapacityM3?: number;
  status: CabinetStatus;
  note?: string;
  tags: string[];
  pending?: boolean;
  maxTrayCount?: number;
}

export interface Process {
  code: string;
  name: string;
  cabinets: string[];
  aerateDays: number;
  aerateConfirmed: boolean;
  pending?: boolean;
  note?: string;
  minLoadM3?: number;
}

export interface BoxSpec {
  id: string;
  sku: string;
  name: string;
  vol: number;
  note?: string;
}

export interface StockLine {
  id: string;
  factory: string;
  workshop: string;
  matType: MatType;
  matN?: string;
  matK?: string;
  ref: string;
  name: string;
  customer: string;
  due: string;
  wo: string;
  woN?: string;
  woK?: string;
  /** 销售订单号（交易事实；演示可与工单同源） */
  salesOrderNo?: string;
  salesOrderLine?: string;
  /** 规格长宽高；历史行可空，此时 boxVol 必填并标 specIncomplete */
  dimL?: number;
  dimW?: number;
  dimH?: number;
  specIncomplete?: boolean;
  boxes: number;
  boxVol: number;
  vol: number;
  batch: string;
  expiry?: string;
  loc: string;
  stockStatus: string;
  process: string;
  allowed: string[];
  urgent: boolean;
  suggest?: string;
  oversized?: boolean;
  pendingAllow?: boolean;
  useCab21?: boolean;
  splitOf?: string | null;
  sterilizationMethod: SterilizationMethod;
  destWhse?: string;
  planRemark?: string;
  date?: string;
  shift?: Shift;
}

/** 托盘上的需求行分量（正式名）；旧 OnLayer 仅迁移别名 */
export interface StockLinesOnTray {
  id: string;
  trayInContentId: string;
  stockLineId: string;
  boxes: number;
  vol: number;
  splitOf?: string | null;
}

/** 计划内一层 = 一次占用某个 Tray；禁止无 trayId 的临时层 */
export interface TraysInCabinetContent {
  id: string;
  contentId: string;
  trayId: string;
  level: number;
  vol: number;
  boxes: number;
  largeBoxes: number;
  onTray: StockLinesOnTray[];
}

export interface CabinetTask {
  id: string;
  contentId: string;
  previousTaskId: string | null;
  nextTaskId: string | null;
  isFirst: boolean;
  seq?: number;
}

export interface FurnaceSchedule {
  cabinetId: string;
  firstTaskId: string | null;
}

export interface CabinetRuntime {
  cabinetId: string;
  status: RuntimeStatus;
  activeLoadId?: string;
  activeEntryLoadId?: string;
  sterilizeStartedAt?: string;
  sterilizeEta?: string;
  updatedAt?: string;
  source: RuntimeSource;
}

export interface EligibleDemandRow {
  lineId: string;
  placement: PlacementStatus;
  otherCabinetId?: string;
  line: StockLine;
}

export interface EligibleCabinetRow {
  cabinetId: string;
  runtime: RuntimeStatus;
  selectable: boolean;
  disabledReason?: string;
  autoPackBlocked: boolean;
  cabinet: Cabinet;
}

/**
 * 组柜计划（正式名 CabinetContent）。
 * 组柜阶段 date/shift/seq/task 均为空；仅甘特写回/建 Task。
 */
export interface CabinetContent {
  id: string;
  cabinetId: string;
  /** 组柜时 null；甘特写回。旧快照可仍为 string。 */
  date: string | null;
  /** 组柜时 null；甘特写回 */
  shift: Shift | null;
  seq?: number | null;
  /** 扁平行 id，与 trays[].onTray 同步（一期兼容） */
  lines: string[];
  trays?: TraysInCabinetContent[];
  status?: ContentStatus;
  scheduleStatus?: ScheduleStatus;
  fillRate?: number;
  loadComplete?: boolean;
  editSource?: EditSource;
  taskId?: string | null;
  hidden?: boolean;
  demoSeed?: boolean;
  /** 当前校验存在 error 且曾以手工模式落盘 */
  manualViolation?: boolean;
  overrideNote?: string;
}

/** @deprecated 迁移别名 = CabinetContent */
export type FurnaceRun = CabinetContent;
/** @deprecated 迁移别名 = TraysInCabinetContent */
export type Layer = TraysInCabinetContent;
/** @deprecated 迁移别名 = StockLinesOnTray */
export type OnLayer = StockLinesOnTray;

export interface RuleFact {
  code: string;
  label: string;
  tone: FactTone;
  detail?: string;
}

export interface StockLineFacts {
  dueLabel: string;
  dueTone: DueTone;
  hasDesignatedCabinet: boolean;
  allowedCabinets: string[];
  facts: RuleFact[];
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface AeratePhase extends Interval {
  days: number;
  pending: boolean;
}

export interface Phases {
  preheat: Interval | null;
  sterilize: Interval;
  aerate: AeratePhase;
  bi: Interval;
}

export interface EntryLoad {
  furnaceId: string;
  cabinetId: string;
  seq: number;
  date: string;
  shift: Shift;
  process: string;
  customer: string;
  customers: string[];
  vol: number;
  boxes: number;
  lineIds: string[];
  lineNames: string[];
  pending: boolean;
  pendingNotes: string[];
  phases: Phases;
  conflict: boolean;
}

export interface ValidationIssue {
  sev: IssueSeverity;
  code: string;
  msg: string;
  furnaceId?: string;
  lineId?: string;
  cabinetId?: string;
  pendingFlag?: boolean;
  scheduleModeAtDetect?: ScheduleMode;
  blocking?: boolean;
}

export interface CycleConfig {
  preheatDays: number;
  sterilizeDays: number;
  biDays: number;
  nightSterilizeOffsetDays: number;
}

export interface LoadConfig {
  defaultMinM3: number;
  loadMetric: 'grossVolume' | 'effectiveVolume';
}

export interface BoxConfig {
  /** 大箱单箱体积阈值（m³），默认 0.12 */
  largeBoxVol: number;
  /** v1.3：每炉大箱箱数上限；只统计 boxVol ≥ largeBoxVol 的箱数合计 */
  maxBoxesWhenLarge: number;
  boardsPerFurnaceHint: number;
}

export interface EligibilityConfig {
  locations: string[];
  stockStatuses: string[];
}

export interface AppConfig {
  allowFiller: boolean;
  mixCustomerWarn: boolean;
  showPendingTags: boolean;
  /** 二期 A：自动排产拒绝 error 落盘；手工调整允许并标手工违例 */
  scheduleMode: ScheduleMode;
  /** 手工违例原因（建议填写，不阻断保存） */
  overrideNotes: Record<string, string>;
  /** 方案 v1.2 正式字段：按工艺覆盖最低拼载，如 `{ D002: 56 }` */
  minLoadM3ByProcess: Record<string, number>;
  /** 旧字段，读入迁移；写出时与 D002 同步，便于对照原型 */
  d002MinLoadM3?: number;
  cycle: CycleConfig;
  load: LoadConfig;
  box: BoxConfig;
  eligibility: EligibilityConfig;
  processMatch: { key: 'K' | 'N' | 'BOTH' };
  suggest: { strategy: string };
  export: { blockOnError: boolean };
  demo: { enableSeed: boolean };
  fp: { defaultHorizon: number };
  mix: { customer: 'warn' | 'forbid' | 'off' };
  /** 装柜率分母：默认柜额定装载，不用日产能 */
  fillRateDenom: 'ratedLoadM3' | 'dailyCapacityM3';
  grouping: {
    /** 自动组柜跳过已进其他柜（首版） */
    skipInOtherCabinet: boolean;
    defaultTrayCount: number;
  };
  /** 变更-3：组柜自动建议策略；缺省视为填满优先默认 */
  packSuggestPolicy: PackSuggestPolicy;
}

export type LegacyConfigInput = Partial<AppConfig> & {
  d002MinLoadM3?: number;
  minLoadM3ByProcess?: Record<string, number>;
  load?: Partial<LoadConfig> & { d002MinM3?: number };
};

export interface PlanSnapshot {
  version?: number;
  date: string;
  shift: Shift;
  /** 一期字段；与 contents 双写，读时优先 contents */
  furnaces: FurnaceRun[];
  contents?: CabinetContent[];
  tasks?: CabinetTask[];
  runtimes?: CabinetRuntime[];
  schedules?: FurnaceSchedule[];
  nextFurnaceSeq: number;
  nextTaskSeq?: number;
  virtualLines: StockLine[];
  config: LegacyConfigInput;
  planSeedVersion: number;
}

export interface RuleContext {
  cabinets: Cabinet[];
  processes: Process[];
  poolById: (id: string) => StockLine | undefined;
  config: AppConfig;
  sameShiftFurnaces: FurnaceRun[];
  /** 托盘主数据；缺省时跳过 TRAY_OVERFLOW */
  trayMaster?: Tray[];
  /** 全量组柜计划（含未排）；缺省回退 sameShiftFurnaces，用于 OnTray 剩余量 */
  allContents?: CabinetContent[];
  runtimes?: CabinetRuntime[];
}

export const PACK_POLICY_ERROR_CODES = {
  PACK_POLICY_EMPTY_DIM: 'PACK_POLICY_EMPTY_DIM',
  PACK_POLICY_UNKNOWN_DIM: 'PACK_POLICY_UNKNOWN_DIM',
  PACK_POLICY_DUP_DIM: 'PACK_POLICY_DUP_DIM',
  PACK_POLICY_BAD_FILL_RATE: 'PACK_POLICY_BAD_FILL_RATE',
  PACK_POLICY_BAD_DUE_WINDOW: 'PACK_POLICY_BAD_DUE_WINDOW',
  PACK_POLICY_BAD_FILL_MODE: 'PACK_POLICY_BAD_FILL_MODE',
} as const;

export type PackPolicyErrorCode = (typeof PACK_POLICY_ERROR_CODES)[keyof typeof PACK_POLICY_ERROR_CODES];

export const ISSUE_CODES = {
  CABINET_SCRAPPED: 'CABINET_SCRAPPED',
  CABINET_MISMATCH: 'CABINET_MISMATCH',
  BOX_LIMIT: 'BOX_LIMIT',
  D002_MIN: 'D002_MIN',
  TARGET_MIN: 'TARGET_MIN',
  MIX_CUSTOMER: 'MIX_CUSTOMER',
  OVER_CAP: 'OVER_CAP',
  OCCUPANCY: 'OCCUPANCY',
  STERILIZE_OVERLAP: 'STERILIZE_OVERLAP',
  PREHEAT_OVERLAP: 'PREHEAT_OVERLAP',
  CAB21: 'CAB21',
  PROC_PENDING: 'PROC_PENDING',
  STERILIZING_LOCKED: 'STERILIZING_LOCKED',
  REPACK_AFTER_LOAD_COMPLETE: 'REPACK_AFTER_LOAD_COMPLETE',
  ACTIVE_CONTENT: 'ACTIVE_CONTENT',
  ON_TRAY_QTY_OVERFLOW: 'ON_TRAY_QTY_OVERFLOW',
  TRAY_REQUIRED: 'TRAY_REQUIRED',
  TRAY_OVERFLOW: 'TRAY_OVERFLOW',
} as const;

export type IssueCode = (typeof ISSUE_CODES)[keyof typeof ISSUE_CODES];
