<script setup lang="ts">
import { ref } from 'vue';
import type { BoxSpec, Cabinet, CustomerRule, Process, Tray } from '../../../domain/entities';
import type { MasterEntity } from '../../../domain/master-data-io';
import { usePlanStore } from '../../stores/planStore';

const props = withDefaults(
  defineProps<{
    entity: MasterEntity;
    allowImport?: boolean;
    slice?: Cabinet[] | Tray[] | Process[] | BoxSpec[] | CustomerRule[];
  }>(),
  { allowImport: true },
);

const plan = usePlanStore();
const fileEl = ref<HTMLInputElement | null>(null);

function exportFile(format: 'csv' | 'xlsx'): void {
  plan.downloadMasterExport(props.entity, format, props.slice);
}

function templateFile(format: 'csv' | 'xlsx'): void {
  plan.downloadMasterTemplate(props.entity, format);
}

function openImport(): void {
  fileEl.value?.click();
}

async function onFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const format = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
  const buf = new Uint8Array(await file.arrayBuffer());
  plan.previewMasterImport(props.entity, buf, format);
}
</script>

<template>
  <div class="master-io-bar" data-testid="master-io-bar">
    <button id="btnMasterExportCsv" class="btn btn-sm" type="button" @click="exportFile('csv')">导出 CSV</button>
    <button id="btnMasterExportXlsx" class="btn btn-sm" type="button" @click="exportFile('xlsx')">导出 XLSX</button>
    <template v-if="allowImport">
      <button id="btnMasterTemplateCsv" class="btn btn-sm" type="button" @click="templateFile('csv')">下载模板 CSV</button>
      <button id="btnMasterTemplateXlsx" class="btn btn-sm" type="button" @click="templateFile('xlsx')">下载模板 XLSX</button>
      <button id="btnMasterImport" class="btn btn-sm btn-primary" type="button" @click="openImport">导入</button>
      <input ref="fileEl" class="master-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="onFile" />
    </template>
    <button
      v-else
      id="btnMasterImport"
      class="btn btn-sm"
      type="button"
      disabled
      title="P1"
      style="display: none"
    >
      导入
    </button>
  </div>
</template>
