<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { cabinetById, usableCabinets } from '../../data/seed-cabinets';
import { PROCESSES } from '../../data/seed-processes';
import { currentFurnaces, furnaceBoxes, furnaceVol, needsSplit, visibleUnassignedPool } from '../../domain/pool';
import { effectiveMinLoadM3 } from '../../domain/min-load';
import { validateAll, validateFurnace } from '../../domain/rule-engine';
import type { StockLine } from '../../domain/entities';
import FactStrip from '../components/facts/FactStrip.vue';
import { usePlanStore } from '../stores/planStore';

const plan = usePlanStore();
const router = useRouter();
const addCabId = ref(usableCabinets()[0]?.id || '');

const furns = computed(() => currentFurnaces(plan.furnaces, plan.date, plan.shift));
const ctx = computed(() => plan.ruleCtx(furns.value));
const issues = computed(() => validateAll(furns.value, ctx.value));
const totalVol = computed(() => furns.value.reduce((s, f) => s + furnaceVol(f, (id) => plan.poolById(id)), 0));
const errCount = computed(() => issues.value.filter((i) => i.sev === 'error').length);
const warnCount = computed(() => issues.value.filter((i) => i.sev === 'warning').length);

const errFurnaces = computed(() => furns.value.filter((f) => validateFurnace(f, ctx.value).some((i) => i.sev === 'error')));

const list = computed(() => {
  let rows = visibleUnassignedPool(plan.pool, plan.furnaces, plan.config);
  const f = plan.filters;
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((p) => [p.name, p.ref, p.customer, p.process, p.wo, p.id].join('|').toLowerCase().includes(q));
  }
  if (f.customer) rows = rows.filter((p) => p.customer === f.customer);
  if (f.process) rows = rows.filter((p) => p.process === f.process);
  if (f.urgentOnly) rows = rows.filter((p) => p.urgent);
  return rows;
});

const customers = computed(() => [...new Set(plan.pool.filter((p) => !p.splitOf).map((p) => p.customer))]);
const processes = computed(() => [...new Set(plan.pool.filter((p) => !p.splitOf).map((p) => p.process))]);

function minTarget(process: string): number {
  return effectiveMinLoadM3(process, plan.config, PROCESSES);
}

function linesOf(fuId: string): StockLine[] {
  const fu = furns.value.find((x) => x.id === fuId);
  if (!fu) return [];
  return fu.lines.map((id) => plan.poolById(id)).filter((l): l is StockLine => Boolean(l));
}

function furnaceMeta(fuId: string) {
  const fu = furns.value.find((x) => x.id === fuId)!;
  const vol = furnaceVol(fu, (id) => plan.poolById(id));
  const boxes = furnaceBoxes(fu, (id) => plan.poolById(id));
  const lines = linesOf(fu.id);
  const proc = lines[0]?.process;
  const target = proc ? minTarget(proc) : plan.config.load.defaultMinM3;
  const pct = Math.min(100, (vol / target) * 100);
  const fissues = validateFurnace(fu, ctx.value);
  const hasErr = fissues.some((i) => i.sev === 'error');
  const hasWarn = fissues.some((i) => i.sev === 'warning');
  const showManualBar = fu.manualViolation || (plan.scheduleMode === 'manual' && hasErr);
  const showNeedFix = plan.scheduleMode === 'auto' && hasErr;
  return { fu, vol, boxes, lines, target, pct, fillClass: vol >= target ? 'ok' : 'low', fissues, hasErr, hasWarn, showManualBar, showNeedFix };
}

function gotoGantt() {
  plan.fpStartDate = plan.date || plan.fpStartDate;
  plan.syncFurnacePlan();
  void router.push('/gantt');
}

function runValidate() {
  void router.push({ path: '/release', query: { tab: 'issues' } });
  plan.refreshValidationLoads();
}
</script>

