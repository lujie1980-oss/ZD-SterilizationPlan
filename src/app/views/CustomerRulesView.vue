<script setup lang="ts">
import { computed, ref } from 'vue';
import MasterIoBar from '../components/master/MasterIoBar.vue';
import { usePlanStore } from '../stores/planStore';

const plan = usePlanStore();
const q = ref('');
const rows = computed(() => {
  const s = q.value.trim().toLowerCase();
  const list = plan.masterCustomerRules;
  if (!s) return list;
  return list.filter((r) => [r.customerId, r.designatedCabinets.join('|'), r.note].join('|').toLowerCase().includes(s));
});
</script>

<template>
  <section id="page-customer-rules">
    <div class="toolbar">
      <input v-model="q" class="input search-input" placeholder="筛选客户" />
      <MasterIoBar entity="customer_rules" :allow-import="false" :slice="rows" />
    </div>
    <div class="card">
      <div class="card-header">
        <span>客户规则</span>
        <span class="hint">首版仅导出 · 导入为 P1</span>
      </div>
      <div class="card-body table-wrap" style="padding:0">
        <table class="data">
          <thead>
            <tr><th>客户</th><th>指定柜</th><th>混炉策略</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.customerId">
              <td><strong>{{ r.customerId }}</strong></td>
              <td>
                <span v-for="c in r.designatedCabinets" :key="c" class="tag tag-default">{{ c }}</span>
              </td>
              <td>{{ r.mixPolicy }}</td>
              <td>{{ r.note || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
