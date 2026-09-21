<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { remainingBoxes, remainingVol, trayCapacityM3 } from '../../domain/cabinet-content';
import { isLargeDemand, listCandidateCabinets, listEligibleForCabinet, packSummaryOf } from '../../domain/grouping';
import { validateFurnace } from '../../domain/rule-engine';
import type { EligibleDemandRow, RuntimeStatus, StockLine } from '../../domain/entities';
import FactStrip from '../components/facts/FactStrip.vue';
import PackPolicyPanel from '../components/pack/PackPolicyPanel.vue';
import {
  groupingLoadCompleteBannerHtml,
  groupingRuntimeTagsHtml,
  packConstraintBanner,
  placementChip,
  trayOverChip,
} from '../components/pack/grouping-contract';
import { usePlanStore } from '../stores/planStore';

const GROUPING_ISSUE_CODES = new Set(['REPACK_AFTER_LOAD_COMPLETE', 'ON_TRAY_QTY_OVERFLOW', 'TRAY_OVERFLOW', 'VOL_OVERFLOW', 'BOX_LIMIT']);

const plan = usePlanStore();
onMounted(() => plan.enterGrouping());

const showTrays = ref(false);
const runtimes = computed(() => plan.currentRuntimes());
const cabId = computed(() => plan.grpSelectedCabinetId);

const eligibleRows = computed((): EligibleDemandRow[] => {
  if (!cabId.value) return [];
  return listEligibleForCabinet({
    cabinetId: cabId.value,
    pool: plan.eligiblePool(),
    contents: plan.furnaces,
    cabinets: plan.masterCabinets,
    config: plan.config,
  });
});

const groups = computed(() => ({
  inThisCabinet: eligibleRows.value.filter((r) => r.placement === 'inThisCabinet'),
  unassigned: eligibleRows.value.filter((r) => r.placement === 'unassigned'),
  inOtherCabinet: eligibleRows.value.filter((r) => r.placement === 'inOtherCabinet'),
}));

const emptyUnassignedHint = computed(() =>
  groups.value.inThisCabinet.length && !groups.value.unassigned.length
    ? '还可排入为空，柜并非空闲（见已进本柜）'
    : '暂无未排可进需求',
);

const demandPool = computed(() => plan.eligiblePool().filter((p) => p.stockStatus !== '限制'));

const candidateCabs = computed(() => {
  const viewIds = plan.grpFocusedDemandId ? [plan.grpFocusedDemandId] : [];
  if (!viewIds.length) return [];
  return listCandidateCabinets({
    lineIds: viewIds,
    poolById: (id) => plan.poolById(id),
    cabinets: plan.masterCabinets,
    runtimes: runtimes.value,
  });
});

const packSummary = computed(() => {
  const cabinetId = cabId.value;
  if (!cabinetId) return null;
  const content = plan.furnaces.find((f) => f.cabinetId === cabinetId && !f.hidden);
  const cab = plan.findCabinet(cabinetId);
  return packSummaryOf({
    content,
    cabinet: cab,
    poolById: (id) => plan.poolById(id),
    largeBoxVol: plan.config.box.largeBoxVol,
    maxBoxesWhenLarge: plan.config.box.maxBoxesWhenLarge,
  });
});

const layer = computed(() => {
  const cabinetId = cabId.value;
  if (!cabinetId) return null;
  const content = plan.furnaces.find((f) => f.cabinetId === cabinetId && !f.hidden);
  const cab = plan.findCabinet(cabinetId);
  const trays = plan.traysForCabinet(cabinetId);
  const unscheduled = !content?.date;
  const layers = (content?.trays?.length ? content.trays : [])
    .slice()
    .sort((a, b) => b.level - a.level)
    .map((t) => {
      const md = trays.find((x) => x.id === t.trayId);
      const names = (t.onTray || []).map((o) => o.stockLineId).join('、') || '空层';
      const cap = trayCapacityM3(md);
      const overChip = trayOverChip(t.vol, cap);
      return { t, md, names, cap, overChip };
    });
  return { cab, unscheduled, layers, content };
});

const modeBanner = computed(() => {
  const id = cabId.value;
  const rt = id ? runtimes.value.find((r) => r.cabinetId === id) : undefined;
  if (rt?.status === 'loadComplete') {
    return {
      cls: plan.scheduleMode === 'manual' ? 'strong-banner danger' : 'strong-banner warn',
      html: groupingLoadCompleteBannerHtml(plan.scheduleMode),
    };
  }
  const content = id ? plan.furnaces.find((f) => f.cabinetId === id && !f.hidden) : undefined;
  const hard = content
    ? validateFurnace(content, plan.ruleCtx(plan.furnaces)).find(
        (i) => i.sev === 'error' && GROUPING_ISSUE_CODES.has(i.code),
      )
    : undefined;
  if (hard) {
    return {
      cls: plan.scheduleMode === 'manual' ? 'strong-banner danger' : 'strong-banner warn',
      html: packConstraintBanner(hard.code, hard.msg),
    };
  }
  return null;
});

