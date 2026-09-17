<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { CABINETS, cabinetById, traysForCabinet, usableCabinets } from '../../data/seed-cabinets';
import { trayCapacityM3 } from '../../domain/cabinet-content';
import { listCandidateCabinets, listEligibleForCabinet } from '../../domain/grouping';
import { validateFurnace } from '../../domain/rule-engine';
import type { EligibleDemandRow, RuntimeStatus } from '../../domain/entities';
import FactStrip from '../components/facts/FactStrip.vue';
import PackPolicyPanel from '../components/pack/PackPolicyPanel.vue';
import {
  groupingLoadCompleteBannerHtml,
  groupingRuntimeTagsHtml,
  placementChip,
  trayOverChip,
} from '../components/pack/grouping-contract';
import { usePlanStore } from '../stores/planStore';

const GROUPING_ISSUE_CODES = new Set(['REPACK_AFTER_LOAD_COMPLETE', 'ON_TRAY_QTY_OVERFLOW', 'TRAY_OVERFLOW']);

const plan = usePlanStore();
onMounted(() => plan.enterGrouping());

const runtimes = computed(() => plan.currentRuntimes());
const cabId = computed(() => plan.grpSelectedCabinetId);

const eligibleRows = computed((): EligibleDemandRow[] => {
  if (!cabId.value) return [];
  return listEligibleForCabinet({
    cabinetId: cabId.value,
    pool: plan.eligiblePool(),
    contents: plan.furnaces,
    cabinets: CABINETS,
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
    cabinets: CABINETS,
    runtimes: runtimes.value,
  });
});

