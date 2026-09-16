import {
  isTrayOver,
  occupiedBoxesOf,
  occupiedVolOf,
  onTrayShareOf,
  trayCapacityM3,
} from './cabinet-content';
import { effectiveMinLoadM3 } from './min-load';
import type { FurnaceRun, RuleContext, ValidationIssue } from './entities';
import { ISSUE_CODES } from './entities';
import { furnaceCustomers, furnaceVol, largeBoxCount } from './pool';

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
  // v1.3 / 口径 2：只统计大箱箱数合计，炉总箱数不触发 BOX_LIMIT
  const largeBoxes = largeBoxCount(lines, largeBoxVol);
  if (largeBoxes > maxBoxesWhenLarge) {
    issues.push({
      sev: 'error',
      code: ISSUE_CODES.BOX_LIMIT,
      msg: `大箱（单箱≥${largeBoxVol}m³）合计 ${largeBoxes} 箱，超过每炉上限 ${maxBoxesWhenLarge}`,
      furnaceId: f.id,
    });
  }

  const min = effectiveMinLoadM3(primaryProcess, ctx.config, ctx.processes);

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

  const loadCompleteRuntime = ctx.runtimes?.find((r) => r.cabinetId === f.cabinetId)?.status === 'loadComplete';
  if (f.loadComplete || loadCompleteRuntime) {
    issues.push({
      sev: 'error',
      code: ISSUE_CODES.REPACK_AFTER_LOAD_COMPLETE,
      msg: `${f.cabinetId} 装填完毕待入炉：自动禁止再拼（拒绝落盘）；手工再拼须强预警。待入炉不当空闲`,
      furnaceId: f.id,
      cabinetId: f.cabinetId,
    });
  }

  if (f.trays?.length && ctx.trayMaster?.length) {
    for (const tray of f.trays) {
      const md = ctx.trayMaster.find((t) => t.id === tray.trayId);
      const cap = trayCapacityM3(md);
      if (isTrayOver(tray.vol, cap)) {
        issues.push({
          sev: 'error',
          code: ISSUE_CODES.TRAY_OVERFLOW,
          msg: `${md?.displayName || tray.trayId} 超托盘：已装 ${tray.vol.toFixed(1)}m³ > 托盘容积 ${cap}m³`,
          furnaceId: f.id,
          cabinetId: f.cabinetId,
        });
      }
    }
  }

  const peers = (ctx.allContents ?? ctx.sameShiftFurnaces).filter((c) => !c.hidden);
  if (f.trays?.length) {
    const seen = new Set<string>();
    for (const tray of f.trays) {
      for (const row of tray.onTray || []) {
        if (!row.stockLineId || seen.has(row.stockLineId)) continue;
        seen.add(row.stockLineId);
        const line = ctx.poolById(row.stockLineId);
        if (!line) continue;
        const share = onTrayShareOf(f, line.id);
        const otherBoxes = occupiedBoxesOf(line, peers, f.id);
        const otherVol = occupiedVolOf(line, peers, f.id);
        const usedBoxes = share.boxes + otherBoxes;
        const usedVol = share.vol + otherVol;
        if (usedBoxes > line.boxes || usedVol > line.vol + 1e-6) {
          issues.push({
            sev: 'error',
            code: ISSUE_CODES.ON_TRAY_QTY_OVERFLOW,
            msg: `${line.id} OnTray 分量超量：箱 ${share.boxes}+已占用${otherBoxes}/${line.boxes}，体积 ${share.vol.toFixed(1)}+已占用${otherVol.toFixed(1)}/${line.vol}`,
            furnaceId: f.id,
            lineId: line.id,
            cabinetId: f.cabinetId,
          });
        }
      }
    }
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
