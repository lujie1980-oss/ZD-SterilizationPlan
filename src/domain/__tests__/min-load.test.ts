import { describe, expect, it } from 'vitest';
import { defaultAppConfig, mergeConfig, persistableConfig } from '../../data/config-defaults';
import { PROCESSES } from '../../data/seed-processes';
import { effectiveMinLoadM3, setProcessMinLoad } from '../min-load';

describe('effectiveMinLoadM3 (v1.2)', () => {
  it('defaults D002 to 56 from minLoadM3ByProcess / Process.minLoadM3', () => {
    expect(effectiveMinLoadM3('D002', defaultAppConfig(), PROCESSES)).toBe(56);
  });

  it('lets config.minLoadM3ByProcess override Process.minLoadM3', () => {
    const config = setProcessMinLoad(defaultAppConfig(), 'D002', 30);
    expect(config.minLoadM3ByProcess.D002).toBe(30);
    expect(config.d002MinLoadM3).toBe(30);
    expect(effectiveMinLoadM3('D002', config, PROCESSES)).toBe(30);
    expect(PROCESSES.find((p) => p.code === 'D002')?.minLoadM3).toBe(56);
  });

  it('falls back to Process.minLoadM3 when the process is absent from the map', () => {
    const config = defaultAppConfig();
    config.minLoadM3ByProcess = {};
    delete config.d002MinLoadM3;
    expect(effectiveMinLoadM3('D002', config, PROCESSES)).toBe(56);
  });

  it('falls back to d002MinLoadM3 before Process.minLoadM3 when the map has no D002', () => {
    const config = defaultAppConfig();
    config.minLoadM3ByProcess = {};
    config.d002MinLoadM3 = 40;
    expect(effectiveMinLoadM3('D002', config, PROCESSES)).toBe(40);
  });

  it('uses load.defaultMinM3 for processes without Process.minLoadM3 or map entry', () => {
    const config = defaultAppConfig();
    expect(effectiveMinLoadM3('手术衣', config, PROCESSES)).toBe(60);
  });
});

describe('minLoadM3ByProcess migration', () => {
  it('migrates legacy d002MinLoadM3 into minLoadM3ByProcess.D002', () => {
    const cfg = mergeConfig({ d002MinLoadM3: 40 });
    expect(cfg.minLoadM3ByProcess.D002).toBe(40);
    expect(cfg.d002MinLoadM3).toBe(40);
    expect(effectiveMinLoadM3('D002', cfg, PROCESSES)).toBe(40);
  });

  it('migrates unofficial load.d002MinM3 leftover into the map', () => {
    const cfg = mergeConfig({ load: { d002MinM3: 33 } as never });
    expect(cfg.minLoadM3ByProcess.D002).toBe(33);
  });

  it('lets canonical minLoadM3ByProcess win over d002MinLoadM3', () => {
    const cfg = mergeConfig({ minLoadM3ByProcess: { D002: 28 }, d002MinLoadM3: 99 });
    expect(cfg.minLoadM3ByProcess.D002).toBe(28);
    expect(effectiveMinLoadM3('D002', cfg, PROCESSES)).toBe(28);
  });

  it('writes both canonical and legacy fields for prototype round-trip', () => {
    const persisted = persistableConfig(setProcessMinLoad(defaultAppConfig(), 'D002', 45));
    expect(persisted.minLoadM3ByProcess).toEqual({ D002: 45 });
    expect(persisted.d002MinLoadM3).toBe(45);
  });

  it('strips unofficial load.d002MinM3 after migrating it into the map', () => {
    const cfg = mergeConfig({ load: { d002MinM3: 33, defaultMinM3: 60 } as never });
    expect(cfg.minLoadM3ByProcess.D002).toBe(33);
    expect((cfg.load as { d002MinM3?: number }).d002MinM3).toBeUndefined();
    const persisted = persistableConfig(cfg);
    expect((persisted.load as { d002MinM3?: number }).d002MinM3).toBeUndefined();
    expect(persisted.minLoadM3ByProcess.D002).toBe(33);
    expect(persisted.d002MinLoadM3).toBe(33);
  });
});
