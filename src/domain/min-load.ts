import type { AppConfig, Process } from './entities';

function finiteNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 生效拼载（方案 v1.2）：
 * config.minLoadM3ByProcess 覆盖 Process.minLoadM3；D002 旧字段 d002MinLoadM3 作为配置侧回退。
 */
export function effectiveMinLoadM3(
  processCode: string,
  config: AppConfig,
  processes: Process[],
): number {
  const fromConfig = finiteNumber(config.minLoadM3ByProcess?.[processCode]);
  if (fromConfig != null) return fromConfig;
  if (processCode === 'D002') {
    const legacy = finiteNumber(config.d002MinLoadM3);
    if (legacy != null) return legacy;
  }
  const proc = processes.find((p) => p.code === processCode);
  if (proc?.minLoadM3 != null && Number.isFinite(proc.minLoadM3)) return proc.minLoadM3;
  if (processCode === 'D002') return 56;
  return config.load.defaultMinM3;
}

export function setProcessMinLoad(config: AppConfig, processCode: string, value: number): AppConfig {
  const minLoadM3ByProcess = { ...config.minLoadM3ByProcess, [processCode]: value };
  return {
    ...config,
    minLoadM3ByProcess,
    d002MinLoadM3: processCode === 'D002' ? value : minLoadM3ByProcess.D002 ?? config.d002MinLoadM3,
  };
}
