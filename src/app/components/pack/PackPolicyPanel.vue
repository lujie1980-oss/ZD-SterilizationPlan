<script setup lang="ts">
import { computed } from 'vue';
import { PACK_DIM_LABELS, PACK_PRESET_LABELS } from '../../../domain/pack-suggest-policy';
import { usePlanStore } from '../../stores/planStore';

const plan = usePlanStore();
const policy = computed(() => plan.packPolicy);
const fillPct = computed(() => Math.round((policy.value.targetFillRate || 0) * 100));
const dueOn = computed(() => policy.value.dimensions.some((d) => d.code === 'dueCluster' && d.enabled));
const preset = computed(() => policy.value.preset || 'custom');
</script>

<template>
  <div id="grpPolicyPanel">
    <div class="grp-policy" data-testid="pack-suggest-policy">
      <div class="grp-policy-hd">
        <strong>建议策略</strong>
        <span class="hint">保存后下次自动组柜生效 · 不改写已有载荷</span>
      </div>
      <div class="grp-policy-row">
        <label>预设
          <select id="grpPolicyPreset" class="select" :value="preset" @change="plan.applyPackPreset(($event.target as HTMLSelectElement).value)">
            <option value="fillFirst">{{ PACK_PRESET_LABELS.fillFirst }}</option>
            <option value="dueCluster">{{ PACK_PRESET_LABELS.dueCluster }}</option>
            <option value="balanced">{{ PACK_PRESET_LABELS.balanced }}</option>
            <option value="custom">{{ PACK_PRESET_LABELS.custom }}</option>
          </select>
        </label>
        <div class="grp-policy-mode" role="radiogroup" aria-label="填满模式">
          <span class="label">填满模式</span>
          <label>
            <input id="grpFillModeFill" type="radio" name="grpFillMode" value="fillOneFirst" :checked="policy.fillMode === 'fillOneFirst'" @change="plan.setFillMode('fillOneFirst')" />
            先填满一台
          </label>
          <label>
            <input id="grpFillModeBalance" type="radio" name="grpFillMode" value="balanceAcrossCabinets" :checked="policy.fillMode === 'balanceAcrossCabinets'" @change="plan.setFillMode('balanceAcrossCabinets')" />
            多柜均衡
          </label>
        </div>
        <label>目标装柜率 <strong id="grpTargetFillLabel">{{ fillPct }}%</strong>
          <input id="grpTargetFillRate" class="grp-policy-range" type="range" min="70" max="95" step="5" :value="fillPct" @input="plan.setTargetFillRatePct(Number(($event.target as HTMLInputElement).value))" />
        </label>
        <label class="grp-policy-due">
          <input id="grpDueClusterEnabled" type="checkbox" :checked="dueOn" @change="plan.setDueClusterEnabled(($event.target as HTMLInputElement).checked)" />
          交期簇
          <span class="hint">窗口</span>
          <input id="grpDueWindowDays" class="input" type="number" min="1" max="14" step="1" :value="policy.dueWindowDays" style="width:64px" @change="plan.setDueWindowDays(Number(($event.target as HTMLInputElement).value))" />
          <span class="hint">天</span>
        </label>
      </div>
      <div class="grp-policy-row">
        <span class="label">维度优先级</span>
        <ol class="grp-dim-list">
          <li v-for="(d, i) in policy.dimensions" :key="d.code + i" class="grp-dim-item" :data-dim-index="i">
            <span class="grp-dim-ord">{{ i + 1 }}</span>
            <span>{{ PACK_DIM_LABELS[d.code] || d.code }}</span>
            <span class="hint">{{ d.enabled ? '开' : '关' }}</span>
            <button class="btn btn-sm" type="button" :data-dim-up="i" :disabled="i === 0" @click="plan.movePackDim(i, -1)">上移</button>
            <button class="btn btn-sm" type="button" :data-dim-down="i" :disabled="i === policy.dimensions.length - 1" @click="plan.movePackDim(i, 1)">下移</button>
          </li>
        </ol>
        <button id="btnSavePackPolicy" class="btn btn-primary" type="button" @click="plan.savePackPolicyFromDraft()">保存策略</button>
        <button id="btnRestorePackPolicy" class="btn" type="button" @click="plan.restorePackPolicyDefaults()">恢复默认</button>
      </div>
      <div class="grp-policy-iron" data-testid="pack-policy-iron">硬约束（指定柜 / BOX_LIMIT 口径2 / 托盘 / 灭菌中 / 装填完毕）与双模式不可配掉；组柜不建任务。保存后下次自动组柜生效。</div>
    </div>
  </div>
</template>
