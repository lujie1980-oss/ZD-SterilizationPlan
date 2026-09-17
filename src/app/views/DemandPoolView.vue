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

function specOf(p: { dimL?: number; dimW?: number; dimH?: number }): string {
  return `${p.dimL ?? '—'}×${p.dimW ?? '—'}×${p.dimH ?? '—'}`;
}

function statusLabel(status: string): string {
  return status === 'placed' ? '已入柜' : '未组柜';
}
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
        <span>待排产需求确认 · 确认后自动一箱一单元分拆为计划单元</span>
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
              <th>计划单元</th>
            </tr>
          </thead>
          <tbody id="fullPoolBody">
            <template v-for="p in eligible" :key="p.id">
              <tr :data-demand-row="p.id">
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
                <td class="mono">{{ specOf(p) }}</td>
                <td>{{ p.boxes }}</td>
                <td>{{ p.boxVol }}</td>
                <td><strong>{{ p.vol }}</strong></td>
                <td>{{ p.batch }}</td>
                <td>{{ p.loc }}</td>
                <td>{{ p.stockStatus }}</td>
                <td>{{ p.process }}</td>
                <td>{{ p.allowed.join(', ') }}</td>
                <td class="pu-actions">
                  <div class="pu-action-row">
                    <button
                      v-if="!plan.creationOfDemand(p.id) || plan.creationOfDemand(p.id)?.status === 'stale'"
                      class="btn btn-primary btn-sm"
                      type="button"
                      :data-confirm-demand="p.id"
                      @click="plan.confirmDemand(p.id)"
                    >确认</button>
                    <span v-else class="tag tag-green">已确认</span>
                    <button
                      v-if="plan.creationOfDemand(p.id)"
                      class="btn btn-sm"
                      type="button"
                      :data-rerun-split="p.id"
                      :class="{ 'btn-warn': plan.creationOfDemand(p.id)?.status === 'stale' }"
                      @click="plan.rerunDemandSplit(p.id)"
                    >重跑分拆</button>
                    <button
                      v-if="plan.unitsOfDemand(p.id).length"
                      class="btn btn-sm"
                      type="button"
                      :data-toggle-units="p.id"
                      @click="plan.toggleDemandExpand(p.id)"
                    >{{ plan.grpExpandedDemandIds.includes(p.id) ? '收起单元' : `展开 ${plan.unitsOfDemand(p.id).length} 单元` }}</button>
                  </div>
                  <div v-if="plan.creationOfDemand(p.id)?.status === 'stale'" class="hint pu-stale">箱数已变，请重跑分拆</div>
                </td>
              </tr>
              <tr v-if="plan.grpExpandedDemandIds.includes(p.id) && plan.unitsOfDemand(p.id).length" :data-plan-units="p.id">
                <td :colspan="21" class="pu-embed">
                  <table class="data pu-table">
                    <thead>
                      <tr>
                        <th>单元号</th><th>序号</th><th>体积</th><th>规格</th><th>销售订单</th><th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="u in plan.unitsOfDemand(p.id)" :key="u.id" :data-plan-unit="u.id">
                        <td class="mono">{{ u.id }}</td>
                        <td>{{ u.boxSeq }}</td>
                        <td>{{ u.vol }}</td>
                        <td class="mono">{{ specOf(u) }}</td>
                        <td class="mono">{{ u.salesOrderNo || p.salesOrderNo || p.wo }}</td>
                        <td>
                          <span class="tag" :class="u.status === 'placed' ? 'tag-green' : 'tag-default'">{{ statusLabel(u.status) }}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