const batchIssues = computed(() => {
  const id = cabId.value;
  if (!id) return [];
  const content = plan.furnaces.find((f) => f.cabinetId === id && !f.hidden);
  if (!content) return [];
  return validateFurnace(content, plan.ruleCtx([content])).filter(
    (i) => i.sev === 'error' || GROUPING_ISSUE_CODES.has(i.code),
  );
});

function runtimeHtml(status: RuntimeStatus): string {
  return groupingRuntimeTagsHtml(status);
}

function loadOf(id: string) {
  return plan.furnaces.find((f) => f.cabinetId === id && !f.hidden);
}

function rtOf(id: string) {
  return runtimes.value.find((r) => r.cabinetId === id);
}

function isCabDisabled(id: string): boolean {
  const status = rtOf(id)?.status || 'idle';
  return status === 'sterilizing' || status === 'outOfService';
}

function largeBlocked(line: StockLine): boolean {
  return isLargeDemand(line, plan.config.box.largeBoxVol) && Boolean(packSummary.value?.largeFull);
}

function remBoxes(line: StockLine): number {
  return remainingBoxes(line, plan.furnaces);
}

function remVol(line: StockLine): number {
  return remainingVol(line, plan.furnaces);
}

function onDragStart(ev: DragEvent, line: StockLine): void {
  if (largeBlocked(line)) {
    ev.preventDefault();
    return;
  }
  ev.dataTransfer?.setData('text/plain', line.id);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
}

function onDropShare(ev: DragEvent): void {
  ev.preventDefault();
  const id = ev.dataTransfer?.getData('text/plain');
  if (!id) return;
  const line = plan.poolById(id);
  if (line && largeBlocked(line)) return;
  plan.runDropDemand(id);
}

function issueClass(code: string): string {
  if (code === 'VOL_OVERFLOW') return 'pack-issue pack-issue-vol';
  if (code === 'BOX_LIMIT') return 'pack-issue pack-issue-box';
  return 'hint';
}
</script>

