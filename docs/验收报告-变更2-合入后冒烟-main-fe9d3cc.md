# 振德医疗 · 灭菌排产 · 变更-2 · 合入后冒烟（main@fe9d3cc）

| 项 | 内容 |
|----|------|
| 冒烟对象 | GitHub `main` tip `fe9d3cc`（[PR #18](https://github.com/lujie1980-oss/ZD-SterilizationPlan/pull/18) + 验收报告 [PR #19](https://github.com/lujie1980-oss/ZD-SterilizationPlan/pull/19)） |
| 被测提交 | `fe9d3cc3219e1d83a1b115aabfb8308fc14e48a3` |
| 业务 tip | 含变更-2：`a20e4cff7f34f8f9332377d278778ee2da2c54be`（PR #18 merge）← `7d8f8cf`（`feat: make Gantt entry sort configurable`） |
| 相对 `origin/main` | 与 tip **同 SHA**；本 PR 仅新增本报告 |
| 计划依据 | 《变更-2 测试提纲》v0.1；合入前正式验收 [docs/验收报告-变更2-PR18.md](./验收报告-变更2-PR18.md) |
| 执行日 | 2026-09-16 |
| 执行方式 | **只读**：`git log` / `rev-parse` → `npm ci \|\| npm install` → `npm test` → `npm run build` + grep/读测试与实现；**未改** `src/`、测试断言或配置；**未做浏览器手工点击** |
| 验收角色 | 测试侧合入后冒烟执行者（本文件为唯一新增交付） |

---

## 1. 总结论

**通过。** `main@fe9d3cc` 上变更-2 业务 tip 在位；全量单测 176/176 绿，`npm run build` 绿。默认真源仍为 `date↑ → shift↑ → volume↓ → id↑`；C2-01～09 入库单测仍覆盖；变更-3 `packSuggestPolicy` 默认真源未回退；硬约束 BOX_LIMIT 口径2 / TRAY_OVERFLOW / 双模式 auto·manual / CabinetTask 仅甘特建链 抽查成立。

| 抽查项 | 结果 |
|--------|------|
| HEAD = `fe9d3cc` 且含变更-2 | **通过** |
| 默认 `scheduleSortPolicy` = date↑ → shift↑ → volume↓ → id↑ | **通过** |
| C2 单测覆盖（拒存 / 恢复默认 / 调序可区分 / 仅保存不同步 / due 不变 / 按柜建链 / 与 pack 共存） | **通过** |
| 变更-3 `packSuggestPolicy` 默认 fillOneFirst@80%、窗 3 天、交期簇关 | **通过** |
| BOX_LIMIT 口径2 / TRAY_OVERFLOW / 双模式 / CabinetTask 仅甘特 | **通过** |
| `npm test` / `npm run build` | **通过** |

无必改项。

---

## 2. Git 基线

```
$ git log -1 --oneline
fe9d3cc Merge pull request #19 from lujie1980-oss/cursor/change2-acceptance-pr18-cc25

$ git rev-parse HEAD
fe9d3cc3219e1d83a1b115aabfb8308fc14e48a3
```

| 检查 | 结果 |
|------|------|
| 当前 checkout | `fe9d3cc`（与任务给定验收基线一致） |
| `7d8f8cf`（变更-2 feat）是 HEAD 祖先 | **是** |
| `a20e4cf`（PR #18 merge）是 HEAD 祖先 | **是** |
| `origin/main` | `fe9d3cc`（fetch 后与被测 SHA 相同） |
| 工作区 | 冒烟前 clean；本轮仅新增本报告 |

祖先链（新→旧）：`fe9d3cc`（PR #19 报告合入）→ `a20e4cf`（PR #18 merge）→ `5e5ef70`（验收报告）→ `7d8f8cf`（变更-2 实现）→ `c3539ab`（变更-3 已在 main）。

---

## 3. 环境与命令结果

| 项 | 结果 |
|----|------|
| 工作目录 | `/workspace` |
| HEAD（被测） | `fe9d3cc3219e1d83a1b115aabfb8308fc14e48a3` |
| Node | v22.14.0 |
| npm | 10.9.7 |
| OS | Linux 6.12.94+ |
| 命令顺序 | `npm ci \|\| npm install` → `npm test` → `npm run build` |

### 3.1 `npm ci || npm install`

- **退出码**：0
- added 91 packages，audited 92 packages（约 2s）
- 弃用警告：`whatwg-encoding@3.1.1`（jsdom 传递依赖）
- npm audit：2 moderate；**不作为冒烟失败**

### 3.2 `npm test`（`vitest run` v3.2.7）

- **退出码**：0
- **Test Files 16 passed / Tests 176 passed (176)**，Duration ~3.14s

| 文件 | 用例数 | 本轮相关性 |
|------|--------|------------|
| `src/domain/__tests__/schedule-sort-policy.test.ts` | 15 | C2-01～09、C2-11/12 |
| `src/domain/__tests__/change2-ui.test.ts` | 2 | 面板 HTML + jsdom：保存不同步 / 恢复默认 / pack 共存 |
| `src/domain/__tests__/plan-store.test.ts` | 16 | C2-10 / C2-10b 持久化 |
| `src/domain/__tests__/pack-suggest-policy.test.ts` | 17 | 变更-3 默认真源 + BOX_LIMIT / TRAY_OVERFLOW |
| `src/domain/__tests__/change1-grouping.test.ts` | 31 | 组柜无 Task；TRAY_OVERFLOW 双模式 |
| `src/domain/__tests__/entry-scheduler.test.ts` | 9 | 进炉排序接线 |
| `src/domain/__tests__/rule-engine.test.ts` | 21 | BOX_LIMIT 口径2 |
| `src/domain/__tests__/commit-gate.test.ts` | 15 | auto/manual 闸门；BOX_LIMIT 口径2 |
| `src/domain/__tests__/excel-r1-r5.test.ts` | 14 | BOX_LIMIT 口径2 Excel 回归 |
| 其余（facts / split / change1-ui / min-load / suggest / boot / export） | 36 | 未回退抽样 |

### 3.3 `npm run build`（`tsc --noEmit && vite build`）

- **退出码**：0
- Vite v6.4.3，32 modules transformed，built in 375ms
- 产物：`dist/index.html` 17.33 kB gzip 4.66 kB；`dist/assets/index-FBVVzWIS.css` 22.02 kB gzip 4.95 kB；`dist/assets/index-B5Rns2Wl.js` 126.96 kB gzip 38.51 kB
- `dist/` 在 `.gitignore`，未入库

---

## 4. 静态抽查

### 4.1 默认 `scheduleSortPolicy` 真源

`defaultScheduleSortPolicy()`（`src/domain/schedule-sort-policy.ts`）：

| 键 | direction | enabled | 角色 |
|----|-----------|---------|------|
| date | asc（↑） | true | 核心 |
| shift | asc（↑） | true | 核心 |
| volume | desc（↓） | true | 核心 |
| due / urgent / fillRate | — | **false** | 可选，默认关 |
| id | asc | 系统末键 | `effectiveKeys` 强制追加 |

`formatEffectiveKeysPreview` 默认 = `date↑ · shift↑ · volume↓ · (id)`。  
`applyMode` 写死 `nextSyncOnly`；`nullDatePolicy` 写死 `treatAsLatest`。  
`defaultAppConfig()` 同时挂 `packSuggestPolicy` 与 `scheduleSortPolicy`。

**结论：成立。**

### 4.2 C2 相关单测仍在且覆盖

| 提纲用例 | 入库测试 | 抽查结论 |
|----------|----------|----------|
| C2-01 非法拒存 | `schedule-sort-policy.test.ts`：空键 / 全关 → `SORT_POLICY_EMPTY`；关 date\|shift\|volume → `CORE_DISABLED`；未知码 / 重复 / 非法 direction → `UNKNOWN_KEY` / `DUP_KEY` / `BAD_DIR`；`commit` 失败且 `previous` 不变 | **在** |
| C2-02 恢复默认 | 生效序 `date:asc, shift:asc, volume:desc, id:asc`；预览四键；可选三键关 | **在** |
| C2-03 调序/升降可区分 | volume 置 date 前：CA→CB 翻成 CB→CA（含 `applyGanttSchedule` seq）；同日同班 volume desc vs asc 可翻转 | **在** |
| C2-04 due 置前 | due 置 date 前：默认同柜序翻转 | **在** |
| C2-05 urgent / fillRate | 各至少一例相对默认可区分 | **在** |
| C2-06 仅保存不同步 | 领域：`commitScheduleSortPolicy` 后 tasks/contents JSON 全等；jsdom：volume「升」保存后 Task 链不变 | **在** |
| C2-07 due 不变；组柜无 Task | `autoPackCabinet` 的 `taskId/date/shift` 皆 null；同步后 `XA.due` 仍为 `2026-07-29`；`cabinet-task.ts` 无 `.due =` | **在** |
| C2-08 按柜建链 | 柜9 / 柜20 各自 seq=`[1,2]`；prev/next 不跨柜；混柜 `orderContents` 抛 `SORT_POLICY_MIXED_CABINET` | **在** |
| C2-09 与 packSuggestPolicy 共存 | 默认配置两字段并存；jsdom 保存排序后 `packSuggestPolicy.preset` 仍 `fillFirst` | **在** |

UI：`saveSortPolicyFromDraft` 只写 `config.scheduleSortPolicy` + `persist()`，**不**调用 `syncFurnacePlan` / `applyGanttSchedule`。

**结论：成立。**

### 4.3 变更-3 `packSuggestPolicy` 默认未回退

`defaultPackSuggestPolicy()` + C2-09 / C3 单测：

| 字段 | 期望 | 实测真源 |
|------|------|----------|
| `fillMode` | fillOneFirst | `fillOneFirst` |
| `targetFillRate` | 80% | `0.8` |
| `dueWindowDays` | 3 | `3` |
| 交期簇 | 默认关 | `dueCluster.enabled === false` |
| `preset` | fillFirst | `fillFirst` |
| `applyMode` | nextAutoPackOnly | `nextAutoPackOnly` |

**结论：成立。**

### 4.4 硬约束回归抽查

| 约束 | 证据 | 结论 |
|------|------|------|
| **BOX_LIMIT 口径2** | `largeBoxCount` 只计 `boxVol ≥ largeBoxVol(0.12)`；`validateFurnace` 仅 `largeBoxes > maxBoxesWhenLarge(280)` 才 error；炉总箱数不触发。单测：等于 280 不报；大箱 280+小箱 420 不报；纯小箱 >280 不报；大箱 281 才 error（`rule-engine` / `commit-gate` / `excel-r1-r5` / pack C3-06） | **成立** |
| **TRAY_OVERFLOW** | `validateFurnace`：层体积 > `Tray.capacityM3` → error「超托盘」。`change1-grouping`：auto `decideCommit` 拒落盘；manual 可落盘 + `manualViolation`。pack 单测：超托盘行被 skip | **成立** |
| **双模式 auto/manual** | `decideCommit`：`editSource=auto` 或 UI `scheduleMode=auto` 遇 error **拒绝写入**；`scheduleMode=manual` 且人工操作允许写入并标 `manualViolation` / 强预警。`config-defaults` 默认 `scheduleMode='auto'` | **成立** |
| **CabinetTask 仅甘特才建** | `buildTaskChain` **仅**由 `applyGanttSchedule` 调用。组柜 `draftContent` / `manualPackCabinet` 字面量 `date/shift/seq/taskId = null`。C2-07 / C3-07 / change1-grouping 均断言组柜无 Task、甘特同步后才有 `taskId` | **成立** |

---

## 5. 残留（不挡通过）

| ID | 级别 | 说明 | 是否硬失败 |
|----|------|------|------------|
| S1 | 信息 | 本轮无浏览器 E2E；合入前验收已用 jsdom 覆盖保存/恢复默认。冒烟以全量单测 + 静态抽查为准 | 否 |
| S2 | 信息 | npm audit 2 moderate（jsdom 传递依赖）；与合入前验收相同，不作为功能失败 | 否 |

无必改项。UAT 建议仍同验收报告：进炉计划改 volume 升降 → 保存（甘特条不动）→ 再「同步装炉结果」看同柜 seq → 恢复默认。

---

## 6. 冒烟结论

| 项 | 值 |
|----|----|
| 结论 | **通过** |
| 必改项 | **无** |
| `npm test` | 176 / 176 通过 |
| `npm run build` | 绿（退出码 0） |
| 业务代码改动 | **无**（本交付仅本报告） |
