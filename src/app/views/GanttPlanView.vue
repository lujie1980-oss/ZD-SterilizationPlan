<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CABINETS, cabinetById } from '../../data/seed-cabinets';
import { addDays, dayOffset, fmtDate, fmtDateTime } from '../../domain/dates';
import type { EntryLoad } from '../../domain/entities';
import SortPolicyPanel from '../components/gantt/SortPolicyPanel.vue';
import { usePlanStore } from '../stores/planStore';

const DAY_W = 72;
const plan = usePlanStore();
onMounted(() => plan.enterGantt());

const start = computed(() => plan.fpStartDate || plan.date);
const horizon = computed(() => plan.fpHorizon || plan.config.fp.defaultHorizon);

const loads = computed(() => {
  let list = plan.fpLoads.slice();
  if (plan.fpShiftFilter) list = list.filter((l) => l.shift === plan.fpShiftFilter);
  return list;
});

const cabIds = computed(() => {
  const ids = [...new Set(loads.value.map((l) => l.cabinetId))];
  const order = CABINETS.map((c) => c.id);
  ids.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  return ids;
});

const days = computed(() => {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const out = [];
  for (let i = 0; i < horizon.value; i++) {
    const dt = addDays(start.value, i);
    out.push({
      date: fmtDate(dt),
      label: `${dt.getMonth() + 1}/${dt.getDate()}`,
      wd: `周${weekdays[dt.getDay()]}`,
      weekend: dt.getDay() === 0 || dt.getDay() === 6,
    });
  }
  return out;
});

const selectedCab = computed(() => {
  if (plan.fpSelectedCab && cabIds.value.includes(plan.fpSelectedCab)) return plan.fpSelectedCab;
  return cabIds.value[0] || null;
});

const queueLoads = computed(() => {
  if (!selectedCab.value) return [] as EntryLoad[];
  let list = plan.fpLoads.filter((l) => l.cabinetId === selectedCab.value);
  if (plan.fpShiftFilter) list = list.filter((l) => l.shift === plan.fpShiftFilter);
  return list.slice().sort((a, b) => a.seq - b.seq);
});

const queueConflicts = computed(() =>
  selectedCab.value ? plan.fpConflicts.filter((c) => c.cabinetId === selectedCab.value) : [],
);

const tip = ref<{ x: number; y: number; data: Record<string, string> } | null>(null);

function cabLoads(cabId: string) {
  return loads.value.filter((l) => l.cabinetId === cabId);
}

function rowH(cabId: string) {
  const list = cabLoads(cabId);
  const maxSeq = Math.max(...list.map((l) => l.seq), 1);
  return Math.max(56, 12 + maxSeq * 26);
}

function barStyle(load: EntryLoad) {
  const ph = load.phases;
  const barStart = ph.preheat ? ph.preheat.start : ph.sterilize.start;
  const barEnd = ph.bi.end;
  const left = dayOffset(start.value, barStart) * DAY_W;
  const width = dayOffset(barStart, barEnd) * DAY_W;
  const top = 8 + (load.seq - 1) * 26;
  return { left: `${left}px`, width: `${Math.max(width, 8)}px`, top: `${top}px` };
}

function segs(load: EntryLoad) {
  const ph = load.phases;
  const out: Array<{ cls: string; w: number }> = [];
  if (ph.preheat) out.push({ cls: 'preheat', w: Math.max(2, dayOffset(ph.preheat.start, ph.preheat.end) * DAY_W) });
  out.push({ cls: 'sterilize', w: Math.max(2, dayOffset(ph.sterilize.start, ph.sterilize.end) * DAY_W) });
  out.push({ cls: 'aerate', w: Math.max(2, dayOffset(ph.aerate.start, ph.aerate.end) * DAY_W) });
  out.push({ cls: 'bi', w: Math.max(2, dayOffset(ph.bi.start, ph.bi.end) * DAY_W) });
  return out;
}

function barLabel(load: EntryLoad) {
  const shortCust = (load.customer || '').replace(/^C-/, '');
  return `#${load.seq} ${load.process}/${shortCust} ${load.vol.toFixed(0)}m³`;
}

