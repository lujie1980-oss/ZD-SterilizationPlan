<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useUiStore } from '../stores/uiStore';
import FactDrawer from '../components/facts/FactDrawer.vue';
import OverridePrompt from '../components/common/OverridePrompt.vue';
import SplitWizardModal from '../components/common/SplitWizardModal.vue';
import ToastHost from '../components/common/ToastHost.vue';
import MasterImportDrawer from '../components/master/MasterImportDrawer.vue';

const route = useRoute();
const router = useRouter();
const ui = useUiStore();

/** 侧栏唯一真源：五项、固定顺序，不可由接口重排 */
const nav = [
  { page: 'master', path: '/master', icon: '🗂', label: '基础数据维护' },
  { page: 'demand', path: '/demand', icon: '📦', label: '待排产需求确认' },
  { page: 'grouping', path: '/pack', icon: '🧩', label: '组柜优化' },
  { page: 'furnace-plan', path: '/gantt', icon: '🔥', label: '入炉计划' },
  { page: 'release', path: '/release', icon: '📤', label: '结果发布' },
] as const;

const title = computed(() => (route.meta.title as string) || '灭菌中心排产');
const page = computed(() => (route.meta.page as string) || '');

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
        <RouterLink
          v-for="item in nav"
          :key="item.page"
          class="nav-item"
          :class="{ active: page === item.page }"
          :data-page="item.page"
          :to="item.path"
          @click="onNav(item.path)"
        >
          <span class="icon">{{ item.icon }}</span>
          <span class="nav-item-text">
            <span class="nav-label">{{ item.label }}</span>
          </span>
        </RouterLink>
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
        <div class="topbar-actions" />
      </header>
      <RouterView />
    </div>
    <ToastHost />
    <MasterImportDrawer />
    <FactDrawer />
    <OverridePrompt />
    <SplitWizardModal />
  </div>
</template>
