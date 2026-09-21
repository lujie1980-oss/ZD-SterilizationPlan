<script setup lang="ts">
import { computed } from 'vue';
import { usePlanStore } from '../../stores/planStore';

const plan = usePlanStore();
const preview = computed(() => plan.masterImport);
const canConfirm = computed(() => !!preview.value?.report.ok);

function close(): void {
  plan.cancelMasterImport();
}

function confirm(): void {
  if (!canConfirm.value) return;
  plan.confirmMasterImport();
}
</script>

<template>
  <div v-if="preview" class="drawer-mask" @click.self="close">
    <aside id="masterImportDrawer" class="drawer master-import-drawer" role="dialog" aria-labelledby="masterImportTitle">
      <div class="drawer-hd">
        <span id="masterImportTitle">导入预览 · {{ preview.entity }}</span>
        <button class="modal-close" type="button" @click="close">×</button>
      </div>
      <div class="drawer-bd">
        <p>
          全量校验后再写入；任一硬错误则确认禁用、整批不写入。建议先导入灭菌柜，再导入托盘/工艺，最后箱规。
        </p>
        <p>
          行 {{ preview.rows.filter((r) => !r.__example).length }} · 错误
          <strong class="err-n">{{ preview.report.errors.length }}</strong>
          · 警告 {{ preview.report.warnings.length }}
        </p>
        <h4>错误</h4>
        <div v-if="!preview.report.errors.length" class="hint">无硬错误</div>
        <table v-else class="data">
          <thead>
            <tr><th>行号</th><th>字段</th><th>错误码</th><th>原因</th></tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in preview.report.errors" :key="'e-' + i">
              <td>{{ e.line || '—' }}</td>
              <td class="mono">{{ e.field || '—' }}</td>
              <td><span class="tag tag-red">{{ e.code }}</span></td>
              <td>{{ e.reason }}</td>
            </tr>
          </tbody>
        </table>
        <h4>警告</h4>
        <div v-if="!preview.report.warnings.length" class="hint">无警告</div>
        <table v-else class="data">
          <thead>
            <tr><th>行号</th><th>字段</th><th>原因</th></tr>
          </thead>
          <tbody>
            <tr v-for="(w, i) in preview.report.warnings" :key="'w-' + i">
              <td>{{ w.line || '—' }}</td>
              <td class="mono">{{ w.field || '—' }}</td>
              <td>{{ w.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="modal-ft">
        <button class="btn" type="button" @click="close">取消</button>
        <button
          id="btnMasterConfirmImport"
          class="btn btn-primary"
          type="button"
          :disabled="!canConfirm"
          @click="confirm"
        >
          确认导入
        </button>
      </div>
    </aside>
  </div>
</template>
