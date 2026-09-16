import { escapeHtml } from './dom';
import type { PackSuggestPolicy, RuntimeStatus, ScheduleMode } from '../domain/entities';
import { PACK_DIM_LABELS, PACK_PRESET_LABELS } from '../domain/pack-suggest-policy';

export function groupingToolbarContractHtml(opts?: { includeShift?: boolean; includeOnlineDate?: boolean }): string {
  const shift = opts?.includeShift
    ? `<div class="shift-tabs" id="grpShiftTabs"><div class="shift-tab">白班</div><div class="shift-tab">夜班</div></div>`
    : '';
  const date = opts?.includeOnlineDate
    ? `<label>上线日期<input type="date" id="grpOnlineDate" /></label>`
    : '';
  return `<div class="grp-toolbar" id="grpToolbar" data-testid="grouping-toolbar">
    <div class="shift-tabs" id="grpEntryTabs">
      <div class="shift-tab active" data-grp-entry="cabinet">选柜</div>
      <div class="shift-tab" data-grp-entry="demand">选需求</div>
    </div>
    <div class="shift-tabs" id="grpScheduleModeTabs">
      <div class="shift-tab active" data-mode="auto">自动排产</div>
      <div class="shift-tab" data-mode="manual">手工调整</div>
    </div>
    <button class="btn btn-primary" id="btnAutoPack" type="button">自动组柜</button>
    <button class="btn" id="btnManualPack" type="button">手动组柜</button>
    <button class="btn" id="btnLoadComplete" type="button">装填完毕</button>
    <span class="hint">组柜不按结果日或班次筛选 · 完成后未排</span>
    ${shift}${date}
  </div>`;
}

export function groupingPolicyPanelHtml(policy: PackSuggestPolicy): string {
  const fillPct = Math.round((policy.targetFillRate || 0) * 100);
  const dueOn = policy.dimensions.some((d) => d.code === 'dueCluster' && d.enabled);
  const preset = policy.preset || 'custom';
  const dims = policy.dimensions
    .map((d, i) => {
      const label = PACK_DIM_LABELS[d.code] || d.code;
      const on = d.enabled ? '开' : '关';
      return `<li class="grp-dim-item" data-dim-index="${i}">
        <span class="grp-dim-ord">${i + 1}</span>
        <span>${escapeHtml(label)}</span>
        <span class="hint">${on}</span>
        <button class="btn btn-sm" type="button" data-dim-up="${i}" ${i === 0 ? 'disabled' : ''}>上移</button>
        <button class="btn btn-sm" type="button" data-dim-down="${i}" ${i === policy.dimensions.length - 1 ? 'disabled' : ''}>下移</button>
      </li>`;
    })
    .join('');
  return `<div class="grp-policy" data-testid="pack-suggest-policy">
    <div class="grp-policy-hd">
      <strong>建议策略</strong>
      <span class="hint">保存后下次自动组柜生效 · 不改写已有载荷</span>
    </div>
    <div class="grp-policy-row">
      <label>预设
        <select class="select" id="grpPolicyPreset">
          <option value="fillFirst" ${preset === 'fillFirst' ? 'selected' : ''}>${PACK_PRESET_LABELS.fillFirst}</option>
          <option value="dueCluster" ${preset === 'dueCluster' ? 'selected' : ''}>${PACK_PRESET_LABELS.dueCluster}</option>
          <option value="balanced" ${preset === 'balanced' ? 'selected' : ''}>${PACK_PRESET_LABELS.balanced}</option>
          <option value="custom" ${preset === 'custom' ? 'selected' : ''}>${PACK_PRESET_LABELS.custom}</option>
        </select>
      </label>
      <div class="grp-policy-mode" role="radiogroup" aria-label="填满模式">
        <span class="label">填满模式</span>
        <label><input type="radio" name="grpFillMode" id="grpFillModeFill" value="fillOneFirst" ${policy.fillMode === 'fillOneFirst' ? 'checked' : ''} /> 先填满一台</label>
        <label><input type="radio" name="grpFillMode" id="grpFillModeBalance" value="balanceAcrossCabinets" ${policy.fillMode === 'balanceAcrossCabinets' ? 'checked' : ''} /> 多柜均衡</label>
      </div>
      <label>目标装柜率 <strong id="grpTargetFillLabel">${fillPct}%</strong>
        <input class="grp-policy-range" id="grpTargetFillRate" type="range" min="70" max="95" step="5" value="${fillPct}" />
      </label>
      <label class="grp-policy-due">
        <input type="checkbox" id="grpDueClusterEnabled" ${dueOn ? 'checked' : ''} /> 交期簇
        <span class="hint">窗口</span>
        <input class="input" id="grpDueWindowDays" type="number" min="1" max="14" step="1" value="${policy.dueWindowDays}" style="width:64px" />
        <span class="hint">天</span>
      </label>
    </div>
    <div class="grp-policy-row">
      <span class="label">维度优先级</span>
      <ol class="grp-dim-list">${dims}</ol>
      <button class="btn btn-primary" id="btnSavePackPolicy" type="button">保存策略</button>
      <button class="btn" id="btnRestorePackPolicy" type="button">恢复默认</button>
    </div>
    <div class="grp-policy-iron" data-testid="pack-policy-iron">硬约束（指定柜 / BOX_LIMIT 口径2 / 托盘 / 灭菌中 / 装填完毕）与双模式不可配掉；组柜不建任务。保存后下次自动组柜生效。</div>
  </div>`;
}

