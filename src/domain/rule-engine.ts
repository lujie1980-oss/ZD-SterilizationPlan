import { processMinLoad } from '../data/seed-processes';
import type { FurnaceRun, RuleContext, ValidationIssue } from './entities';
import { ISSUE_CODES } from './entities';
import { furnaceBoxes, furnaceCustomers, furnaceVol } from './pool';

export function canAddFurnace(cabinetId: string, ctx: RuleContext): { ok: true } | { ok: false; issue: ValidationIssue } {
  const cab = ctx.cabinets.find((c) => c.id === cabinetId);
  if (!cab || cab.status === '报废') {
    return {
      ok: false,
      issue: {
        sev: 'error',
        code: ISSUE_CODES.CABINET_SCRAPPED,
        msg: `${cabinetId} 已报废，不可添加炉次`,
        cabinetId,
      },
    };
  }
  return { ok: true };
}

export function validateFurnace(f: FurnaceRun, ctx: RuleContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = f.lines.map((id) => ctx.poolById(id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
  if (!lines.length) return issues;

  const cab = ctx.cabinets.find((c) => c.id === f.cabinetId);
  if (cab?.status === '报废') {
    issues.push({
      sev: 'error',
      code: ISSUE_CODES.CABINET_SCRAPPED,
      msg: `${f.cabinetId} 已报废，不可装炉`,
      furnaceId: f.id,
      cabinetId: f.cabinetId,
    });
  }

  const vol = furnaceVol(f, ctx.poolById);
  const boxes = furnaceBoxes(f, ctx.poolById);
  const processes = [...new Set(lines.map((l) => l.process))];
  const primaryProcess = processes[0]!;

  for (const l of lines) {
    if (!l.allowed.includes(f.cabinetId)) {
      issues.push({
        sev: 'error',
        code: ISSUE_CODES.CABINET_MISMATCH,
        msg: `工艺指定柜不符：${l.name}（${l.process}）不允许 ${f.cabinetId}`,
        furnaceId: f.id,
        lineId: l.id,
      });
    }
  }

  const { largeBoxVol, maxBoxesWhenLarge } = ctx.config.box;
  const hasLargeBox = lines.some((l) => l.boxVol >= largeBoxVol);
  if (hasLargeBox && boxes > maxBoxesWhenLarge) {
    issues.push({
      sev: 'error',
      code: ISSUE_CODES.BOX_LIMIT,
      msg: `单箱体积≥${largeBoxVol} 时每炉箱数不得超过 ${maxBoxesWhenLarge}（当前 ${boxes} 箱）`,
      furnaceId: f.id,
    });
  }

  const min = processMinLoad(
    primaryProcess,
    ctx.config.load.d002MinM3,
    ctx.config.load.defaultMinM3,
    ctx.processes,
  );

  if (primaryProcess === 'D002' && vol < min) {
    issues.push({
      sev: 'warning',
      code: ISSUE_CODES.D002_MIN,
      msg: `低于 D002 最低拼载 ${min}m³（当前 ${vol.toFixed(1)}m³）`,
      furnaceId: f.id,
      pendingFlag: true,
    });
  } else if (primaryProcess !== 'D002' && vol > 0 && vol < min) {
    const fillerNote = ctx.config.allowFiller ? '（已开启填充物开关）' : '（待确认：是否允许填充物）';
    issues.push({
      sev: 'warning',
      code: ISSUE_CODES.TARGET_MIN,
      msg: `低于目标拼载 ${min}m³（当前 ${vol.toFixed(1)}m³）${fillerNote}`,
      furnaceId: f.id,
      pendingFlag: true,
    });
  }

  if (f.cabinetId === '柜21' || cab?.pending) {
    issues.push({
      sev: 'info',
      code: ISSUE_CODES.CAB21,
      msg: '柜21主数据待确认',
      furnaceId: f.id,
      cabinetId: f.cabinetId,
      pendingFlag: true,
    });
  }

  const mixOn = ctx.config.mixCustomerWarn && ctx.config.mix.customer !== 'off';
  const customers = furnaceCustomers(f, ctx.poolById);
  if (mixOn && customers.length > 1) {
    issues.push({
      sev: ctx.config.mix.customer === 'forbid' ? 'error' : 'warning',
      code: ISSUE_CODES.MIX_CUSTOMER,
      msg: `混炉规则待确认：本炉含 ${customers.length} 个客户（${customers.join('、')}）`,
      furnaceId: f.id,
      pendingFlag: true,
    });
  }

  if (cab && vol > cab.capacity) {
    issues.push({
      sev: 'warning',
      code: ISSUE_CODES.OVER_CAP,
      msg: `${f.cabinetId} 日产能约 ${cab.capacity}m³，本炉已装 ${vol.toFixed(1)}m³，超出产能`,
      furnaceId: f.id,
      cabinetId: f.cabinetId,
    });
  }

  const sameCab = ctx.sameShiftFurnaces.filter((x) => x.cabinetId === f.cabinetId && !x.hidden);
  if (sameCab.length > 1 && cab) {
    const totalVol = sameCab.reduce((s, x) => s + furnaceVol(x, ctx.poolById), 0);
    if (totalVol > cab.capacity) {
      issues.push({
        sev: 'warning',
        code: ISSUE_CODES.OCCUPANCY,
        msg: `${f.cabinetId} 本班次多炉合计 ${totalVol.toFixed(1)}m³ 超日产能 ${cab.capacity}m³`,
        furnaceId: f.id,
        cabinetId: f.cabinetId,
      });
    }
  }

  const proc = ctx.processes.find((p) => p.code === primaryProcess);
  if (proc?.pending) {
    issues.push({
      sev: 'info',
      code: ISSUE_CODES.PROC_PENDING,
      msg: `工艺「${primaryProcess}」指定柜规则待确认`,
      furnaceId: f.id,
      pendingFlag: true,
    });
  }

  return issues;
}

export function validateAll(furnaces: FurnaceRun[], ctx: RuleContext): ValidationIssue[] {
  const all: ValidationIssue[] = [];
  furnaces.filter((f) => !f.hidden).forEach((f) => {
    validateFurnace(f, ctx).forEach((i) => all.push(i));
  });
  return all;
}

export function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
  return issues.slice().sort((a, b) => (order[a.sev] ?? 9) - (order[b.sev] ?? 9));
}
