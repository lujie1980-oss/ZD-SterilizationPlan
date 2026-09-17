<script setup lang="ts">
import { computed } from 'vue';
import type { SortKeyCode } from '../../../domain/entities';
import {
  OPTIONAL_SORT_CODES,
  SORT_KEY_LABELS,
  formatEffectiveKeysPreview,
} from '../../../domain/schedule-sort-policy';
import { usePlanStore } from '../../stores/planStore';

const plan = usePlanStore();
const policy = computed(() => plan.sortPolicy);
const preview = computed(() => formatEffectiveKeysPreview(policy.value));
const visible = computed(() => policy.value.keys.filter((k) => k.code !== 'id'));

function isOptional(code: SortKeyCode): boolean {
  return (OPTIONAL_SORT_CODES as string[]).includes(code);
}
</script>

<template>
  <div id="fpSortPolicyPanel">
    <div class="grp-policy fp-sort-policy" data-testid="schedule-sort-policy">
      <div class="grp-policy-hd">
        <strong>排序策略</strong>
        <span class="hint">保存后下次甘特同步生效 · 不改写已有任务链</span>
      </div>
      <div class="fp-sort-preview" data-testid="sort-policy-preview">当前生效：<strong>{{ preview }}</strong></div>
      <div class="grp-policy-row">
        <span class="label">比较键</span>
        <ol class="grp-dim-list fp-sort-list">
          <li
            v-for="(k, i) in visible"
            :key="k.code + i"
            class="fp-sort-item"
            :class="{ 'is-off': isOptional(k.code) && !k.enabled }"
            :data-sort-index="i"
            :data-sort-code="k.code"
          >
            <span class="grp-dim-ord">{{ i + 1 }}</span>
            <span class="fp-sort-name">{{ SORT_KEY_LABELS[k.code] || k.code }}</span>
            <span class="hint mono">{{ k.code }}</span>
            <label v-if="isOptional(k.code)" class="fp-sort-enable">
              <input type="checkbox" :data-sort-enable="i" :checked="k.enabled" @change="plan.toggleSortEnable(i, ($event.target as HTMLInputElement).checked)" />
              启用
            </label>
            <span v-else class="hint">必选</span>
            <button class="btn btn-sm" type="button" :data-sort-dir="i" @click="plan.toggleSortDir(i)">{{ k.direction === 'asc' ? '升' : '降' }}</button>
            <button class="btn btn-sm" type="button" :data-sort-up="i" :disabled="i === 0" @click="plan.moveSortKey(i, -1)">上移</button>
            <button class="btn btn-sm" type="button" :data-sort-down="i" :disabled="i === visible.length - 1" @click="plan.moveSortKey(i, 1)">下移</button>
          </li>
        </ol>
      </div>
      <div class="grp-policy-row">
        <button id="btnSaveSortPolicy" class="btn btn-primary" type="button" @click="plan.saveSortPolicyFromDraft()">保存</button>
        <button id="btnRestoreSortPolicy" class="btn" type="button" @click="plan.restoreSortPolicyDefaults()">恢复默认</button>
        <span class="hint">未排 Content 靠后（date 空最后）</span>
      </div>
      <div class="grp-policy-iron" data-testid="sort-policy-iron">铁律（不可配掉）：按柜建链 · 不改交期 · 组柜不建 Task。系统末键 id 升序破平。</div>
    </div>
  </div>
</template>
