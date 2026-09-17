<script setup lang="ts">
import { computed, ref } from 'vue';
import { BOX_SPEC_CONCEPT_COUNT } from '../../data/seed-boxspecs';
import { effectiveMinLoadM3 } from '../../domain/min-load';
import MasterIoBar from '../components/master/MasterIoBar.vue';
import { usePlanStore } from '../stores/planStore';

const plan = usePlanStore();
const q = ref('');
const d002Min = computed(() => effectiveMinLoadM3('D002', plan.config, plan.masterProcesses));
const rows = computed(() => {
  const s = q.value.trim().toLowerCase();
  const list = plan.masterBoxSpecs;
  if (!s) return list;
  return list.filter((b) => [b.sku, b.id, b.name, b.note].join('|').toLowerCase().includes(s));
});
</script>

<template>
  <section id="page-boxspecs">
    <div class="toolbar">
      <input v-model="q" class="input search-input" placeholder="筛选物料号/品名" />
      <MasterIoBar entity="box_specs" :slice="rows" />
    </div>
    <div class="stat-row">
      <div class="stat-box"><div id="boxSpecConcept" class="num">{{ BOX_SPEC_CONCEPT_COUNT }}</div><div class="lbl">箱规种类（概念数）</div></div>
      <div class="stat-box"><div id="boxSpecSample" class="num">{{ rows.length }}</div><div class="lbl">本页样例</div></div>
    </div>
    <div id="boxRuleGrid" class="rule-grid">
      <div class="rule-card">
        <h4>大箱 单箱 ≥ {{ plan.config.box.largeBoxVol }} m³</h4>
        <p>只统计大箱箱数合计，上限 <strong>≤ {{ plan.config.box.maxBoxesWhenLarge }} 箱</strong>。炉总箱数不触发；超限须拆炉或减载。</p>
      </div>
      <div class="rule-card">
        <h4>D002 最低拼载</h4>
        <p>单炉体积目标 <strong>≥ {{ d002Min }} m³</strong>。不足时告警，建议与同工艺拼货。</p>
      </div>
      <div class="rule-card">
        <h4>其他工艺目标拼载</h4>
        <p>单炉体积目标 <strong>≥ {{ plan.config.load.defaultMinM3 }} m³</strong>。是否允许填充物补足见工作台开关。</p>
      </div>
      <div class="rule-card pending">
        <h4>~{{ plan.config.box.boardsPerFurnaceHint }} 板/炉 <span class="tag tag-pending">经验值·待确认</span></h4>
        <p>现场经验参考值，未纳入硬约束引擎；仅作排产提示。</p>
      </div>
    </div>
    <div class="card">
      <div class="card-header">箱规样例体积</div>
      <div class="card-body table-wrap" style="padding:0">
        <table class="data">
          <thead>
            <tr><th>物料号</th><th>品名</th><th>单箱体积</th><th>长×宽×高</th><th>规则提示</th></tr>
          </thead>
          <tbody id="boxSpecBody">
            <tr v-for="b in rows" :key="b.sku">
              <td class="mono">{{ b.sku }}</td>
              <td>{{ b.name }}</td>
              <td><strong>{{ b.vol }}</strong> m³</td>
              <td class="mono">{{ b.lengthMm || '—' }}×{{ b.widthMm || '—' }}×{{ b.heightMm || '—' }}</td>
              <td>
                <span v-if="b.vol >= plan.config.box.largeBoxVol" class="tag tag-orange">大箱合计 ≤{{ plan.config.box.maxBoxesWhenLarge }}箱/炉</span>
                <span v-else class="tag tag-green">常规</span>
                <span v-if="b.note" class="hint"> {{ b.note }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