function showTip(e: MouseEvent, load: EntryLoad) {
  const ph = load.phases;
  tip.value = {
    x: Math.min(e.clientX + 14, window.innerWidth - 340),
    y: Math.min(e.clientY + 14, window.innerHeight - 200),
    data: {
      furnaceId: load.furnaceId,
      seq: String(load.seq),
      customer: load.customer,
      process: load.process,
      shift: load.shift,
      vol: String(load.vol),
      boxes: String(load.boxes),
      preheat: ph.preheat ? `${fmtDateTime(ph.preheat.start)} → ${fmtDateTime(ph.preheat.end)}` : '—',
      sterilize: `${fmtDateTime(ph.sterilize.start)} → ${fmtDateTime(ph.sterilize.end)}`,
      aerate: `${fmtDateTime(ph.aerate.start)} → ${fmtDateTime(ph.aerate.end)}`,
      bi: `${fmtDateTime(ph.bi.start)} → ${fmtDateTime(ph.bi.end)}`,
      notes: load.pendingNotes.join('；') || '',
      lines: load.lineIds.join(', '),
    },
  };
}

function selectCab(id: string) {
  plan.fpSelectedCab = id;
}
</script>

<template>
  <section id="page-furnace-plan" class="page active" style="min-height:0;flex:1;overflow:hidden;padding:12px 16px">
    <div class="fp-toolbar">
      <div class="fp-title-block">
        <strong>进炉计划 · 工艺周期甘特</strong>
        <span class="hint">进炉 → 解析 → BI（可选预热）· 按柜号进炉顺序</span>
      </div>
      <span class="label">计划起点</span>
      <input id="fpStartDate" class="input" type="date" :value="start" @change="plan.fpStartDate = ($event.target as HTMLInputElement).value || start" />
      <span class="label">视野天数</span>
      <div id="fpHorizonTabs" class="shift-tabs">
        <div v-for="d in [7, 14, 21]" :key="d" class="shift-tab" :class="{ active: horizon === d }" :data-days="d" @click="plan.fpHorizon = d">{{ d }}</div>
      </div>
      <span class="label">班次</span>
      <select id="fpShiftFilter" class="select" :value="plan.fpShiftFilter" @change="plan.fpShiftFilter = ($event.target as HTMLSelectElement).value">
        <option value="">全部班次</option>
        <option value="白班">白班</option>
        <option value="夜班">夜班</option>
      </select>
      <div class="spacer" />
      <button id="btnFpSync" class="btn btn-primary" type="button" @click="plan.syncFurnacePlan()">同步装炉结果</button>
    </div>
    <SortPolicyPanel />
    <div class="fp-legend">
      <span class="fp-leg"><i class="fp-swatch" style="background:#69b1ff" />预热</span>
      <span class="fp-leg"><i class="fp-swatch" style="background:#1677ff" />进炉/灭菌</span>
      <span class="fp-leg"><i class="fp-swatch" style="background:#faad14" />解析</span>
      <span class="fp-leg"><i class="fp-swatch" style="background:#52c41a" />BI</span>
      <span class="fp-leg"><i class="fp-swatch conflict" />灭菌重叠冲突</span>
      <span class="hint">解析/BI 天数来自工艺主数据示意，P0 待确认处标黄</span>
      <span id="fpWarnBadge" class="tag tag-pending" :style="{ display: plan.fpConflicts.length ? '' : 'none' }">
        {{ plan.fpConflicts.length }} 项校验警告
      </span>
    </div>
    <div class="fp-body">
      <div id="fpGanttWrap" class="fp-gantt-wrap">
        <div id="fpGantt" class="fp-gantt" :style="{ '--day-w': DAY_W + 'px' }">
          <template v-if="!cabIds.length">
            <div class="fp-empty"><div class="emoji">📭</div><div>暂无装炉结果</div><div class="hint">请先在日排产工作台分配炉次，或点击「同步装炉结果」加载演示数据</div></div>
          </template>
          <template v-else>
            <div class="fp-axis-corner">柜号 / 基地</div>
            <div class="fp-axis" :style="{ width: horizon * DAY_W + 'px' }">
              <div v-for="d in days" :key="d.date" class="fp-day" :class="{ weekend: d.weekend }" :style="{ width: DAY_W + 'px' }">
                <span class="fp-day-label">{{ d.label }}</span>
                <span class="fp-day-wd">{{ d.wd }}</span>
                <span class="fp-day-half" />
              </div>
            </div>
            <template v-for="id in cabIds" :key="id">
              <div
                class="fp-cab-label"
                :class="{ selected: selectedCab === id, 'has-conflict': cabLoads(id).some((l) => l.conflict) }"
                :data-fp-cab="id"
                :style="{ minHeight: rowH(id) + 'px' }"
                @click="selectCab(id)"
              >
                <div class="cab-id">
                  {{ id }}
                  <span v-if="cabinetById(id)?.pending || id === '柜21'" class="tag tag-pending">待确认</span>
                  <span v-if="cabLoads(id).some((l) => l.conflict)" class="tag tag-red">冲突</span>
                </div>
                <div class="cab-meta">{{ cabinetById(id)?.base || '—' }}基地 · {{ cabinetById(id)?.status || '—' }} · {{ cabLoads(id).length }} 炉次</div>
              </div>
              <div
                class="fp-row-track"
                :class="{ selected: selectedCab === id }"
                :data-fp-cab-track="id"
                :style="{ width: horizon * DAY_W + 'px', minHeight: rowH(id) + 'px', height: rowH(id) + 'px' }"
              >
                <div
                  v-for="load in cabLoads(id)"
                  :key="load.furnaceId"
                  class="fp-bar"
                  :class="{ conflict: load.conflict, 'pending-guess': load.pending }"
                  :style="barStyle(load)"
                  :data-fp-load="load.furnaceId"
                  :data-fp-cab="id"
                  @click="selectCab(id)"
                  @mousemove="showTip($event, load)"
                  @mouseleave="tip = null"
                >
                  <div v-for="(s, si) in segs(load)" :key="si" class="fp-seg" :class="s.cls" :style="{ width: s.w + 'px' }" />
                  <div class="fp-bar-label">{{ barLabel(load) }}</div>
                </div>
              </div>
            </template>
          </template>
        </div>
      </div>
      <aside id="fpQueuePanel" class="fp-queue card">
        <div class="card-header">
          <span id="fpQueueTitle">{{ selectedCab ? `${selectedCab} · 进炉顺序队列` : '进炉顺序队列' }}</span>
          <span id="fpQueueSub" class="hint">{{ selectedCab ? `${cabinetById(selectedCab)?.base || ''}基地${cabinetById(selectedCab)?.pending || selectedCab === '柜21' ? ' · 待确认' : ''}` : '点击柜行查看' }}</span>
        </div>
        <div class="card-body table-wrap" style="padding:0;flex:1;overflow:auto">
          <table id="fpQueueTable" class="data">
            <thead>
              <tr>
                <th>顺序</th><th>装炉来源</th><th>计划进炉</th>
                <th>预计出柜</th><th>解析完成</th><th>BI完成</th>
              </tr>
            </thead>
            <tbody id="fpQueueBody">
              <tr v-if="!selectedCab"><td colspan="6"><div class="empty"><div class="hint">选择左侧柜行</div></div></td></tr>
              <tr v-else-if="!queueLoads.length"><td colspan="6"><div class="empty"><div class="hint">该柜无载荷</div></div></td></tr>
              <template v-else>
                <tr v-for="l in queueLoads" :key="l.furnaceId" :class="{ selected: l.conflict }" :style="l.conflict ? 'outline:1px solid #ff4d4f' : ''">
                  <td><strong>{{ l.seq }}</strong><span v-if="l.conflict"> <span class="tag tag-red">冲突</span></span></td>
                  <td class="mono">{{ l.furnaceId }}<div class="hint">{{ l.shift }} · {{ l.process }}</div></td>
                  <td>{{ fmtDateTime(l.phases.sterilize.start) }}</td>
                  <td>{{ fmtDateTime(l.phases.sterilize.end) }}</td>
                  <td>{{ fmtDateTime(l.phases.aerate.end) }}<span v-if="l.phases.aerate.pending"> <span class="tag tag-pending">待确认</span></span></td>
                  <td>{{ fmtDateTime(l.phases.bi.end) }}</td>
                </tr>
                <tr v-for="m in queueConflicts" :key="m.code + (m.furnaceId || '')">
                  <td colspan="6"><span class="tag tag-orange">校验</span> <span class="hint">{{ m.msg }}</span></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </aside>
    </div>
    <div v-if="tip" class="fp-tooltip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
      <div class="tt-title">炉次 {{ tip.data.furnaceId }} · 进炉顺序 #{{ tip.data.seq }}</div>
      <div class="tt-row">物料/客户：{{ tip.data.lines }} · {{ tip.data.customer }}</div>
      <div class="tt-row">工艺 {{ tip.data.process }} · 班次 {{ tip.data.shift }}</div>
      <div class="tt-row">体积 {{ tip.data.vol }} m³ · 箱数 {{ tip.data.boxes }}</div>
      <div class="tt-row">预热：{{ tip.data.preheat }}</div>
      <div class="tt-row">进炉/灭菌：{{ tip.data.sterilize }}</div>
      <div class="tt-row">解析：{{ tip.data.aerate }}</div>
      <div class="tt-row">BI：{{ tip.data.bi }}</div>
      <div v-if="tip.data.notes" class="tt-pending">⚠ {{ tip.data.notes }}</div>
    </div>
  </section>
</template>