<template>
  <section id="page-grouping" class="page active" style="min-height:0;flex:1;overflow:hidden">
    <div id="grpToolbar" class="grp-toolbar" data-testid="grouping-toolbar">
      <div id="grpEntryTabs" class="shift-tabs">
        <div class="shift-tab" :class="{ active: plan.grpEntry === 'cabinet' }" data-grp-entry="cabinet" @click="plan.grpEntry = 'cabinet'">选柜</div>
        <div class="shift-tab" :class="{ active: plan.grpEntry === 'demand' }" data-grp-entry="demand" @click="plan.grpEntry = 'demand'">选需求</div>
      </div>
      <div id="grpScheduleModeTabs" class="shift-tabs">
        <div class="shift-tab" :class="{ active: plan.scheduleMode === 'auto' }" data-mode="auto" @click="plan.setScheduleMode('auto')">自动排产</div>
        <div class="shift-tab" :class="{ active: plan.scheduleMode === 'manual' }" data-mode="manual" @click="plan.setScheduleMode('manual')">手工调整</div>
      </div>
      <button id="btnAutoPack" class="btn btn-primary" type="button" @click="plan.runAutoPack()">自动组柜</button>
      <button id="btnManualPack" class="btn" type="button" @click="plan.runManualPack()">手动组柜</button>
      <button id="btnLoadComplete" class="btn" type="button" @click="plan.runMarkLoadComplete()">装填完毕</button>
      <span class="hint">组柜按需求行体积 · 无日期/班次 · 完成后未排</span>
    </div>
    <PackPolicyPanel />
    <div id="grpValidationSummary" class="grp-val-summary" data-testid="pack-validation-summary">
      <div class="grp-val-summary-hd">
        <strong>本批校验</strong>
        <span class="hint">{{ batchIssues.length }} 项 · 不占一级菜单</span>
        <RouterLink class="btn btn-sm" to="/release?tab=issues">在结果发布查看</RouterLink>
      </div>
      <div v-if="!batchIssues.length" class="hint">当前柜无本批硬错误；按结果日全量请到结果发布</div>
      <div v-for="i in batchIssues.slice(0, 4)" :key="i.code + (i.furnaceId || '')" :class="issueClass(i.code)" :data-pack-issue="i.code">
        {{ i.code }} · {{ i.msg }}
      </div>
    </div>
    <div
      id="grpModeBanner"
      class="strong-banner"
      :class="modeBanner ? (modeBanner.cls.includes('danger') ? 'danger' : 'warn') : ''"
      :style="{ display: modeBanner ? '' : 'none' }"
      role="alert"
      v-html="modeBanner?.html || ''"
    />
    <div id="grpBody" class="grp-body">
      <div v-if="plan.grpEntry === 'cabinet'" class="grp-cols">
        <div class="grp-col">
          <div class="grp-col-hd">选柜</div>
          <div class="grp-scroll">
            <div
              v-for="c in plan.usableCabinets"
              :key="c.id"
              class="grp-cab"
              :class="{ selected: cabId === c.id, disabled: isCabDisabled(c.id) }"
              :data-grp-cab="c.id"
              @click="plan.selectGroupingCabinet(c.id)"
            >
              <div class="fname">{{ c.displayCode }} <span class="hint">{{ c.canonicalId }}</span></div>
              <div class="sub">{{ c.base }}基地 · 额定 {{ c.ratedLoadM3 }} m³</div>
              <div>
                <span v-html="runtimeHtml(rtOf(c.id)?.status || 'idle')" />
                <span v-if="loadOf(c.id)" class="tag tag-green">{{ Math.floor((loadOf(c.id)!.fillRate || 0) * 100) }}%</span>
                <span v-if="loadOf(c.id) && !loadOf(c.id)!.date" class="tag tag-default">未排</span>
              </div>
            </div>
          </div>
        </div>
        <div class="grp-col">
          <div class="grp-col-hd">完整可进需求</div>
          <div class="grp-scroll">
            <template v-if="cabId">
              <div class="grp-part">
                <div class="grp-part-hd">已进本柜 · {{ groups.inThisCabinet.length }}</div>
                <div v-if="!groups.inThisCabinet.length" class="hint">本柜尚无载荷</div>
                <div
                  v-for="r in groups.inThisCabinet"
                  :key="r.lineId"
                  class="grp-demand"
                  :class="{ selected: plan.grpCheckedDemandIds.includes(r.lineId), 'is-large-blocked': largeBlocked(r.line) }"
                  :data-grp-demand-view="r.lineId"
                  :data-box-limit-blocked="largeBlocked(r.line) ? 'true' : undefined"
                  draggable="true"
                  @dragstart="onDragStart($event, r.line)"
                  @click="plan.focusGroupingDemand(r.lineId)"
                >
                  <input type="checkbox" :data-grp-check="r.lineId" :checked="plan.grpCheckedDemandIds.includes(r.lineId)" :disabled="largeBlocked(r.line)" @click.stop @change="plan.checkGroupingDemand(r.lineId, ($event.target as HTMLInputElement).checked)" />
                  <div>
                    <div><strong class="mono">{{ r.lineId }}</strong> <span v-html="placementChip(r.placement, r.otherCabinetId)" /> {{ r.line.name }}
                      <span v-if="isLargeDemand(r.line, plan.config.box.largeBoxVol)" class="tag tag-orange">大箱</span>
                      <span v-else class="tag tag-default">小箱</span>
                    </div>
                    <div class="sub">余 {{ remBoxes(r.line) }} 箱 / {{ remVol(r.line).toFixed(2) }} m³ · 单箱 {{ r.line.boxVol }} m³ · 交期 {{ r.line.due }}</div>
                    <FactStrip :line="r.line" />
                  </div>
                </div>
              </div>
              <div class="grp-part">
                <div class="grp-part-hd">还可排入 · {{ groups.unassigned.length }}</div>
                <div v-if="!groups.unassigned.length" class="hint">{{ emptyUnassignedHint }}</div>
                <div
                  v-for="r in groups.unassigned"
                  :key="r.lineId"
                  class="grp-demand"
                  :class="{ selected: plan.grpCheckedDemandIds.includes(r.lineId), 'is-large-blocked': largeBlocked(r.line) }"
                  :data-grp-demand-view="r.lineId"
                  :data-box-limit-blocked="largeBlocked(r.line) ? 'true' : undefined"
                  draggable="true"
                  @dragstart="onDragStart($event, r.line)"
                  @click="plan.focusGroupingDemand(r.lineId)"
                >
                  <input type="checkbox" :data-grp-check="r.lineId" :checked="plan.grpCheckedDemandIds.includes(r.lineId)" :disabled="largeBlocked(r.line)" @click.stop @change="plan.checkGroupingDemand(r.lineId, ($event.target as HTMLInputElement).checked)" />
                  <div>
                    <div><strong class="mono">{{ r.lineId }}</strong> <span v-html="placementChip(r.placement, r.otherCabinetId)" /> {{ r.line.name }}
                      <span v-if="isLargeDemand(r.line, plan.config.box.largeBoxVol)" class="tag tag-orange">大箱</span>
                      <span v-else class="tag tag-default">小箱</span>
                    </div>
                    <div class="sub">{{ r.line.boxes }}箱 · {{ r.line.vol }} m³ · 单箱 {{ r.line.boxVol }} m³ · 交期 {{ r.line.due }}</div>
                    <FactStrip :line="r.line" />
                  </div>
                </div>
              </div>
              <div class="grp-part">
                <div class="grp-part-hd">已进其他柜 · {{ groups.inOtherCabinet.length }}</div>
                <div v-if="!groups.inOtherCabinet.length" class="hint">无</div>
                <div
                  v-for="r in groups.inOtherCabinet"
                  :key="r.lineId"
                  class="grp-demand"
                  :data-grp-demand-view="r.lineId"
                  @click="plan.focusGroupingDemand(r.lineId)"
                >
                  <input type="checkbox" :data-grp-check="r.lineId" disabled />
                  <div>
                    <div><strong class="mono">{{ r.lineId }}</strong> <span v-html="placementChip(r.placement, r.otherCabinetId)" /> {{ r.line.name }}</div>
                    <div class="sub">{{ r.line.vol }} m³ · SO {{ r.line.salesOrderNo || r.line.wo }} · 交期 {{ r.line.due }}</div>
                    <FactStrip :line="r.line" />
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="empty"><div class="hint">请选择左侧灭菌柜</div></div>
          </div>
        </div>
        <div class="grp-col">
          <div class="grp-col-hd">装柜（体积口径）</div>
          <div class="grp-scroll">
            <div v-if="!packSummary || !cabId" class="empty"><div class="hint">请选择灭菌柜，按需求行体积装入</div></div>
            <template v-else>
              <div
                class="grp-cab-summary"
                data-testid="pack-volume-summary"
                :class="{ 'is-drop-target': true, 'is-large-full': packSummary.largeFull }"
                @dragover.prevent
                @drop="onDropShare"
              >
                <strong>{{ layer?.cab?.displayCode || cabId }}</strong>
                <span v-if="layer?.unscheduled" class="tag tag-default">未排</span>
                <span v-else class="tag tag-blue">{{ layer?.content?.date }} {{ layer?.content?.shift }}</span>
                <div class="hint" data-testid="pack-fill-rate">装柜率 {{ (packSummary.fillRate * 100).toFixed(0) }}% ＝ {{ packSummary.totalVol.toFixed(1) }} / 额定 {{ packSummary.ratedLoadM3 }} m³</div>
                <div class="progress-bar"><div class="fill" :class="packSummary.fillRate >= 0.56 ? 'ok' : 'low'" :style="{ width: Math.min(100, packSummary.fillRate * 100) + '%' }" /></div>
                <div class="grp-pack-metrics">
                  <span class="tag" :class="packSummary.largeFull ? 'tag-red' : 'tag-blue'" data-testid="pack-large-boxes">大箱 {{ packSummary.largeBoxCount }}/{{ packSummary.maxLarge }}</span>
                  <span class="tag tag-default" data-testid="pack-remaining-vol">剩余体积 {{ packSummary.remainingVol.toFixed(1) }} m³</span>
                </div>
                <div v-if="packSummary.largeFull" class="hint pack-issue-box">大箱已满 280：禁用继续拖入大箱；小箱仍可（体积允许时）</div>
                <div class="hint">拖入需求行分量，不按托盘分拆</div>
              </div>
              <div class="grp-shares" data-testid="pack-stock-shares">
                <div class="grp-part-hd">本炉需求行分量</div>
                <div v-if="!packSummary.shares.length" class="hint">尚无装入分量</div>
                <div v-for="s in packSummary.shares" :key="s.stockLineId" class="grp-share-row" :data-share-line="s.stockLineId">
                  <strong class="mono">{{ s.stockLineId }}</strong>
                  <span>{{ s.boxes }} 箱</span>
                  <span>{{ s.vol.toFixed(2) }} m³</span>
                  <span>{{ s.largeBoxes ? `大箱 ${s.largeBoxes}` : '小箱' }}</span>
                </div>
              </div>
              <details class="grp-trays-optional" :open="showTrays" data-testid="pack-trays-optional">
                <summary @click.prevent="showTrays = !showTrays">托盘层示意（可选，不参与硬约束）</summary>
                <div v-if="!layer?.layers.length" class="hint">未启用托盘层</div>
                <div
                  v-for="l in layer?.layers || []"
                  :key="l.t.trayId"
                  class="grp-layer"
                  :class="{ 'tray-over': !!l.overChip }"
                  :data-tray-over="l.overChip ? 'layer' : undefined"
                >
                  <div class="grp-layer-hd">{{ l.md?.displayName || `第${l.t.level}层` }} · <span class="mono">{{ l.t.trayId }}</span> <span v-html="l.overChip" /></div>
                  <div class="grp-layer-bd">{{ l.names }} · {{ l.t.vol.toFixed(1) }} m³ / 容积 {{ l.cap || '—' }} m³ · {{ l.t.boxes }}箱</div>
                </div>
              </details>
            </template>
          </div>
        </div>
      </div>
      <div v-else class="grp-cols">
        <div class="grp-col">
          <div class="grp-col-hd">选需求 · 单击查看 / 勾选批量</div>
          <div class="grp-scroll">
            <div
              v-for="p in demandPool"
              :key="p.id"
              class="grp-demand"
              :class="{ focused: plan.grpFocusedDemandId === p.id, selected: plan.grpCheckedDemandIds.includes(p.id), 'is-large-blocked': largeBlocked(p) }"
              :data-grp-demand-view="p.id"
              :data-box-limit-blocked="largeBlocked(p) ? 'true' : undefined"
              draggable="true"
              @dragstart="onDragStart($event, p)"
              @click="plan.focusGroupingDemand(p.id)"
            >
              <input type="checkbox" :data-grp-check="p.id" :checked="plan.grpCheckedDemandIds.includes(p.id)" :disabled="largeBlocked(p)" @click.stop @change="plan.checkGroupingDemand(p.id, ($event.target as HTMLInputElement).checked)" />
              <div>
                <div><strong class="mono">{{ p.id }}</strong> {{ p.name }}
                  <span v-if="p.urgent" class="tag tag-urgent">加急</span>
                  <span v-if="isLargeDemand(p, plan.config.box.largeBoxVol)" class="tag tag-orange">大箱</span>
                </div>
                <div class="sub">{{ p.boxes }}箱 · {{ p.vol }} m³ · 单箱 {{ p.boxVol }} · 允许 {{ p.allowed.join(',') }}</div>
                <FactStrip :line="p" />
              </div>
            </div>
          </div>
        </div>
        <div class="grp-col">
          <div class="grp-col-hd">可组柜（允许设备 ∩ 运行态）</div>
          <div class="grp-scroll">
            <div v-if="!candidateCabs.length" class="empty"><div class="hint">单击左侧需求行查看可组柜（不会勾选）</div></div>
            <div
              v-for="r in candidateCabs"
              :key="r.cabinetId"
              class="grp-cab"
              :class="{ selected: plan.grpSelectedCabinetId === r.cabinetId, disabled: !r.selectable }"
              :data-grp-cab="r.cabinetId"
              @click="plan.selectGroupingCabinet(r.cabinetId)"
            >
              <div class="fname">{{ r.cabinet.displayCode }}</div>
              <div v-html="runtimeHtml(r.runtime)" />
              <div v-if="r.disabledReason" class="hint">{{ r.disabledReason }}</div>
            </div>
          </div>
        </div>
        <div class="grp-col">
          <div class="grp-col-hd">装柜（体积口径）</div>
          <div class="grp-scroll">
            <div v-if="!packSummary || !cabId" class="empty"><div class="hint">请选择灭菌柜或需求以查看装柜体积</div></div>
            <template v-else>
              <div class="grp-cab-summary" data-testid="pack-volume-summary" @dragover.prevent @drop="onDropShare">
                <strong>{{ layer?.cab?.displayCode || cabId }}</strong>
                <span v-if="layer?.unscheduled" class="tag tag-default">未排</span>
                <div class="hint">装柜率 {{ (packSummary.fillRate * 100).toFixed(0) }}%</div>
                <div class="progress-bar"><div class="fill" :class="packSummary.fillRate >= 0.56 ? 'ok' : 'low'" :style="{ width: Math.min(100, packSummary.fillRate * 100) + '%' }" /></div>
                <div class="grp-pack-metrics">
                  <span class="tag" :class="packSummary.largeFull ? 'tag-red' : 'tag-blue'" data-testid="pack-large-boxes">大箱 {{ packSummary.largeBoxCount }}/{{ packSummary.maxLarge }}</span>
                  <span class="tag tag-default">剩余 {{ packSummary.remainingVol.toFixed(1) }} m³</span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
