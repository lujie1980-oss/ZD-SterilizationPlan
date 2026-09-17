<script setup lang="ts">
import AppShell from './app/layouts/AppShell.vue';
import { usePlanStore } from './app/stores/planStore';

const plan = usePlanStore();
if (!plan.ready) plan.hydrate();
</script>

<template>
  <AppShell v-if="plan.ready" />
</template>
