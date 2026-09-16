# 合入后冒烟：main tip `04b07c8`（变更-1 PR #10 + 热修）

| 项 | 内容 |
|----|------|
| 日期 | 2026-09-16 |
| 被测 SHA | `04b07c8765156c8db6d011910689df724d7fab5f` |
| 提交说明 | `Merge pull request #13`（热修回归记录）；祖先含 `#10` 变更-1、`#11` 验收报告、`e0b1295`+`4c48eca` 热修三码 |
| 范围 | 合入后冒烟：install / test / build + 四项抽查 |
| 本轮改动 | **未改业务功能代码**；仅本记录 |

## 结论

**可通过。** `npm test` 13 files / **137 passed**，`npm run build` 退出码 **0**。组柜无 date/shift/Task、甘特才建 Task、热修三码、迭代 A `scheduleMode` / BOX_LIMIT 口径2 均未回退。未做浏览器点选（jsdom 组柜页冒烟已覆盖双入口/无班次筛选/超托盘芯片）。

---

## 1. HEAD 确认

工作目录 `/workspace`；Node v22.14.0；npm 10.9.7。

```
git rev-parse HEAD
04b07c8765156c8db6d011910689df724d7fab5f

git log -1 --oneline
04b07c8 Merge pull request #13 from lujie1980-oss/cursor/change1-hotfix-c128-31-40-regression-dbce
```

合入链（`89c70be` 之后）：`#10` `56016e8` → `#11` `9ded806` → `#13` `04b07c8`。`origin/main` 已指向同一 SHA。

---

## 2. 命令证据

```
npm install   # 退出码 0；added 91 packages，audited 92
npm test      # vitest run v3.2.7
  Test Files  13 passed (13)
  Tests       137 passed (137)
  Duration    2.48s

npm run build  # tsc --noEmit && vite build；退出码 0
  vite v6.4.3  ✓ 29 modules transformed  built in 310ms
  dist/index.html                 17.25 kB
  dist/assets/index-8oyNm-Jf.css  20.76 kB
  dist/assets/index-Ddmve-HS.js  102.14 kB
```

抽查过滤（C1-11/22/23/37/38、热修三码、scheduleMode、口径2 / BOX_LIMIT 相关 it）：**44 passed** / 54 skipped。

`npm audit` 2 moderate、`whatwg-encoding` 弃用警告：**不作为冒烟失败**。

---

## 3. 抽查

### 3.1 组柜无 date/shift/Task（CabinetContent 路径）— **通过**

| 期望 | 实测 |
|------|------|
| 组柜写 `date/shift/taskId=null` | `grouping.ts` `autoPackCabinet` / `manualPackCabinet` 字面量 `date: null, shift: null, taskId: null`；`normalizeCabinetContent` 产出 `CabinetContent` |
| 单测 | C1-11/22：`packed.content.date/shift === null`，`taskId` falsy，`scheduleStatus==='unscheduled'`；C1-37：有 trays/OnTray，`taskId===null` |
| UI 无日/班筛选 | 默认 `groupingToolbarContractHtml()` 不注入 `#grpShiftTabs` / `#grpOnlineDate`；jsdom：`#grpShiftTabs` 为 null |

### 3.2 Task 甘特才建 — **通过（相关测试存在且绿）**

| 期望 | 实测 |
|------|------|
| 仅甘特写回并建链 | `applyGanttSchedule`（`cabinet-task.ts`）才写 `date/shift`、`buildTaskChain` |
| 单测存在 | `change1-grouping.test.ts` `C1-23/38`：写回 `2026-07-24`/`白班`/`seq=1`，`taskId` 有值，`isFirst===true`，`schedules[0].firstTaskId===task.id`；组柜时 `beforeShift===null` |

### 3.3 热修三码 — **通过**

源码 `ISSUE_CODES` / `rule-engine.ts` / `GROUPING_ISSUE_CODES` 均为定稿名。`src/` 内 **无** 旧名 `TRAY_OVER` / `LOAD_COMPLETE_BLOCK` / `QTY_EXCEEDED`。

| 码 | 规则层 | 闸门 / UI | 单测 |
|----|--------|-----------|------|
| `TRAY_OVERFLOW` | 层体积 > `Tray.capacityM3` → error | auto 拒落盘；manual 可落盘+`manualViolation`；分层「超托盘」 | C1-28 4 条 + UI 芯片 + jsdom `data-tray-over` |
| `REPACK_AFTER_LOAD_COMPLETE` | `loadComplete` 推 error；`autoPackCabinet` 提前失败 | auto 禁再拼；manual 强预警可再拼 | C1-31 3 条 + UI 待入炉标签/红条码名 |
| `ON_TRAY_QTY_OVERFLOW` | OnTray 箱/体积超 StockLine 剩余 | auto 拒绝落盘 | C1-40 4 条（占用口径、单柜/跨柜、auto 闸） |

### 3.4 迭代 A `scheduleMode` / BOX_LIMIT 口径2 未回退 — **通过**

| 期望 | 实测 |
|------|------|
| `scheduleMode` | 默认 `auto`；`decideCommit`：auto+error → abort；manual+error → 落盘+`manualViolation`。`plan-store` A-MODE-01/02/03 仍在 |
| 口径2 | `largeBoxCount` 只计 `boxVol ≥ largeBoxVol`；炉总箱不触发 `BOX_LIMIT`。`rule-engine.ts` 注释仍为 v1.3；`A-AUTO-02` / `A-REG-01` / Excel R1–R5 仍绿 |

---

## 4. 用例文件（全量 137）

| 文件 | 条数 | 本轮相关性 |
|------|------|------------|
| `change1-grouping.test.ts` | 31 | 组柜无日期 / 甘特才建 Task / 热修三码 |
| `change1-ui.test.ts` | 4 | 无班次筛选、超托盘芯片、待入炉红条 |
| `change1-boot.test.ts` | 1 | jsdom 组柜页冒烟 |
| `commit-gate.test.ts` | 15 | scheduleMode 闸门、口径2 混炉不报 BOX_LIMIT |
| `rule-engine.test.ts` | 21 | BOX_LIMIT 口径2 |
| `excel-r1-r5.test.ts` | 14 | R1–R5 口径2 |
| `plan-store.test.ts` | 12 | scheduleMode 持久化 |
| 其余 6 文件 | 39 | 一期/拆炉/拼炉/CSV/进炉排序未回退 |

---

## 5. 残余（不挡合入）

1. **未做浏览器手工点选**；领域单测 + jsdom 契约代替。
2. 热修记录已列 C1-40 无 manual 专测、`loadComplete` 校验偏严等，本轮合入后未恶化。

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-16 | main tip `04b07c8` 合入后冒烟；137 passed、build 0；四项抽查通过 |
