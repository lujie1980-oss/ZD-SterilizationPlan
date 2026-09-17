<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';

const route = useRoute();
const tabs = [
  { path: '/master/cabinets', label: '灭菌柜' },
  { path: '/master/trays', label: '托盘' },
  { path: '/master/processes', label: '工艺与允许柜' },
  { path: '/master/boxspecs', label: '物料箱规' },
  { path: '/master/customer-rules', label: '客户规则' },
] as const;

const activePath = computed(() => route.path);
</script>

<template>
  <section id="page-master" class="page active">
    <div class="hint">主数据导入仅在本页 · 建议顺序：灭菌柜 → 托盘/工艺 → 箱规。失败整批回滚，不改计划/交易。</div>
    <div id="masterTabs" class="shift-tabs">
      <RouterLink
        v-for="t in tabs"
        :key="t.path"
        class="shift-tab"
        :class="{ active: activePath === t.path }"
        :to="t.path"
      >
        {{ t.label }}
      </RouterLink>
    </div>
    <RouterView />
  </section>
</template>
