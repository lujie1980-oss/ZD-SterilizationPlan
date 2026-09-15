# 合入后冒烟记录 · main `3cf7d3e`

- **对象 SHA**：`3cf7d3ef70f90b638dd5720584147d00130c5ed6`（`Merge pull request #1`）
- **核对日**：2026-09-15
- **环境**：Node v22.14.0 / npm 10.9.7
- **结论**：**通过** — `npm test` **7 files / 59 tests** 全过；`npm run build` 成功（`tsc --noEmit` + Vite 22 modules）。

本记录仅报告合入后状态，**未改业务代码**。

## 1. HEAD

| 项 | 结果 |
|---|---|
| 冒烟检出点 | `3cf7d3ef70f90b638dd5720584147d00130c5ed6` |
| `origin/main` | 同 SHA（已包含该 merge） |
| 祖先关系 | `3cf7d3e` ⊆ 当前 HEAD |

## 2. 命令结果

```text
npm install
  added 89 packages, audited 90 packages in 1s
  exit 0
  （npm audit：2 moderate；未作为本冒烟失败项）

npm test
  Test Files  7 passed (7)
  Tests       59 passed (59)
  Duration    1.48s
  exit 0

npm run build
  tsc --noEmit && vite build
  ✓ 22 modules transformed
  dist/index.html                 14.68 kB
  dist/assets/index-mQdRk4En.css  16.35 kB
  dist/assets/index-CRR_J0JH.js   54.93 kB
  ✓ built in 245ms
  exit 0
```

相关单测文件均在全量 `vitest run` 中通过：`min-load.test.ts`（10）、`rule-engine.test.ts`（21）、`plan-store.test.ts`（9）、`split-wizard.test.ts`（5）。

## 3. 抽查项

### D1 · `config.minLoadM3ByProcess` 覆盖 `Process.minLoadM3`

- 源码：`src/domain/min-load.ts` 中 `effectiveMinLoadM3` 优先读 `config.minLoadM3ByProcess[processCode]`，再回退 `d002MinLoadM3` / `Process.minLoadM3`。
- `RuleEngine` 用该生效阈值发 `D002_MIN`（`src/domain/rule-engine.ts`）。
- 单测：`min-load.test.ts`「lets config.minLoadM3ByProcess override Process.minLoadM3」（map=30 而 `PROCESSES.D002.minLoadM3` 仍为 56）；`rule-engine.test.ts`「D002_MIN uses effective threshold from config.minLoadM3ByProcess」。

**抽查：满足。**

### BOX_LIMIT 口径 2 · 只计 ≥0.12 大箱箱数合计 >280

- 默认：`largeBoxVol = 0.12`，`maxBoxesWhenLarge = 280`（`src/data/config-defaults.ts`）。
- 计数：`largeBoxCount` 仅累加 `boxVol >= largeBoxVol` 的 `boxes`（`src/domain/pool.ts`）；炉总箱数不触发。
- 触发：`largeBoxes > maxBoxesWhenLarge` 才发 `BOX_LIMIT`（`src/domain/rule-engine.ts`）。
- 单测覆盖：超限触发；等于 280 不触发；混装大箱≤280 + 小箱把炉总拉到 500–700 不触发；纯小箱 >280 不触发；跨行大箱合计 300 触发且文案不含总箱 500。

**抽查：满足。**

### virtualLines / 拆炉 rehydrate

- 持久化：plan v2 一等字段 `virtualLines`；`loadPlan` 在有虚拟行时调用 `ensureSplitFurnaces`（`src/persistence/plan-store-v2.ts`）。
- 池合并：`mergeVirtualLinesIntoPool`；稀疏重种对拆炉会话豁免（`hasPersistedSplitWork`）。
- 单测存在且已通过：`plan-store.test.ts` round-trip / 稀疏快照保留拆炉 / 从 `virtualLines` 补回 `*-A`/`*-B`；`split-wizard.test.ts`「rehydrates virtualLines into the pool」「restores missing *-A/*-B furnaces from virtualLines」。

**抽查：满足。**

## 4. 风险（冒烟边界）

- **未做浏览器/硬刷新 E2E**：拆炉 F5 还原、工作台改 D002 阈值后即时校验，仅由单测与源码路径覆盖。
- **演示稀疏重种**仍依赖 `VITE_ENABLE_DEMO_SEED`；生产关种子后的 UI 路径本次未点。
- `npm audit` 有 2 个 moderate（开发依赖树），与本次合入功能无直接对应，未阻断冒烟。
- 本 PR **只增加本记录**，不修改 `src/`。
