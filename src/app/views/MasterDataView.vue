<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';

const route = useRoute();
const tabs = [
  { path: '/master/cabinets', label: '灭菌柜 / 托盘' },
  { path: '/master/processes', label: '工艺与允许柜' },
  { path: '/master/boxspecs', label: '箱规' },
] as const;

const activePath = computed(() => route.path);
</script>

<template>
  <section id="page-master" class="page active">
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
