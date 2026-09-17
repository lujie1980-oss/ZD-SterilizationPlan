import type { RouteRecordRaw, RouterHistory } from 'vue-router';
import { createRouter } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/pack' },
  {
    path: '/pack',
    name: 'pack',
    component: () => import('../views/PackCabinetView.vue'),
    meta: { page: 'grouping', title: '组柜 · 选柜 / 选需求' },
  },
  {
    path: '/workbench',
    name: 'workbench',
    component: () => import('../views/WorkbenchView.vue'),
    meta: { page: 'workbench', title: '已排期浏览（过渡）' },
  },
  {
    path: '/gantt',
    name: 'gantt',
    component: () => import('../views/GanttPlanView.vue'),
    meta: { page: 'furnace-plan', title: '进炉计划 · 工艺周期甘特' },
  },
  {
    path: '/pool',
    name: 'pool',
    component: () => import('../views/DemandPoolView.vue'),
    meta: { page: 'pool', title: '待灭菌可排池' },
  },
  {
    path: '/cabinets',
    name: 'cabinets',
    component: () => import('../views/CabinetsView.vue'),
    meta: { page: 'cabinets', title: '主数据 · 灭菌柜' },
  },
  {
    path: '/processes',
    name: 'processes',
    component: () => import('../views/ProcessesView.vue'),
    meta: { page: 'processes', title: '主数据 · 工艺与指定柜' },
  },
  {
    path: '/boxspecs',
    name: 'boxspecs',
    component: () => import('../views/BoxSpecsView.vue'),
    meta: { page: 'boxspecs', title: '主数据 · 箱规' },
  },
  {
    path: '/validation',
    name: 'validation',
    component: () => import('../views/ValidationCenterView.vue'),
    meta: { page: 'validation', title: '校验中心' },
  },
];

export function createAppRouter(history: RouterHistory) {
  return createRouter({
    history,
    routes,
  });
}
