<script setup lang="ts">
import { computed, ref } from 'vue';
import MasterIoBar from '../components/master/MasterIoBar.vue';
import { usePlanStore } from '../stores/planStore';

const plan = usePlanStore();
const q = ref('');
const rows = computed(() => {
  const s = q.value.trim().toLowerCase();
  const list = plan.masterCabinets;
  if (!s) return list;
  return list.filter((c) => [c.id, c.canonicalId, c.displayCode, c.note, c.tags.join('|')].join('|').toLowerCase().includes(s));
});
</script>

<template>
  <section id="page-cabinets">
    <div class="toolbar">
      <input v-model="q" class="input search-input" placeholder="筛选柜号/规范码" />
      <MasterIoBar entity="cabinets" :slice="rows" />
    </div>
    <div class="card">
      <div class="card-header">
        <span>灭菌柜主数据</span>
        <span class="hint">导入按 canonicalId upsert · 不删除未出现行</span>
      </div>
      <div class="card-body table-wrap" style="padding:0">
        <table class="data">
          <thead>
            <tr>
              <th>柜号</th><th>规范码</th><th>基地</th><th>额定装载</th><th>日产能</th><th>托盘层</th><th>状态</th><th>备注</th><th>关联工艺</th>
            </tr>
          </thead>
          <tbody id="cabBody">
            <tr v-for="c in rows" :key="c.id">
              <td><strong>{{ c.displayCode }}</strong></td>
              <td class="mono">{{ c.canonicalId }}</td>
              <td>{{ c.base }}基地</td>
              <td>{{ c.ratedLoadM3 }} m³</td>
              <td>{{ c.capacity }} m³</td>
              <td>{{ plan.traysForCabinet(c.id).length }} 层</td>
              <td>
                <span v-if="c.status === '可用'" class="tag tag-green">可用</span>
                <span v-else-if="c.status === '报废'" class="tag tag-red">报废</span>
                <span v-else class="tag tag-pending">待确认·未进产能主数据</span>
              </td>
              <td>{{ c.note || '—' }}</td>
              <td>
                <span v-for="t in c.tags" :key="t" class="tag tag-blue">{{ t }}</span>
                <template v-if="!c.tags.length">—</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
