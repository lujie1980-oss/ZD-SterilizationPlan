import { escapeHtml } from './dom';
import type { RuntimeStatus, ScheduleMode } from '../domain/entities';

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
    return '装填完毕待入炉：手工允许再拼，须强预警（红条 / 校验中心 LOAD_COMPLETE_BLOCK）。待入炉不当空闲。';
  }
  return '装填完毕待入炉：自动禁止再拼（拒绝落盘）。待入炉不当空闲。';
}
