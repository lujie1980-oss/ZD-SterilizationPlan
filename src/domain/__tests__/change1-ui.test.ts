import { describe, expect, it } from 'vitest';
import {
  groupingHasShiftOrOnlineDateFilter,
  groupingLoadCompleteBannerHtml,
  groupingPolicyPanelHtml,
  groupingRuntimeTagsHtml,
  groupingToolbarContractHtml,
  placementChip,
  trayOverChip,
} from '../../app/components/pack/grouping-contract';

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

describe('变更-3 建议策略面板 UI', () => {
  it('面板含预设/填满模式/目标装柜率/交期簇/保存/恢复默认/铁律提示', () => {
    const html = groupingPolicyPanelHtml({
      id: 'default',
      name: '填满优先（默认）',
      version: 1,
      preset: 'fillFirst',
      fillMode: 'fillOneFirst',
      targetFillRate: 0.8,
      dueWindowDays: 3,
      dimensions: [
        { code: 'gapMin', enabled: true },
        { code: 'targetFill', enabled: true },
        { code: 'dueCluster', enabled: false },
      ],
      applyMode: 'nextAutoPackOnly',
      updatedAt: '',
    });
    expect(html).toContain('建议策略');
    expect(html).toContain('填满优先');
    expect(html).toContain('交期簇优先');
    expect(html).toContain('多柜均衡');
    expect(html).toContain('先填满一台');
    expect(html).toContain('多柜均衡');
    expect(html).toContain('目标装柜率');
    expect(html).toContain('80%');
    expect(html).toContain('交期簇');
    expect(html).toContain('保存策略');
    expect(html).toContain('恢复默认');
    expect(html).toContain('硬约束');
    expect(html).toContain('下次自动组柜');
    expect(html).toContain('data-testid="pack-suggest-policy"');
  });
});
