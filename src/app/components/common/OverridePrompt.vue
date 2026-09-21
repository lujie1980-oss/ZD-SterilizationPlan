<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePlanStore } from '../../stores/planStore';
import { useUiStore } from '../../stores/uiStore';

const plan = usePlanStore();
const ui = useUiStore();
const note = ref('');

watch(
  () => ui.overridePrompt?.furnaceId,
  (id) => {
    note.value = id ? plan.config.overrideNotes?.[id] || '' : '';
  },
);

const errMsgs = computed(() =>
  (ui.overridePrompt?.issues || [])
    .filter((i) => i.sev === 'error')
    .map((i) => i.msg)
    .join('\n') || '存在硬错误',
);

function skip(): void {
  ui.closeOverride();
}

function save(): void {
  if (ui.overridePrompt) {
    plan.saveOverrideNote(ui.overridePrompt.furnaceId, note.value.trim());
    ui.toast(note.value.trim() ? '已保存违例原因' : '未填写原因，已保持保存结果', 'info');
  }
  ui.closeOverride();
}
</script>

<template>
  <div v-if="ui.overridePrompt" class="modal-mask">
    <div class="modal">
      <div class="modal-hd">
        <span>手工违例 · {{ ui.overridePrompt.furnaceId }}</span>
        <button class="modal-close" type="button" @click="skip">×</button>
      </div>
      <div class="modal-bd">
        <div class="strong-banner danger" style="margin-bottom:12px">已按手工调整保存。建议填写违例原因（可不填，不阻断）。</div>
        <p style="margin-bottom:8px;white-space:pre-line">{{ errMsgs }}</p>
        <label class="label">违例原因（建议填写）</label>
        <textarea id="overrideNoteInput" v-model="note" class="input" style="width:100%;height:80px;margin-top:6px" />
      </div>
      <div class="modal-ft">
        <button class="btn" type="button" data-act="skip" @click="skip">跳过</button>
        <button class="btn btn-primary" type="button" data-act="save" @click="save">保存原因</button>
      </div>
    </div>
  </div>
</template>