<template>
  <section id="page-workbench" style="min-height:0;flex:1;overflow:hidden;display:flex;flex-direction:column;gap:var(--space-sm)">
    <div class="config-bar" style="margin-bottom:0">
      <span class="hint">本页按<strong>上线日</strong>（甘特写回）过滤已排期结果，不作为组柜前置；未排载荷请到「组柜优化」查看。</span>
    </div>
    <div class="wb-toolbar">
      <div id="scheduleModeTabs" class="shift-tabs" title="自动排产：error 拒绝落盘；手工调整：允许 error 并标手工违例">
        <div class="shift-tab" :class="{ active: plan.scheduleMode === 'auto' }" data-mode="auto" @click="plan.setScheduleMode('auto')">自动排产</div>
        <div class="shift-tab" :class="{ active: plan.scheduleMode === 'manual' }" data-mode="manual" @click="plan.setScheduleMode('manual')">手工调整</div>
      </div>
      <div class="chips">
        <div class="chip">已排体积 <span id="chipVol" class="val">{{ totalVol.toFixed(1) }} m³</span></div>
        <div class="chip">目标负荷 <span id="chipTarget" class="val">{{ furns.length ? `${furns.length} 炉` : '—' }}</span></div>
        <div id="chipIssuesWrap" class="chip" :class="errCount ? 'err' : warnCount ? 'warn' : 'ok'">校验问题数 <span id="chipIssues" class="val">{{ errCount + warnCount }}</span></div>
      </div>
      <div class="spacer" />
      <button id="btnAssign" class="btn btn-primary" type="button" @click="plan.assignSelected()">分配到选中炉</button>
      <button id="btnSuggest" class="btn btn-warning" type="button" @click="plan.suggestCombine()">建议拼炉</button>
      <button id="btnSplit" class="btn" type="button" @click="plan.openSplitWizard()">拆炉向导</button>
      <button id="btnValidate" class="btn btn-success" type="button" @click="runValidate()">运行校验</button>
      <button id="btnGotoFurnacePlan" class="btn" type="button" title="同步装炉结果并查看多日工艺周期甘特" @click="gotoGantt()">查看入炉计划甘特</button>
    </div>
    <div class="config-bar">
      <span class="tag tag-pending">P0 待确认</span>
      <label>允许填充物补足目标拼载 <span id="cfgFiller" class="switch" :class="{ on: plan.config.allowFiller }" @click="plan.setAllowFiller(!plan.config.allowFiller)" /></label>
      <label>混炉不同客户告警 <span id="cfgMix" class="switch" :class="{ on: plan.config.mixCustomerWarn }" @click="plan.setMixCustomer(!plan.config.mixCustomerWarn)" /></label>
      <span class="hint">开关仅影响校验提示，不代表业务已定稿</span>
      <span class="hint">策略 <code>D002_CAB9_DEMO</code></span>
    </div>
    <div id="cycleConfigBar" class="config-bar">
      <span class="label">周期/阈值（配置驱动）</span>
      <label>预热 d <input id="cfgPreheat" class="input" type="number" step="0.5" min="0" style="width:72px" :value="plan.config.cycle.preheatDays" @change="plan.setCycleNum('preheatDays', Number(($event.target as HTMLInputElement).value))" /></label>
      <label>灭菌 d <input id="cfgSterilize" class="input" type="number" step="0.5" min="0" style="width:72px" :value="plan.config.cycle.sterilizeDays" @change="plan.setCycleNum('sterilizeDays', Number(($event.target as HTMLInputElement).value))" /></label>
      <label>BI d <input id="cfgBiDays" class="input" type="number" step="0.5" min="0" style="width:72px" :value="plan.config.cycle.biDays" @change="plan.setCycleNum('biDays', Number(($event.target as HTMLInputElement).value))" /></label>
      <label>D002 最低拼载 (m³) <input id="cfgD002Min" class="input" type="number" step="1" min="0" style="width:80px" :value="effectiveMinLoadM3('D002', plan.config, PROCESSES)" @change="plan.setD002Min(Number(($event.target as HTMLInputElement).value))" /></label>
      <label>其他目标 m³ <input id="cfgDefaultMin" class="input" type="number" step="1" min="0" style="width:80px" :value="plan.config.load.defaultMinM3" @change="plan.setDefaultMin(Number(($event.target as HTMLInputElement).value))" /></label>
    </div>
    <div
      id="wbModeBanner"
      class="strong-banner"
      :class="plan.scheduleMode === 'manual' ? 'danger' : 'warn'"
      :style="{ display: errFurnaces.length ? '' : 'none' }"
      role="alert"
    >
      <template v-if="errFurnaces.length && plan.scheduleMode === 'manual'">
        手工违例：当前班次存在硬错误，已允许保存。建议填写违例原因。请到本页「校验问题」查看（可筛「仅手工违例」）。
      </template>
      <template v-else-if="errFurnaces.length">
        需手工处理或改回合法：自动排产模式下这些炉次含硬错误，新的自动写入（含建议拼炉）若仍有 error 将被拒绝。
      </template>
    </div>
    <div class="wb-body" style="flex:1">
      <div class="wb-left">
        <div class="wb-left-header">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>可排池</strong>
            <span id="poolCount" class="hint">可排 {{ list.length }} 行</span>
          </div>
          <div class="toolbar">
            <input id="filterQ" class="input search-input" :value="plan.filters.q" placeholder="搜索 品名/REF/客户/工艺" @input="plan.filters.q = ($event.target as HTMLInputElement).value" />
            <select id="filterCustomer" class="select" :value="plan.filters.customer" @change="plan.filters.customer = ($event.target as HTMLSelectElement).value">
              <option value="">全部客户</option>
              <option v-for="c in customers" :key="c" :value="c">{{ c }}</option>
            </select>
            <select id="filterProcess" class="select" :value="plan.filters.process" @change="plan.filters.process = ($event.target as HTMLSelectElement).value">
              <option value="">全部工艺</option>
              <option v-for="c in processes" :key="c" :value="c">{{ c }}</option>
            </select>
            <label style="font-size:12px;display:flex;align-items:center;gap:4px">
              <input id="filterUrgent" type="checkbox" :checked="plan.filters.urgentOnly" @change="plan.filters.urgentOnly = ($event.target as HTMLInputElement).checked" /> 仅加急
            </label>
          </div>
        </div>
        <div class="wb-left-list">
          <table class="data">
            <thead>
              <tr>
                <th style="width:28px"></th>
                <th>行号</th>
                <th>品名 / 体积</th>
                <th>事实</th>
              </tr>
            </thead>
            <tbody id="poolTableBody">
              <tr v-if="!list.length"><td colspan="4"><div class="empty"><div class="emoji">📭</div><div>无可排行（已全部排入或筛选为空）</div></div></td></tr>
              <tr v-for="p in list" :key="p.id" :class="{ selected: plan.selectedPool.includes(p.id) }" :data-id="p.id">
                <td><input type="checkbox" :data-pool="p.id" :checked="plan.selectedPool.includes(p.id)" @change="plan.togglePoolSelect(p.id, ($event.target as HTMLInputElement).checked)" /></td>
                <td class="mono">{{ p.id }}</td>
                <td class="pool-name-cell" :title="p.name">
                  <span v-if="needsSplit(p, plan.config)" class="tag tag-orange">需拆炉</span>
                  <span v-if="p.suggest" class="tag tag-purple" :title="p.suggest">拼</span>
                  <strong>{{ p.name.length > 12 ? p.name.slice(0, 12) + '…' : p.name }}</strong>
                  <div class="sub">{{ p.process }} · {{ p.boxes }}箱 · <strong>{{ p.vol }}</strong> m³ · {{ p.customer.replace('C-', '') }}</div>
                </td>
                <td class="facts-cell"><FactStrip :line="p" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="wb-right">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>本班炉次</strong>
          <select id="addCabSelect" v-model="addCabId" class="select">
            <option v-for="c in usableCabinets()" :key="c.id" :value="c.id">{{ c.id }}（{{ c.base }} · {{ c.capacity }}m³{{ c.pending ? ' · 待确认' : '' }}）</option>
          </select>
          <button id="btnAddFurnace" class="btn btn-sm btn-primary" type="button" @click="plan.addFurnace(addCabId)">+ 添加炉次</button>
          <span class="hint">点击炉卡选中，再点「分配到选中炉」</span>
        </div>
        <div id="furnaceGrid" class="furnace-grid">
          <div v-if="!furns.length" class="empty" style="grid-column:1/-1;background:#fff;border-radius:8px;border:1px dashed #d9d9d9">
            <div class="emoji">🏭</div>
            <div>本班次尚未建炉</div>
            <div class="hint">点击下方「添加炉次」选择灭菌柜，或使用「建议拼炉」</div>
          </div>
          <div
            v-for="fu in furns"
            :key="fu.id"
            class="furnace-card"
            :class="{
              selected: plan.selectedFurnaceId === fu.id,
              'has-error': furnaceMeta(fu.id).hasErr,
              'has-warn': furnaceMeta(fu.id).hasWarn && !furnaceMeta(fu.id).hasErr,
              'has-manual': furnaceMeta(fu.id).showManualBar || furnaceMeta(fu.id).showNeedFix,
            }"
            :data-fid="fu.id"
          >
            <div v-if="furnaceMeta(fu.id).showNeedFix" class="furnace-violation need-fix">需手工处理或改回合法</div>
            <div v-else-if="furnaceMeta(fu.id).showManualBar" class="furnace-violation">手工违例</div>
            <div class="furnace-hd" :data-select-furnace="fu.id" @click="plan.selectedFurnaceId = fu.id">
              <div>
                <div class="fname">
                  {{ fu.cabinetId }}
                  <span v-if="cabinetById(fu.cabinetId)?.pending && plan.config.showPendingTags" class="tag tag-pending">主数据待确认</span>
                  <span class="hint">· {{ fu.id }}</span>
                </div>
                <div class="furnace-stats">
                  <span>{{ cabinetById(fu.cabinetId)?.base || '' }}基地</span>
                  <span>已装 <strong>{{ furnaceMeta(fu.id).vol.toFixed(1) }}</strong> m³</span>
                  <span>{{ furnaceMeta(fu.id).boxes }} 箱</span>
                  <span>目标 ≥{{ furnaceMeta(fu.id).target }}</span>
                </div>
                <div class="progress-bar"><div class="fill" :class="furnaceMeta(fu.id).fillClass" :style="{ width: furnaceMeta(fu.id).pct + '%' }" /></div>
                <select class="select cab-change" :data-change-cab="fu.id" title="改柜" :value="fu.cabinetId" @change.stop="plan.changeFurnaceCabinet(fu.id, ($event.target as HTMLSelectElement).value)">
                  <option v-for="c in usableCabinets()" :key="c.id" :value="c.id">{{ c.id }}</option>
                </select>
              </div>
            </div>
            <div class="furnace-body">
              <div v-if="!furnaceMeta(fu.id).lines.length" class="empty" style="padding:16px"><div class="hint">空炉 · 勾选左侧行后点「分配」</div></div>
              <div v-for="l in furnaceMeta(fu.id).lines" :key="l.id" class="furnace-row">
                <span>{{ l.urgent ? '🔥' : '' }} {{ l.id }} {{ l.name.slice(0, 8) }} · {{ l.vol }}m³</span>
                <span class="rm" :data-rm="fu.id + '|' + l.id" title="移除" @click="plan.removeFromFurnace(fu.id, l.id)">×</span>
              </div>
            </div>
            <div class="furnace-badges">
              <span v-for="i in furnaceMeta(fu.id).fissues.slice(0, 3)" :key="i.code" class="tag" :class="i.sev === 'error' ? 'tag-red' : i.sev === 'warning' ? 'tag-orange' : 'tag-blue'">
                {{ i.sev === 'error' ? '错误' : i.sev === 'warning' ? '警告' : '提示' }}
              </span>
              <span v-if="furnaceMeta(fu.id).fissues.length > 3" class="tag tag-default">+{{ furnaceMeta(fu.id).fissues.length - 3 }}</span>
            </div>
            <div v-if="furnaceMeta(fu.id).showManualBar || furnaceMeta(fu.id).showNeedFix" class="furnace-actions" style="flex-direction:column;align-items:stretch">
              <input class="input override-note" :data-override-note="fu.id" placeholder="违例原因（建议填写）" :value="plan.config.overrideNotes?.[fu.id] || ''" @change="plan.saveOverrideNote(fu.id, ($event.target as HTMLInputElement).value)" />
            </div>
            <div class="furnace-actions">
              <button class="btn btn-sm btn-danger" :data-del-furnace="fu.id" @click="plan.deleteFurnace(fu.id)">删除炉次</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
