<script setup lang="ts">
import { useUiStore } from '../../stores/uiStore';

const ui = useUiStore();
const icon = (t: string) => (t === 'success' ? '✓' : t === 'error' ? '✕' : 'ℹ');
</script>

<template>
  <div id="toastContainer" class="toast-container">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.type">
      <span>{{ icon(t.type) }}</span>
      <span>{{ t.msg }}</span>
    </div>
  </div>
</template>
