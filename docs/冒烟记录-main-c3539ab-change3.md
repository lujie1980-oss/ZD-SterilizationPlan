# 合入后冒烟：main tip `c3539ab`（含变更-3 PR #15）

| 项 | 内容 |
|----|------|
| 日期 | 2026-09-16 |
| 被测提交 | `c3539ab9e767cb5beaa62afcfddbdbba295dcd5c`（`Merge pull request #16`，验收报告合入；含 [PR #15](https://github.com/lujie1980-oss/ZD-SterilizationPlan/pull/15) `d0d78d1`） |
| 范围 | **合入后冒烟**：HEAD 核对 + `npm install` / `npm test` / `npm run build` + 默认策略 / C3 单测 / 硬约束铁律抽查 |
| 本轮改动 | **未改业务功能代码**；仅本冒烟记录 |

## 一句话结论

**通过。** `c3539ab`（含变更-3 PR #15）HEAD 核对成立；`npm test` **14 files / 157 passed**，`npm run build` **退出码 0**（vite 30 modules / 307ms）；默认 `packSuggestPolicy` 仍为 fillOneFirst@80% + 窗 3 天 + 交期簇关；C3 单测 19 条全绿；BOX_LIMIT 口径2 / TRAY_OVERFLOW / 双模式 / 组柜无 Task 未回退。未做浏览器点选。

---

## 1. HEAD

工作目录 `/workspace`；抽查时 `git rev-parse HEAD` = `c3539ab9e767cb5beaa62afcfddbdbba295dcd5c`（与 `origin/main` 一致）。Node v22.14.0；npm 10.9.7。

```
c3539ab Merge pull request #16 from lujie1980-oss/cursor/change3-acceptance-pr15
d0d78d1 Merge pull request #15 from lujie1980-oss/cursor/pack-suggest-policy-135e
```

---

## 2. 命令证据

```
npm install   # 退出码 0；added 91 packages
npm test      # vitest run v3.2.7
  Test Files  14 passed (14)
  Tests       157 passed (157)
  Duration    2.52s

# C3 过滤（C3-01～08 / C3-12 + C3-09/10）
npx vitest run pack-suggest-policy.test.ts plan-store.test.ts -t "C3-"
  Tests  19 passed | 12 skipped

npm run build  # tsc --noEmit && vite build
  vite v6.4.3  ✓ 30 modules transformed  built in 307ms
  dist/index.html                 17.29 kB
  dist/assets/index-B1LeYw1e.css  21.77 kB
  dist/assets/index-FHKOc5R-.js  117.98 kB
```

---

## 3. 抽查

### 3.1 `packSuggestPolicy` 默认 = fillOneFirst@80% + 窗 3 天 + 交期簇关 — **成立**

源码 `defaultPackSuggestPolicy()` / `defaultAppConfig().packSuggestPolicy`：

| 字段 | 期望 | 实值 |
|------|------|------|
| `fillMode` | `fillOneFirst` | `fillOneFirst` |
| `targetFillRate` | `0.8` | `0.8` |
| `dueWindowDays` | `3` | `3` |
| `dueCluster.enabled` | `false` | `false` |
| `preset` | `fillFirst` | `fillFirst` |
| `applyMode` | `nextAutoPackOnly` | `nextAutoPackOnly` |

单测：`C3-02`（恢复默认对齐 §5.1）、`C3-10`（旧 plan 无字段视为该默认）。UI 契约：`groupingPolicyPanelHtml` 默认样例含「先填满一台 / 80% / 交期簇关 / 窗 3 天」。

### 3.2 C3 相关单测存在且通过 — **成立**

| 文件 | 条数 | 覆盖 |
|------|------|------|
| `src/domain/__tests__/pack-suggest-policy.test.ts` | 17 | C3-01～08、C3-12 |
| `src/domain/__tests__/plan-store.test.ts` | 2 | C3-09、C3-10 |
| **过滤合计** | **19 passed** | 见 §2 |

`change1-ui.test.ts` 另有「变更-3 建议策略面板 UI」契约（含铁律提示），随全量 157 通过。

### 3.3 硬约束铁律未回退 — **成立**

抽查在「建议策略可配」之后仍先过滤、不可配掉：

| 铁律 | 证据 | 结果 |
|------|------|------|
| **BOX_LIMIT 口径2** | C3-06：大箱 300>280，`autoPackCabinet` `ok===false`。`rule-engine` / `commit-gate` A-AUTO-02 / Excel R1–R5 仍只计大箱合计 >280 | **未回退** |
| **TRAY_OVERFLOW** | C3-06：柜9 跳过超托盘 P001，落盘零 error。C1-28 码名与 auto 拒落盘仍在 | **未回退** |
| **双模式** | `scheduleMode` auto 遇 error 禁写；manual 可写+`manualViolation`（A-MAN-01、C3-12 装填完毕柜手工再拼仍可）。建议拼炉 / 自动组柜仍走 `editSource:'auto'` | **未回退** |
| **组柜无 Task** | C3-07：`date/shift/taskId` 均为 null，`scheduleStatus='unscheduled'`。组柜构造 `taskId: null`。C1-37：进甘特前无 `CabinetTask`；建 Task 仍仅 `applyGanttSchedule` | **未回退** |

UI 铁律条仍写：「硬约束（指定柜 / BOX_LIMIT 口径2 / 托盘 / 灭菌中 / 装填完毕）与双模式不可配掉；组柜不建任务。」

---

## 4. 未做

浏览器手工点选组柜面板 / 保存策略 / 自动组柜。不挡本轮冒烟；领域单测与静态抽查已覆盖默认值与铁律。
