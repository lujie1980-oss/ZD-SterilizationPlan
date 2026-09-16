import { escapeHtml } from './dom';

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
