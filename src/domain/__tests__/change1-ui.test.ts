import { describe, expect, it } from 'vitest';
import {
  groupingHasShiftOrOnlineDateFilter,
  groupingLoadCompleteBannerHtml,
  groupingRuntimeTagsHtml,
  groupingToolbarContractHtml,
  placementChip,
  trayOverChip,
} from '../../ui/grouping-view';

describe('变更-1 组柜 UI 契约 (C1-11/19/22)', () => {
  it('C1-11/22: 组柜工具条无上线日期/入炉时间筛选，无白夜班切换', () => {
    const html = groupingToolbarContractHtml();
    expect(html).toContain('选柜');
    expect(html).toContain('选需求');
    expect(html).toContain('自动组柜');
    expect(html).toContain('手动组柜');
    expect(groupingHasShiftOrOnlineDateFilter(html)).toBe(false);
    expect(html).not.toContain('grpShiftTabs');
    expect(html).not.toMatch(/data-shift="白班"/);
    expect(html).not.toContain('id="grpOnlineDate"');
  });

  it('C1-19: 排入状态芯片文案', () => {
    expect(placementChip('inThisCabinet')).toContain('已进本柜');
    expect(placementChip('inOtherCabinet', '柜20')).toContain('已进其他柜');
    expect(placementChip('unassigned')).toContain('未排');
  });

  it('C1-28: 超托盘芯片在容积超限时可见', () => {
    expect(trayOverChip(21, 20)).toContain('超托盘');
    expect(trayOverChip(21, 20)).toContain('data-tray-over');
    expect(trayOverChip(20, 20)).toBe('');
    expect(trayOverChip(10, 20)).toBe('');
  });

  it('C1-31: 待入炉标签不当空闲；手工再拼红条文案', () => {
    expect(groupingRuntimeTagsHtml('loadComplete')).toContain('待入炉 · 不当空闲');
    expect(groupingRuntimeTagsHtml('loadComplete')).not.toContain('tag-default');
    expect(groupingRuntimeTagsHtml('loadComplete')).not.toMatch(/>空闲</);
    expect(groupingRuntimeTagsHtml('idle')).toContain('空闲');
    expect(groupingLoadCompleteBannerHtml('auto')).toMatch(/自动禁止再拼/);
    expect(groupingLoadCompleteBannerHtml('manual')).toMatch(/强预警/);
    expect(groupingLoadCompleteBannerHtml('manual')).toContain('REPACK_AFTER_LOAD_COMPLETE');
  });
});
