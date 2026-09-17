<script setup lang="ts">
import { computed, ref } from 'vue';
import MasterIoBar from '../components/master/MasterIoBar.vue';
import { usePlanStore } from '../stores/planStore';

const plan = usePlanStore();
const q = ref('');
const rows = computed(() => {
  const s = q.value.trim().toLowerCase();
  const list = plan.masterProcesses;
  if (!s) return list;
  return list.filter((p) => [p.code, p.name, p.cabinets.join('|'), p.note].join('|').toLowerCase().includes(s));
});
</script>

<template>
  <section id="page-processes">
    <div class="toolbar">
      <input v-model="q" class="input search-input" placeholder="筛选工艺代码/名称" />
      <MasterIoBar entity="processes" :slice="rows" />
    </div>
    <div class="card">
      <div class="card-header">
        <span>工艺与指定柜</span>
        <span class="tag tag-pending">亚澳 / EO通用 规则待确认</span>
      </div>
      <div class="card-body table-wrap" style="padding:0">
        <table class="data">
          <thead>
            <tr><th>工艺代码</th><th>名称</th><th>允许灭菌柜</th><th>解析天数</th><th>说明</th></tr>
          </thead>
          <tbody id="procBody">
            <tr v-for="p in rows" :key="p.code">
              <td><strong>{{ p.code }}</strong> <span v-if="p.pending" class="tag tag-pending">待确认</span></td>
              <td>{{ p.name }}</td>
              <td><span v-for="c in p.cabinets" :key="c" class="tag tag-default">{{ c }}</span></td>
              <td>{{ p.aerateDays }}d <span v-if="!p.aerateConfirmed" class="tag tag-pending">解析待确认</span></td>
              <td>{{ p.note || '—' }} <span v-if="p.pending" class="tag tag-pending">规则待确认</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
