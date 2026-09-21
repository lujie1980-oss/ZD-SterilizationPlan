<script setup lang="ts">
import { computed, ref } from 'vue';
import MasterIoBar from '../components/master/MasterIoBar.vue';
import { usePlanStore } from '../stores/planStore';

const plan = usePlanStore();
const q = ref('');
const rows = computed(() => {
  const s = q.value.trim().toLowerCase();
  const list = plan.masterTrays;
  if (!s) return list;
  return list.filter((t) => [t.id, t.cabinetId, t.displayName, t.note].join('|').toLowerCase().includes(s));
});
</script>

<template>
  <section id="page-trays">
    <div class="toolbar">
      <input v-model="q" class="input search-input" placeholder="筛选托盘/柜" />
      <MasterIoBar entity="trays" :slice="rows" />
    </div>
    <div class="card">
      <div class="card-header">
        <span>托盘主数据</span>
        <span class="hint">cabinetId 必须指向已有柜（MD_FK_CABINET）· 同柜层号唯一</span>
      </div>
      <div class="card-body table-wrap" style="padding:0">
        <table class="data">
          <thead>
            <tr>
              <th>托盘 ID</th><th>所属柜</th><th>层号</th><th>名称</th><th>容积 m³</th><th>状态</th><th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in rows" :key="t.id">
              <td class="mono">{{ t.id }}</td>
              <td>{{ t.cabinetId }}</td>
              <td>{{ t.level }}</td>
              <td>{{ t.displayName || '—' }}</td>
              <td>{{ t.capacityM3 ?? t.ratedLoadM3 ?? '—' }}</td>
              <td>
                <span v-if="t.status === '可用'" class="tag tag-green">可用</span>
                <span v-else class="tag tag-default">停用</span>
              </td>
              <td>{{ t.note || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
