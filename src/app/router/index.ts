import type { RouteRecordRaw, RouterHistory } from 'vue-router';
import { createRouter } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/demand' },
  {
    path: '/master',
    name: 'master',
    component: () => import('../views/MasterDataView.vue'),
    redirect: '/master/cabinets',
    meta: { page: 'master', title: '基础数据维护' },
    children: [
      {
        path: 'cabinets',
        name: 'master-cabinets',
        component: () => import('../views/CabinetsView.vue'),
        meta: { page: 'master', title: '基础数据维护 · 灭菌柜' },
      },
      {
        path: 'trays',
        name: 'master-trays',
        component: () => import('../views/TraysView.vue'),
        meta: { page: 'master', title: '基础数据维护 · 托盘' },
      },
      {
        path: 'processes',
        name: 'master-processes',
        component: () => import('../views/ProcessesView.vue'),
        meta: { page: 'master', title: '基础数据维护 · 工艺与允许柜' },
      },
      {
        path: 'boxspecs',
        name: 'master-boxspecs',
        component: () => import('../views/BoxSpecsView.vue'),
        meta: { page: 'master', title: '基础数据维护 · 箱规' },
      },
      {
        path: 'customer-rules',
        name: 'master-customer-rules',
        component: () => import('../views/CustomerRulesView.vue'),
        meta: { page: 'master', title: '基础数据维护 · 客户规则' },
      },
    ],
  },
  {
    path: '/demand',
    name: 'demand',
    component: () => import('../views/DemandPoolView.vue'),
    meta: { page: 'demand', title: '待排产需求确认' },
  },
  {
    path: '/pack',
    name: 'pack',
    component: () => import('../views/PackCabinetView.vue'),
    meta: { page: 'grouping', title: '组柜优化' },
  },
  {
    path: '/gantt',
    name: 'gantt',
    component: () => import('../views/GanttPlanView.vue'),
    meta: { page: 'furnace-plan', title: '入炉计划' },
  },
  {
    path: '/release',
    name: 'release',
    component: () => import('../views/ReleaseView.vue'),
    meta: { page: 'release', title: '结果发布' },
  },
  { path: '/pool', redirect: '/demand' },
  { path: '/workbench', redirect: '/release' },
  { path: '/validation', redirect: { path: '/release', query: { tab: 'issues' } } },
  { path: '/cabinets', redirect: '/master/cabinets' },
  { path: '/processes', redirect: '/master/processes' },
  { path: '/boxspecs', redirect: '/master/boxspecs' },
];

export function createAppRouter(history: RouterHistory) {
  return createRouter({
    history,
    routes,
  });
}