const layer = computed(() => {
  const cabinetId = cabId.value;
  if (!cabinetId) return null;
  const content = plan.furnaces.find((f) => f.cabinetId === cabinetId && !f.hidden);
  const cab = cabinetById(cabinetId);
  const trays = traysForCabinet(cabinetId);
  const fill = content?.fillRate ?? 0;
  const unscheduled = !content?.date;
  const layers = (
    content?.trays?.length
      ? content.trays
      : trays.map((t) => ({
          trayId: t.id,
          level: t.level,
          vol: 0,
          boxes: 0,
          largeBoxes: 0,
          onTray: [] as { stockLineId: string }[],
          id: t.id,
          contentId: '',
        }))
  )
    .slice()
    .sort((a, b) => b.level - a.level)
    .map((t) => {
      const md = trays.find((x) => x.id === t.trayId);
      const names = (t.onTray || []).map((o) => o.stockLineId).join('、') || '空层';
      const cap = trayCapacityM3(md);
      const overChip = trayOverChip(t.vol, cap);
      return { t, md, names, cap, overChip };
    });
  return { cab, fill, unscheduled, layers, content };
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
      html: hard.msg,
    };
  }
  return null;
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
      <span class="hint">组柜不按结果日或班次筛选 · 完成后未排</span>
    </div>
    <PackPolicyPanel />
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
              v-for="c in usableCabinets()"
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
                  :class="{ selected: plan.grpCheckedDemandIds.includes(r.lineId) }"
                  :data-grp-demand-view="r.lineId"
                  @click="plan.focusGroupingDemand(r.lineId)"
                >
                  <input type="checkbox" :data-grp-check="r.lineId" :checked="plan.grpCheckedDemandIds.includes(r.lineId)" @click.stop @change="plan.checkGroupingDemand(r.lineId, ($event.target as HTMLInputElement).checked)" />
                  <div>
                    <div><strong class="mono">{{ r.lineId }}</strong> <span v-html="placementChip(r.placement, r.otherCabinetId)" /> {{ r.line.name }}</div>
                    <div class="sub">{{ r.line.vol }} m³ · SO {{ r.line.salesOrderNo || r.line.wo }} · {{ r.line.dimL || '—' }}×{{ r.line.dimW || '—' }}×{{ r.line.dimH || '—' }} · 交期 {{ r.line.due }}</div>
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
                  :class="{ selected: plan.grpCheckedDemandIds.includes(r.lineId) }"
                  :data-grp-demand-view="r.lineId"
                  @click="plan.focusGroupingDemand(r.lineId)"
                >
                  <input type="checkbox" :data-grp-check="r.lineId" :checked="plan.grpCheckedDemandIds.includes(r.lineId)" @click.stop @change="plan.checkGroupingDemand(r.lineId, ($event.target as HTMLInputElement).checked)" />
                  <div>
                    <div><strong class="mono">{{ r.lineId }}</strong> <span v-html="placementChip(r.placement, r.otherCabinetId)" /> {{ r.line.name }}</div>
                    <div class="sub">{{ r.line.vol }} m³ · SO {{ r.line.salesOrderNo || r.line.wo }} · {{ r.line.dimL || '—' }}×{{ r.line.dimW || '—' }}×{{ r.line.dimH || '—' }} · 交期 {{ r.line.due }}</div>
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
                    <div class="sub">{{ r.line.vol }} m³ · SO {{ r.line.salesOrderNo || r.line.wo }} · {{ r.line.dimL || '—' }}×{{ r.line.dimW || '—' }}×{{ r.line.dimH || '—' }} · 交期 {{ r.line.due }}</div>
                    <FactStrip :line="r.line" />
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="empty"><div class="hint">请选择左侧灭菌柜</div></div>
          </div>
        </div>
        <div class="grp-col">
          <div class="grp-col-hd">分层 → 装柜</div>
          <div class="grp-scroll">
            <div v-if="!layer" class="empty"><div class="hint">请选择灭菌柜或需求以查看分层 → 装柜</div></div>
            <template v-else>
              <div v-if="plan.grpLayerHint" class="grp-steps"><span class="tag tag-blue">① 分层</span> → <span class="tag tag-green">② 装柜</span></div>
              <div v-else class="hint">组柜过程：先分层（托盘主数据）再装柜</div>
              <div class="grp-cab-summary">
                <strong>{{ layer.cab?.displayCode || cabId }}</strong>
                <span v-if="layer.unscheduled" class="tag tag-default">未排</span>
                <span v-else class="tag tag-blue">{{ layer.content?.date }} {{ layer.content?.shift }}</span>
                <div class="hint">装柜率 {{ (layer.fill * 100).toFixed(0) }}% ＝ 已装体积 / 额定 {{ layer.cab?.ratedLoadM3 ?? '—' }} m³</div>
                <div class="progress-bar"><div class="fill" :class="layer.fill >= 0.56 ? 'ok' : 'low'" :style="{ width: Math.min(100, layer.fill * 100) + '%' }" /></div>
              </div>
              <div class="grp-layers">
                <div
                  v-for="l in layer.layers"
                  :key="l.t.trayId"
                  class="grp-layer"
                  :class="{ 'tray-over': !!l.overChip }"
                  :data-tray-over="l.overChip ? 'layer' : undefined"
                >
                  <div class="grp-layer-hd">{{ l.md?.displayName || `第${l.t.level}层` }} · <span class="mono">{{ l.t.trayId }}</span> <span v-html="l.overChip" /></div>
                  <div class="grp-layer-bd">{{ l.names }} · {{ l.t.vol.toFixed(1) }} m³ / 容积 {{ l.cap || '—' }} m³ · {{ l.t.boxes }}箱</div>
                </div>
                <div v-if="!layer.layers.length" class="hint">尚无托盘装载</div>
              </div>
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
              :class="{ focused: plan.grpFocusedDemandId === p.id, selected: plan.grpCheckedDemandIds.includes(p.id) }"
              :data-grp-demand-view="p.id"
              @click="plan.focusGroupingDemand(p.id)"
            >
              <input type="checkbox" :data-grp-check="p.id" :checked="plan.grpCheckedDemandIds.includes(p.id)" @click.stop @change="plan.checkGroupingDemand(p.id, ($event.target as HTMLInputElement).checked)" />
              <div>
                <div><strong class="mono">{{ p.id }}</strong> {{ p.name }} <span v-if="p.urgent" class="tag tag-urgent">加急</span></div>
                <div class="sub">{{ p.vol }} m³ · SO {{ p.salesOrderNo || p.wo }} · {{ p.dimL || '—' }}×{{ p.dimW || '—' }}×{{ p.dimH || '—' }} · 允许 {{ p.allowed.join(',') }}</div>
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
          <div class="grp-col-hd">分层 → 装柜</div>
          <div class="grp-scroll">
            <div v-if="!layer" class="empty"><div class="hint">请选择灭菌柜或需求以查看分层 → 装柜</div></div>
            <template v-else>
              <div class="grp-cab-summary">
                <strong>{{ layer.cab?.displayCode || cabId }}</strong>
                <span v-if="layer.unscheduled" class="tag tag-default">未排</span>
                <div class="hint">装柜率 {{ (layer.fill * 100).toFixed(0) }}%</div>
                <div class="progress-bar"><div class="fill" :class="layer.fill >= 0.56 ? 'ok' : 'low'" :style="{ width: Math.min(100, layer.fill * 100) + '%' }" /></div>
              </div>
              <div
                v-for="l in layer.layers"
                :key="'d-' + l.t.trayId"
                class="grp-layer"
                :class="{ 'tray-over': !!l.overChip }"
                :data-tray-over="l.overChip ? 'layer' : undefined"
              >
                <div class="grp-layer-hd">{{ l.md?.displayName || `第${l.t.level}层` }} · <span class="mono">{{ l.t.trayId }}</span> <span v-html="l.overChip" /></div>
                <div class="grp-layer-bd">{{ l.names }} · {{ l.t.vol.toFixed(1) }} m³ / 容积 {{ l.cap || '—' }} m³ · {{ l.t.boxes }}箱</div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
