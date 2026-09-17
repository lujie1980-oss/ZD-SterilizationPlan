<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { filterAndSortIssues } from '../../domain/commit-gate';
import { usePlanStore } from '../stores/planStore';

const plan = usePlanStore();
const router = useRouter();
onMounted(() => plan.refreshValidationLoads());

const raw = computed(() => plan.collectIssues());
const issues = computed(() => filterAndSortIssues(raw.value, plan.furnaces, plan.valFilter));
const viol = computed(() => new Set(plan.furnaces.filter((f) => f.manualViolation).map((f) => f.id)));

function jump(furnaceId?: string) {
  if (!furnaceId) return;
  plan.selectedFurnaceId = furnaceId;
  void router.push('/workbench');
}
</script>

<template>
  <section id="page-validation" class="page active">
    <div class="stat-row">
      <div class="stat-box"><div id="valErr" class="num" style="color:var(--error)">{{ raw.filter((i) => i.sev === 'error').length }}</div><div class="lbl">错误</div></div>
      <div class="stat-box"><div id="valWarn" class="num" style="color:var(--warning)">{{ raw.filter((i) => i.sev === 'warning').length }}</div><div class="lbl">警告</div></div>
      <div class="stat-box"><div id="valInfo" class="num" style="color:var(--info)">{{ raw.filter((i) => i.sev === 'info').length }}</div><div class="lbl">信息</div></div>
    </div>
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:8px">
        <span>当前班次校验问题</span>
        <div id="valFilterTabs" class="shift-tabs">
          <div class="shift-tab" :class="{ active: plan.valFilter === 'all' }" data-val-filter="all" @click="plan.valFilter = 'all'">全部</div>
          <div class="shift-tab" :class="{ active: plan.valFilter === 'error' }" data-val-filter="error" @click="plan.valFilter = 'error'">仅 error</div>
          <div class="shift-tab" :class="{ active: plan.valFilter === 'manual' }" data-val-filter="manual" @click="plan.valFilter = 'manual'">仅手工违例</div>
        </div>
        <span class="hint">点击条目可跳转至对应炉次 · 事实条不代替本页</span>
      </div>
      <div class="card-body">
        <div id="issueList" class="issue-list">
          <div v-if="!issues.length" class="empty">
            <div class="emoji">✅</div>
            <div>{{ raw.length ? '当前筛选下无条目' : '当前班次无校验问题' }}</div>
            <div class="hint">在工作台分配炉次后点击「运行校验」</div>
          </div>
          <div
            v-for="(i, idx) in issues"
            :key="i.code + (i.furnaceId || '') + idx"
            class="issue-item"
            :class="{ 'manual-hit': Boolean(i.furnaceId && viol.has(i.furnaceId)) }"
            :data-jump="i.furnaceId || ''"
            @click="jump(i.furnaceId)"
          >
            <div class="issue-sev">
              <span class="tag" :class="i.sev === 'error' ? 'tag-red' : i.sev === 'warning' ? 'tag-orange' : 'tag-blue'">
                {{ i.sev === 'error' ? '错误' : i.sev === 'warning' ? '警告' : '信息' }}
              </span>
              <span v-if="i.furnaceId && viol.has(i.furnaceId)" class="tag tag-red">手工违例</span>
            </div>
            <div class="issue-body">
              <div class="msg">{{ i.msg }}</div>
              <div class="meta">
                代码 {{ i.code }}{{ i.furnaceId ? ` · 炉次 ${i.furnaceId}` : '' }}{{ i.pendingFlag ? ' · 待确认' : '' }}{{ i.scheduleModeAtDetect ? ` · 检测时 ${i.scheduleModeAtDetect === 'manual' ? '手工调整' : '自动排产'}` : '' }} · 点击跳转工作台
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
