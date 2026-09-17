import { defineStore } from 'pinia';
import type { ValidationIssue } from '../../domain/entities';

export type ToastType = 'success' | 'error' | 'warn' | 'info';

export interface ToastItem {
  id: number;
  msg: string;
  type: ToastType;
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarCollapsed: false,
    toasts: [] as ToastItem[],
    nextToastId: 1,
    factLineId: null as string | null,
    overridePrompt: null as { furnaceId: string; issues: ValidationIssue[] } | null,
    splitOpen: false,
  }),
  actions: {
    toast(msg: string, type: ToastType = 'success'): void {
      const id = this.nextToastId++;
      this.toasts.push({ id, msg, type });
      window.setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, 2800);
    },
    openFact(lineId: string): void {
      this.factLineId = lineId;
    },
    closeFact(): void {
      this.factLineId = null;
    },
    openOverride(furnaceId: string, issues: ValidationIssue[]): void {
      this.overridePrompt = { furnaceId, issues };
    },
    closeOverride(): void {
      this.overridePrompt = null;
    },
    openSplit(): void {
      this.splitOpen = true;
    },
    closeSplit(): void {
      this.splitOpen = false;
    },
    toggleSidebar(): void {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    },
  },
});
