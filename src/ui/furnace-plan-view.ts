import { escapeHtml } from './dom';
import type { ScheduleSortPolicy, SortKeyCode } from '../domain/entities';
import {
  OPTIONAL_SORT_CODES,
  SORT_KEY_LABELS,
  formatEffectiveKeysPreview,
} from '../domain/schedule-sort-policy';

function isOptional(code: SortKeyCode): boolean {
  return (OPTIONAL_SORT_CODES as string[]).includes(code);
}

export function furnaceSortPolicyPanelHtml(policy: ScheduleSortPolicy): string {
  const preview = formatEffectiveKeysPreview(policy);
  const visible = policy.keys.filter((k) => k.code !== 'id');
  const rows = visible
    .map((k, i) => {
      const label = SORT_KEY_LABELS[k.code] || k.code;
      const optional = isOptional(k.code);
      const enable = optional
        ? `<label class="fp-sort-enable"><input type="checkbox" data-sort-enable="${i}" ${k.enabled ? 'checked' : ''} /> 启用</label>`
        : `<span class="hint">必选</span>`;
      const dim = optional && !k.enabled ? ' is-off' : '';
      return `<li class="fp-sort-item${dim}" data-sort-index="${i}" data-sort-code="${escapeHtml(k.code)}">
        <span class="grp-dim-ord">${i + 1}</span>
        <span class="fp-sort-name">${escapeHtml(label)}</span>
        <span class="hint mono">${escapeHtml(k.code)}</span>
        ${enable}
        <button class="btn btn-sm" type="button" data-sort-dir="${i}">${k.direction === 'asc' ? '升' : '降'}</button>
        <button class="btn btn-sm" type="button" data-sort-up="${i}" ${i === 0 ? 'disabled' : ''}>上移</button>
        <button class="btn btn-sm" type="button" data-sort-down="${i}" ${i === visible.length - 1 ? 'disabled' : ''}>下移</button>
      </li>`;
    })
    .join('');
  return `<div class="grp-policy fp-sort-policy" data-testid="schedule-sort-policy">
    <div class="grp-policy-hd">
      <strong>排序策略</strong>
      <span class="hint">保存后下次甘特同步生效 · 不改写已有任务链</span>
    </div>
    <div class="fp-sort-preview" data-testid="sort-policy-preview">当前生效：<strong>${escapeHtml(preview)}</strong></div>
    <div class="grp-policy-row">
      <span class="label">比较键</span>
      <ol class="grp-dim-list fp-sort-list">${rows}</ol>
    </div>
    <div class="grp-policy-row">
      <button class="btn btn-primary" id="btnSaveSortPolicy" type="button">保存</button>
      <button class="btn" id="btnRestoreSortPolicy" type="button">恢复默认</button>
      <span class="hint">未排 Content 靠后（date 空最后）</span>
    </div>
    <div class="grp-policy-iron" data-testid="sort-policy-iron">铁律（不可配掉）：按柜建链 · 不改交期 · 组柜不建 Task。系统末键 id 升序破平。</div>
  </div>`;
}
