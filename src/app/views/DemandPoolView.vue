<script setup lang="ts">
import { computed } from 'vue';
import FactStrip from '../components/facts/FactStrip.vue';
import { usePlanStore } from '../stores/planStore';

const plan = usePlanStore();
const eligible = computed(() =>
  plan.pool.filter(
    (p) => !p.splitOf && p.stockStatus === '非限制' && plan.config.eligibility.locations.includes(p.loc),
  ),
);
const totalVol = computed(() => eligible.value.reduce((s, p) => s + p.vol, 0).toFixed(1));
const urgent = computed(() => eligible.value.filter((p) => p.urgent).length);
</script>

<template>
  <section id="page-demand" class="page active">
    <div class="stat-row">
      <div class="stat-box"><div id="poolStatTotal" class="num">{{ eligible.length }}</div><div class="lbl">待排行数</div></div>
      <div class="stat-box"><div id="poolStatVol" class="num">{{ totalVol }}</div><div class="lbl">合计体积 m³</div></div>
      <div class="stat-box"><div id="poolStatUrgent" class="num">{{ urgent }}</div><div class="lbl">加急行</div></div>
    </div>
    <div class="card" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
      <div class="card-header">
        <span>待排产需求确认 · 演示数据（模拟合格待灭菌库存）</span>
        <span class="tag tag-pending">可排条件待确认 · 非限制 ∧ 待灭菌仓 ∧ EO</span>
      </div>
      <div class="card-body table-wrap" style="padding:0;flex:1;overflow:auto">
        <table class="data">
          <thead>
            <tr>
              <th>行号</th><th>销售订单</th><th>工厂</th><th>车间</th><th>物料</th><th>REF</th><th>品名</th>
              <th>事实</th>
              <th>客户号</th><th>交期</th><th>工单</th><th>规格L×W×H</th><th>箱数</th><th>单箱体积</th><th>体积</th>
              <th>生产批号</th><th>库存地点</th><th>库存状态</th><th>工艺</th><th>允许柜</th>
            </tr>
          </thead>
          <tbody id="fullPoolBody">
            <tr v-for="p in eligible" :key="p.id">
              <td class="mono">{{ p.id }}</td>
              <td class="mono">{{ p.salesOrderNo || p.wo }}</td>
              <td>{{ p.factory }}</td>
              <td>{{ p.workshop }}</td>
              <td>{{ p.matType }}</td>
              <td class="mono">{{ p.ref }}</td>
              <td>
                {{ p.name }}
                <span v-if="p.urgent" class="tag tag-urgent">加急</span>
                <span v-if="p.suggest" class="tag tag-purple">{{ p.suggest }}</span>
                <span v-if="p.useCab21 && plan.config.showPendingTags" class="tag tag-pending">含柜21</span>
              </td>
              <td class="facts-cell"><FactStrip :line="p" /></td>
              <td>{{ p.customer }}</td>
              <td>{{ p.due }}</td>
              <td class="mono">{{ p.wo }}</td>
              <td class="mono">{{ p.dimL ?? '—' }}×{{ p.dimW ?? '—' }}×{{ p.dimH ?? '—' }}</td>
              <td>{{ p.boxes }}</td>
              <td>{{ p.boxVol }}</td>
              <td><strong>{{ p.vol }}</strong></td>
              <td>{{ p.batch }}</td>
              <td>{{ p.loc }}</td>
              <td>{{ p.stockStatus }}</td>
              <td>{{ p.process }}</td>
              <td>{{ p.allowed.join(', ') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
