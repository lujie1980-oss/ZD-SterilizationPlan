# 振德医疗 · 灭菌排产 · main tip 合入后冒烟（迭代 A）

| 项 | 内容 |
|----|------|
| 冒烟对象 | `origin/main` tip `89c70bedc54f32753f3a95e512af23b25e519ec8` |
| 含已合入 | [PR #7](https://github.com/lujie1980-oss/ZD-SterilizationPlan/pull/7)（`280975a` 池事实 + 双模式）及 [PR #8](https://github.com/lujie1980-oss/ZD-SterilizationPlan/pull/8)（验收报告） |
| 执行日 | 2026-09-16 |
| 方式 | `npm install` → `npm test` → `npm run build` + 源码/单测抽查；**未改业务代码**；**未做浏览器手工点击** |
| 本文件 | 唯一新增交付 |

---

## 一句话结论

**通过。** `89c70be` 即 `origin/main` tip（含 PR #7），`npm test` **100 / 100**，`npm run build` 退出码 **0**；迭代 A 闸门与一期 BOX_LIMIT 口径2 / minLoad / virtualLines 抽查未回退。

---

## 1. HEAD 确认

| 项 | 值 |
|----|-----|
| 工作树 HEAD | `89c70bedc54f32753f3a95e512af23b25e519ec8` |
| `origin/main` | 同 SHA（fetch 后） |
| 提交说明 | `Merge pull request #8 from lujie1980-oss/cursor/phase2-iter-a-acceptance-deab` |
| 祖先 | `280975a` Merge PR #7；`78247fb` `feat: 二期A 池事实标注与双模式提交闸门` |
| 祖先判定 | `git merge-base --is-ancestor 89c70be origin/main` → 是 |

---

## 2. 环境与命令结果

| 项 | 结果 |
|----|------|
| Node | v22.14.0 |
| npm | 10.9.7 |
| OS | Linux 6.12.94+ |
| 顺序 | `npm install` → `npm test` → `npm run build` |

### 2.1 `npm install`

- **退出码**：0
- 新增 89 packages，审计 90 packages（约 2s）
- 弃用警告：`whatwg-encoding@3.1.1`（jsdom 传递依赖）
- npm audit：2 moderate；**不作为本轮冒烟失败**

### 2.2 `npm test`（`vitest run` v3.2.7）

- **退出码**：0
- **Test Files 10 passed / Tests 100 passed (100)**，Duration ~1.82s

| 文件 | 用例 | 抽查相关 |
|------|------|----------|
| `commit-gate.test.ts` | 15 | auto 拒 error / manual 可违例 / 建议拼炉强制 auto / 口径2 混炉 |
| `facts.test.ts` | 9 | FactStrip 派生（REQ-2.1） |
| `plan-store.test.ts` | 12 | `scheduleMode` 持久化、`virtualLines` round-trip |
| `rule-engine.test.ts` | 21 | BOX_LIMIT 口径2、D002_MIN |
| `excel-r1-r5.test.ts` | 14 | R4 炉总箱 620 / 大箱 82 |
| `min-load.test.ts` | 10 | `minLoadM3ByProcess` 合同 |
| `split-wizard.test.ts` | 5 | `P004-A/B` + virtualLines 回灌 |
| `suggest-combine.test.ts` | 4 | 一期建议拼炉基线 |
| `entry-scheduler.test.ts` | 9 | 进炉排序未回退 |
| `export-csv.test.ts` | 1 | CSV 未回退 |

### 2.3 `npm run build`（`tsc --noEmit && vite build`）

- **退出码**：0
- Vite v6.4.3，24 modules transformed，built in 252ms
- 产物：`dist/index.html` 15.75 kB；`dist/assets/index-B4Cz_1Yn.css` 18.76 kB gzip 4.42 kB；`dist/assets/index-CmhwIId7.js` 67.85 kB gzip 21.52 kB

---

## 3. 迭代 A 抽查

未改业务代码；以下为 `89c70be` 树上静态核对 + 上表单测全绿。

### 3.1 FactStrip / 池事实 — **存在**

| 证据 | 位置 |
|------|------|
| 派生 `deriveFacts`（只读，不跑全量校验） | `src/domain/facts.ts` |
| 单测 A-FACT-01/02 等 9 例 | `src/domain/__tests__/facts.test.ts` |
| UI `factStripHtml` → `.fact-strip` + 交期/芯片/抽屉 | `src/ui/app.ts` |
| 样式 | `src/styles.css` `.fact-strip` |

### 3.2 `scheduleMode=auto` 拒 error / `manual` 可违例 — **成立**

| 路径 | 证据 |
|------|------|
| 闸门 | `decideCommit`：`gate==='auto' && hasError` → `aborted`，`persisted` 为提交前快照 |
| auto | A-AUTO-01：D002→柜8 `CABINET_MISMATCH` 拒绝，`lines===[]`；A-AUTO-02：大箱 281→`BOX_LIMIT` 拒绝 |
| manual | A-MAN-01：同一错柜 **落盘** 且 `manualViolation===true`、`needsOverridePrompt` |

### 3.3 建议拼炉强制 auto — **成立**

| 路径 | 证据 |
|------|------|
| 实现 | `commitSuggestCombine` 固定 `editSource:'auto'`（无视 UI `scheduleMode`） |
| A-SUG-01 | **manual UI** 下仅柜20 的 D002 仍 `aborted===true`、`persisted===[]` |
| A-SUG-02 | 合法种子无 error 可写入柜9 |

### 3.4 一期 BOX_LIMIT 口径2、minLoad、virtualLines — **未被破坏**

| 口径 | 抽查 | 结果 |
|------|------|------|
| BOX_LIMIT 口径2 | `rule-engine.ts`：`largeBoxCount` > `maxBoxesWhenLarge` 才 error；炉总箱数不触发。A-REG-01：大箱 280 + 小箱 420 auto 允许。Excel R4：总箱 **620**、大箱 **82≤280** 无 `BOX_LIMIT` | 通过 |
| minLoad | `effectiveMinLoadM3` 读 `config.minLoadM3ByProcess`；A-REG-02：阈值 30 时 40m³ D002 无 `D002_MIN`；`min-load.test.ts` 默认 56 / 覆盖 30 | 通过 |
| virtualLines | `plan-store` round-trip `P004-A`；拆炉会话刷新不 wipe；`split-wizard` `P004-A/B` 回灌 pool | 通过 |

---

## 4. 范围与残留

- 本轮 **只新增本冒烟记录**，不改 `src/`。
- 未做浏览器 UAT（与 PR #8 验收报告一致：提纲允许；不作为硬失败）。
- GitHub Checks 若该分支无 CI，不作为功能失败。
