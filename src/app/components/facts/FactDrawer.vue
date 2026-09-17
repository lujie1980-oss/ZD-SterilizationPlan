<script setup lang="ts">
import { computed } from 'vue';
import { deriveFacts } from '../../../domain/facts';
import { PROCESSES } from '../../../data/seed-processes';
import { usePlanStore } from '../../stores/planStore';
import { useUiStore } from '../../stores/uiStore';

const plan = usePlanStore();
const ui = useUiStore();
const line = computed(() => (ui.factLineId ? plan.poolById(ui.factLineId) : undefined));
const facts = computed(() =>
  line.value ? deriveFacts(line.value, PROCESSES, plan.config, plan.date) : null,
);
const proc = computed(() => (line.value ? PROCESSES.find((p) => p.code === line.value!.process) : undefined));
</script>

<template>
  <div v-show="ui.factLineId" id="factDrawerMask" class="drawer-mask" @click.self="ui.closeFact()">
    <aside v-if="line && facts" id="factDrawer" class="drawer" role="dialog" aria-labelledby="factDrawerTitle">
      <div class="drawer-hd">
        <span id="factDrawerTitle">规则事实 · {{ line.id }}</span>
        <button id="factDrawerClose" class="modal-close" type="button" @click="ui.closeFact()">×</button>
      </div>
      <div id="factDrawerBody" class="drawer-bd">
        <p>以下为待排行只读事实，<strong>不代替校验中心</strong>。点击芯片仅打开说明。</p>
        <h4>交期</h4>
        <p>{{ facts.dueLabel }}（相对工作台日期 {{ plan.date }}）</p>
        <h4>指定柜</h4>
        <p>{{ facts.hasDesignatedCabinet ? `是 · ${facts.allowedCabinets.join('、')}` : '否 · 未指定柜' }}</p>
        <p v-if="proc" class="hint">
          工艺 {{ proc.code }} {{ proc.name }} 主数据允许柜：{{ proc.cabinets.join('、') }}
        </p>
        <h4>适用规则芯片</h4>
        <div v-for="f in facts.facts" :key="f.code" class="fact-detail-row">
          <span class="fact-chip" :class="'fact-' + f.tone">{{ f.label }}</span>
          <p>{{ f.detail || f.code }}</p>
        </div>
        <p class="hint">硬约束以校验中心 / 提交闸门为准。自动排产拒绝 error 落盘；手工调整可保存并标「手工违例」。</p>
      </div>
    </aside>
  </div>
</template>
