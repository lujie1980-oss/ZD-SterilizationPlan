<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlanStore } from '../stores/planStore';
import WorkbenchView from './WorkbenchView.vue';
import ValidationCenterView from './ValidationCenterView.vue';

const plan = usePlanStore();
const route = useRoute();
const router = useRouter();

const tab = computed(() => (route.query.tab === 'issues' ? 'issues' : 'list'));

function setTab(next: 'list' | 'issues') {
  void router.replace({
    path: '/release',
    query: next === 'issues' ? { tab: 'issues' } : {},
  });
}

watch(
  tab,
  (t) => {
    if (t === 'issues') plan.refreshValidationLoads();
  },
  { immediate: true },
);
</script>

<template>
  <section id="page-release" class="page active" style="min-height:0;flex:1;overflow:hidden">
    <div class="wb-toolbar" id="releaseToolbar">
      <span class="label">结果日</span>
      <input
        id="releaseResultDate"
        class="input"
        type="date"
        :value="plan.date"
        title="仅过滤已排期结果（上线日），不参与组柜"
        @change="plan.setDate(($event.target as HTMLInputElement).value)"
      />
      <div id="wbShiftTabs" class="shift-tabs">
        <div class="shift-tab" :class="{ active: plan.shift === '白班' }" data-shift="白班" @click="plan.setShift('白班')">白班</div>
        <div class="shift-tab" :class="{ active: plan.shift === '夜班' }" data-shift="夜班" @click="plan.setShift('夜班')">夜班</div>
      </div>
      <button id="btnExport" class="btn" type="button" @click="plan.exportCSV()">导出日计划 CSV</button>
    </div>
    <div id="releaseTabs" class="shift-tabs" style="margin:0 0 8px">
      <div class="shift-tab" :class="{ active: tab === 'list' }" data-release-tab="list" @click="setTab('list')">已排期列表</div>
      <div class="shift-tab" :class="{ active: tab === 'issues' }" data-release-tab="issues" @click="setTab('issues')">校验问题</div>
    </div>
    <WorkbenchView v-if="tab === 'list'" />
    <ValidationCenterView v-else />
  </section>
</template>