export function placementChip(placement: 'inThisCabinet' | 'inOtherCabinet' | 'unassigned', otherCabinetId?: string): string {
  if (placement === 'inThisCabinet') return `<span class="tag tag-green" data-placement="inThisCabinet">已进本柜</span>`;
  if (placement === 'inOtherCabinet') {
    return `<span class="tag tag-orange" data-placement="inOtherCabinet">已进其他柜${otherCabinetId ? escapeHtml(otherCabinetId) : ''}</span>`;
  }
  return `<span class="tag tag-default" data-placement="unassigned">未排</span>`;
}

export function groupingHasShiftOrOnlineDateFilter(html: string): boolean {
  if (/id="grpShiftTabs"|id="grpOnlineDate"/.test(html)) return true;
  if (/入炉时间/.test(html) && /<input/.test(html)) return true;
  if (/id="grpOnlineDate"|data-grp-online-date/.test(html)) return true;
  return false;
}

/** C1-28：分层示意超托盘芯片 */
export function trayOverChip(vol: number, capacityM3?: number): string {
  if (capacityM3 != null && capacityM3 > 0 && vol > capacityM3 + 1e-9) {
    return `<span class="tag tag-red" data-tray-over="true">超托盘</span>`;
  }
  return '';
}

/** C1-31：运行态标签；待入炉不得显示为空闲 */
export function groupingRuntimeTagsHtml(runtime: RuntimeStatus): string {
  if (runtime === 'sterilizing') {
    return `<span class="tag tag-red">灭菌中 · 禁用可见</span>`;
  }
  if (runtime === 'loadComplete') {
    return `<span class="tag tag-orange">装填完毕</span><span class="tag tag-orange" data-idle-guard="loadComplete">待入炉 · 不当空闲</span>`;
  }
  const label = runtime === 'idle' ? '空闲' : runtime === 'loading' ? '装填中' : runtime === 'outOfService' ? '停用' : runtime;
  return `<span class="tag tag-default">${label}</span>`;
}

export function groupingLoadCompleteBannerHtml(mode: ScheduleMode): string {
  if (mode === 'manual') {
    return '装填完毕待入炉：手工允许再拼，须强预警（红条 / 校验中心 REPACK_AFTER_LOAD_COMPLETE）。待入炉不当空闲。';
  }
  return '装填完毕待入炉：自动禁止再拼（拒绝落盘）。待入炉不当空闲。';
}
