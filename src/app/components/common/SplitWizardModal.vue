<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePlanStore } from '../../stores/planStore';
import { useUiStore } from '../../stores/uiStore';

const plan = usePlanStore();
const ui = useUiStore();
const line = computed(() => (ui.splitOpen ? plan.findSplitLine() : undefined));
const boxesA = ref(1);
const cabinetId = ref('');

watch(
  () => line.value?.id,
  () => {
    if (!line.value) return;
    boxesA.value = Math.ceil(line.value.boxes / 2);
    cabinetId.value = line.value.allowed.find((c) => {
      const cab = plan.findCabinet(c);
      return cab && cab.status !== '报废';
    }) || '';
  },
);

const boxesB = computed(() => (line.value ? line.value.boxes - boxesA.value : 0));

function close(): void {
  ui.closeSplit();
}

function ok(): void {
  if (!line.value) return;
  if (!cabinetId.value) {
    ui.toast('请选择目标灭菌柜（允许列表 ∩ 柜台账）', 'warn');
    return;
  }
  let a = boxesA.value;
  if (a < 1) a = 1;
  if (a > line.value.boxes - 1) a = line.value.boxes - 1;
  plan.confirmSplit(line.value, a, cabinetId.value);
  close();
}
</script>

<template>
  <div v-if="ui.splitOpen && line" class="modal-mask" @click.self="close">
    <div class="modal">
      <div class="modal-hd">
        <span>拆炉向导 · {{ line.id }}</span>
        <button class="modal-close" type="button" @click="close">×</button>
      </div>
      <div class="modal-bd">
        <p style="margin-bottom:12px">将大单 <strong>{{ line.name }}</strong>（{{ line.boxes }}箱 / {{ line.vol }}m³）拆为两炉载荷。</p>
        <div class="config-bar" style="margin-bottom:12px">
          <span class="tag tag-pending">待确认</span>
          <span>拆炉虚拟行写入 plan v2.virtualLines，刷新可还原；不回写库存。</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div class="stat-box">
            <div class="lbl">炉次 A 箱数</div>
            <input id="splitA" v-model.number="boxesA" class="input" type="number" :min="1" :max="line.boxes - 1" style="width:100%;margin-top:6px;font-size:18px;font-weight:600" />
          </div>
          <div class="stat-box">
            <div class="lbl">炉次 B 箱数</div>
            <div id="splitBLabel" class="num" style="margin-top:6px">{{ boxesB }}</div>
          </div>
        </div>
        <div style="margin-bottom:8px">
          <span class="label">目标灭菌柜</span>
          <select id="splitCab" v-model="cabinetId" class="select" style="width:100%;margin-top:4px">
            <option v-for="c in line.allowed" :key="c" :value="c" :disabled="!plan.findCabinet(c) || plan.findCabinet(c)?.status === '报废'">
              {{ c }}{{ plan.findCabinet(c) ? `（${plan.findCabinet(c)!.base}基地 · ${plan.findCabinet(c)!.capacity}m³）` : '（主数据缺失）' }}
            </option>
          </select>
        </div>
        <p class="hint">
          单箱体积 {{ line.boxVol }} m³ · 工艺 {{ line.process }}
          <template v-if="line.boxVol >= plan.config.box.largeBoxVol">
            · <span class="tag tag-pending">大箱（单箱≥{{ plan.config.box.largeBoxVol }}）合计 ≤{{ plan.config.box.maxBoxesWhenLarge }}箱/炉</span>
          </template>
        </p>
      </div>
      <div class="modal-ft">
        <button class="btn" type="button" data-act="cancel" @click="close">取消</button>
        <button class="btn btn-primary" type="button" data-act="ok" @click="ok">确认拆炉并分配</button>
      </div>
    </div>
  </div>
</template>
