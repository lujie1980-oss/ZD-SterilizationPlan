import type { Cabinet, CabinetContent, CabinetRuntime, RuntimeStatus } from './entities';

export function deriveCabinetRuntime(opts: {
  cabinet: Cabinet;
  contents: CabinetContent[];
  override?: CabinetRuntime;
}): CabinetRuntime {
  if (opts.override?.source === 'manual' || opts.override?.source === 'equipment') {
    return { ...opts.override, cabinetId: opts.cabinet.id };
  }
  if (opts.cabinet.status === '报废') {
    return {
      cabinetId: opts.cabinet.id,
      status: 'outOfService',
      source: 'derived',
    };
  }
  const loads = opts.contents.filter((c) => c.cabinetId === opts.cabinet.id && !c.hidden);
  if (loads.some((c) => c.status === 'inSterilization') || opts.override?.status === 'sterilizing') {
    const hit = loads.find((c) => c.status === 'inSterilization');
    return {
      cabinetId: opts.cabinet.id,
      status: 'sterilizing',
      activeEntryLoadId: hit?.id,
      source: opts.override?.source ?? 'derived',
    };
  }
  const complete = loads.find((c) => c.loadComplete && c.scheduleStatus !== 'closed' as string);
  if (complete) {
    return {
      cabinetId: opts.cabinet.id,
      status: 'loadComplete',
      activeLoadId: complete.id,
      source: 'derived',
    };
  }
  const loading = loads.find((c) => c.status === 'draft' || c.status === 'active');
  if (loading && loading.lines.length) {
    return {
      cabinetId: opts.cabinet.id,
      status: 'loading',
      activeLoadId: loading.id,
      source: 'derived',
    };
  }
  return {
    cabinetId: opts.cabinet.id,
    status: 'idle',
    source: 'derived',
  };
}

export function deriveAllRuntimes(
  cabinets: Cabinet[],
  contents: CabinetContent[],
  overrides: CabinetRuntime[] = [],
): CabinetRuntime[] {
  const map = new Map(overrides.map((r) => [r.cabinetId, r]));
  return cabinets.map((cab) => deriveCabinetRuntime({ cabinet: cab, contents, override: map.get(cab.id) }));
}

export function runtimeLabel(status: RuntimeStatus): string {
  switch (status) {
    case 'idle':
      return '空闲';
    case 'loading':
      return '装填中';
    case 'loadComplete':
      return '装填完毕';
    case 'sterilizing':
      return '灭菌中';
    case 'outOfService':
      return '停用';
    default:
      return status;
  }
}

/** 演示：柜14 正在灭菌，用于禁用可见 */
export function demoRuntimeOverrides(): CabinetRuntime[] {
  return [
    {
      cabinetId: '柜14',
      status: 'sterilizing',
      source: 'manual',
      sterilizeStartedAt: '2026-07-24T08:00:00',
    },
  ];
}
