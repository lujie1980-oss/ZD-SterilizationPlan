<script setup lang="ts">
import { computed } from 'vue';
import type { StockLine } from '../../../domain/entities';
import { deriveFacts } from '../../../domain/facts';
import { PROCESSES } from '../../../data/seed-processes';
import { usePlanStore } from '../../stores/planStore';
import { useUiStore } from '../../stores/uiStore';

const props = defineProps<{ line: StockLine }>();
const plan = usePlanStore();
const ui = useUiStore();
const facts = computed(() => deriveFacts(props.line, PROCESSES, plan.config, plan.date));
const dueCls = computed(() =>
  facts.value.dueTone === 'overdue' ? 'due-overdue' : facts.value.dueTone === 'soon' ? 'due-soon' : 'due-ok',
);

function open(): void {
  ui.openFact(props.line.id);
}
</script>

<template>
  <div class="fact-strip" :data-fact-open="line.id" title="点击查看规则说明（只读事实，不代替校验中心）" @click.stop="open">
    <span class="fact-due" :class="dueCls">{{ facts.dueLabel }}</span>
    <button
      v-for="f in facts.facts"
      :key="f.code"
      type="button"
      class="fact-chip"
      :class="'fact-' + f.tone"
      :data-fact-open="line.id"
      :data-fact-code="f.code"
      @click.stop="open"
    >
      {{ f.label }}
    </button>
  </div>
</template>
