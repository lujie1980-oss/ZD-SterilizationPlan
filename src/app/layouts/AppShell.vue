<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { usePlanStore } from '../stores/planStore';
import { useUiStore } from '../stores/uiStore';
import FactDrawer from '../components/facts/FactDrawer.vue';
import OverridePrompt from '../components/common/OverridePrompt.vue';
import SplitWizardModal from '../components/common/SplitWizardModal.vue';
import ToastHost from '../components/common/ToastHost.vue';

const route = useRoute();
const router = useRouter();
const plan = usePlanStore();
const ui = useUiStore();

const nav = [
  { group: '排产', items: [
    { page: 'grouping', path: '/pack', icon: '🧩', label: '组柜', sub: '选柜 / 选需求 · 未排' },
    { page: 'workbench', path: '/workbench', icon: '📅', label: '已排期浏览', sub: '过渡 · 结果过滤' },
    { page: 'furnace-plan', path: '/gantt', icon: '🔥', label: '进炉计划', sub: '装炉后 · 多日周期' },
    { page: 'pool', path: '/pool', icon: '📦', label: '待灭菌可排池' },
  ]},
  { group: '主数据', items: [
    { page: 'cabinets', path: '/cabinets', icon: '🏭', label: '主数据 · 灭菌柜' },
    { page: 'processes', path: '/processes', icon: '⚙️', label: '主数据 · 工艺与指定柜' },
    { page: 'boxspecs', path: '/boxspecs', icon: '📏', label: '主数据 · 箱规' },
  ]},
  { group: '质量', items: [
    { page: 'validation', path: '/validation', icon: '✓', label: '校验中心' },
  ]},
];

const title = computed(() => (route.meta.title as string) || '灭菌中心排产');
const page = computed(() => (route.meta.page as string) || '');
const hideExport = computed(() => page.value === 'grouping' || page.value === 'furnace-plan');
const hideDate = computed(() => page.value === 'grouping');

function onNav(path: string) {
  void router.push(path);
}
</script>

<template>
  <div class="app">
    <aside class="sidebar" :class="{ 'is-collapsed': ui.sidebarCollapsed }">
      <div class="brand">
        <div class="brand-title">振德医疗 · 灭菌中心排产</div>
        <div class="brand-sub">灭菌车间排产 MVP</div>
      </div>
      <nav class="nav">
        <template v-for="g in nav" :key="g.group">
          <div class="nav-group">{{ g.group }}</div>
          <RouterLink
            v-for="item in g.items"
            :key="item.page"
            class="nav-item"
            :class="{ active: page === item.page }"
            :data-page="item.page"
            :to="item.path"
            @click="onNav(item.path)"
          >
            <span class="icon">{{ item.icon }}</span>
            <span v-if="item.sub" class="nav-item-text">
              <span>{{ item.label }}</span>
              <span class="nav-sub">{{ item.sub }}</span>
            </span>
            <span v-else>{{ item.label }}</span>
          </RouterLink>
        </template>
      </nav>
      <div class="sidebar-footer">
        <div>
          <button class="btn btn-sm" type="button" title="折叠侧栏" @click="ui.toggleSidebar()">
            {{ ui.sidebarCollapsed ? '»' : '«' }}
          </button>
        </div>
        <div>角色</div>
        <div class="user">计划员 · 王工</div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-title" id="topbarTitle">{{ title }}</div>
        <div class="topbar-actions">
          <span v-show="!hideDate" class="hint" id="topDateHint" title="仅过滤已排期结果，不参与组柜">结果日</span>
          <input
            v-show="!hideDate"
            id="topResultDate"
            class="input"
            type="date"
            :value="plan.date"
            title="已排期结果过滤，不作为组柜前置"
            :disabled="hideDate"
            @change="plan.setDate(($event.target as HTMLInputElement).value)"
          />
          <button v-show="!hideExport" id="btnExport" class="btn" type="button" @click="plan.exportCSV()">导出日计划 CSV</button>
        </div>
      </header>
      <RouterView />
    </div>
    <ToastHost />
    <FactDrawer />
    <OverridePrompt />
    <SplitWizardModal />
  </div>
</template>
