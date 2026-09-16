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

export interface Cabinet {
  id: string;
  base: Base;
  capacity: number;
  status: CabinetStatus;
  note?: string;
  tags: string[];
  pending?: boolean;
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

export interface FurnaceRun {
  id: string;
  cabinetId: string;
  date: string;
  shift: Shift;
  lines: string[];
  hidden?: boolean;
  demoSeed?: boolean;
  /** 当前校验存在 error 且曾以手工模式落盘 */
  manualViolation?: boolean;
}

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
  furnaces: FurnaceRun[];
  nextFurnaceSeq: number;
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
}

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
} as const;

export type IssueCode = (typeof ISSUE_CODES)[keyof typeof ISSUE_CODES];
