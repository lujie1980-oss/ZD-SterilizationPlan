# 振德医疗 · 灭菌排产 · 二期迭代 A · 正式验收报告（PR #7）

| 项 | 内容 |
|----|------|
| 验收对象 | [PR #7](https://github.com/lujie1980-oss/ZD-SterilizationPlan/pull/7) · 分支 `cursor/phase2-iter-a-facts-mode-9704` |
| 被测提交 | `78247fb3a49765bf87301a4de2192b10f80f60e7`（`feat: 二期A 池事实标注与双模式提交闸门`） |
| 相对 `origin/main` | `0d4aa98`…`78247fb` · 11 files · **+1337 / −56** |
| 计划依据 | 《二期迭代 A 测试提纲》v0.1；《二期迭代 A 详细设计》v1.0（REQ-2.1 池事实 + REQ-2.5 双模式） |
| 执行日 | 2026-09-15 |
| 执行方式 | `npm install` → `npm test` → `npm run build` + 领域单测映射 + 源码静态核对；**未做浏览器手工点击**（提纲允许；不作为硬失败） |
| 验收角色 | 验收执行助手（**不改业务功能代码**；本文件为唯一新增交付） |

---

## 1. 总结论

**通过。**

铁律三条在领域闸门与 UI 接线均成立，P0 全表通过，一期回归抽查未回退：

1. **`scheduleMode=auto` 不得写入 error**：`decideCommit` 遇 `sev==='error'` 整次 `aborted`，`persisted` 为提交前快照。
2. **`scheduleMode=manual` 必须强预警**：允许 error 落盘；炉卡红条「手工违例」；工作台 `#wbModeBanner` 危险条；校验中心 `manual-hit` +「手工违例」标签。
3. **建议拼炉不得带 error 落盘**：无论 UI 模式，内部 `editSource='auto'`；失败则 `persisted` 回滚、UI 不写 `state.furnaces`。

`npm test`：**100 / 100 通过**。`npm run build`：退出码 0。无必改项。

---

## 2. 环境与命令结果

| 项 | 结果 |
|----|------|
| 工作目录 | `/workspace` |
| HEAD | `78247fb3a49765bf87301a4de2192b10f80f60e7` |
| Node | v22.14.0 |
| npm | 10.9.7 |
| OS | Linux 6.12.94+ |
| 命令顺序 | `npm install` → `npm test` → `npm run build` |
| GitHub Checks | 该分支当时 **no checks reported**（不作为本轮功能失败） |

### 2.1 `npm install`

- **退出码**：0
- 新增 89 packages，审计 90 packages（约 2s）
- 弃用警告：`whatwg-encoding@3.1.1`（jsdom 传递依赖）
- npm audit：2 moderate；**不作为功能验收失败**

### 2.2 `npm test`（`vitest run` v3.2.7）

- **退出码**：0
- **Test Files 10 passed / Tests 100 passed (100)**，Duration ~2.11s

| 文件 | 用例数 | 本轮相关性 |
|------|--------|------------|
| `src/domain/__tests__/commit-gate.test.ts` | 15 | A-AUTO / A-MAN / A-SUG / A-REG-01 |
| `src/domain/__tests__/facts.test.ts` | 9 | A-FACT-01/02（及 P1 芯片） |
| `src/domain/__tests__/plan-store.test.ts` | 12 | A-MODE-01/02/03、A-REG-03 |
| `src/domain/__tests__/rule-engine.test.ts` | 21 | BOX_LIMIT 口径2、D002_MIN 阈值 |
| `src/domain/__tests__/excel-r1-r5.test.ts` | 14 | A-REG-01 Excel R4 炉总箱 620 / 大箱 82 |
| `src/domain/__tests__/min-load.test.ts` | 10 | A-REG-02 D1 合同 `minLoadM3ByProcess` |
| `src/domain/__tests__/split-wizard.test.ts` | 5 | A-REG-03 `P004-A/B` |
| `src/domain/__tests__/suggest-combine.test.ts` | 4 | 一期建议拼炉基线 |
| `src/domain/__tests__/entry-scheduler.test.ts` | 9 | 进炉排序未回退 |
| `src/domain/__tests__/export-csv.test.ts` | 1 | CSV 未回退 |

### 2.3 `npm run build`（`tsc --noEmit && vite build`）

- **退出码**：0
- Vite v6.4.3，24 modules transformed，built in 265ms
- 产物：`dist/index.html` 15.75 kB；`dist/assets/index-B4Cz_1Yn.css` 18.76 kB gzip 4.42 kB；`dist/assets/index-CmhwIId7.js` 67.85 kB gzip 21.52 kB

---

## 3. 铁律核对（硬失败条件）

提纲 §3：auto 仍能写入 error、manual 无强预警、建议拼炉带 error 落盘 → **不通过**。

| 铁律 | 结论 | 量化 / 源码证据 |
|------|------|-----------------|
| auto 拒绝 error 落盘 | **成立** | `commit-gate.ts`：`gate==='auto' && hasError` → `ok:false, aborted:true, persisted=clone(previous)`。A-AUTO-01/02 断言 `persisted[0].lines === []` 且无 `manualViolation`。UI `applyDecision` 遇 abort 只 toast、**不** `state.furnaces=` / `persist()` |
| manual 强预警 | **成立** | A-MAN-01：`aborted===false`、`manualViolation===true`、`needsOverridePrompt===true`、issues 含 `CABINET_MISMATCH` error。炉卡 `.furnace-violation` 文案「手工违例」（红底 `#ff4d4f`）；`#wbModeBanner.strong-banner.danger`；校验中心 `.issue-item.manual-hit` |
| 建议拼炉强制零 error | **成立** | `commitSuggestCombine` 固定 `editSource:'auto'`。A-SUG-01 在 **manual UI** 下仍 `aborted===true`、`persisted===[]`、含 `CABINET_MISMATCH`。UI abort 分支 `return` 不写炉次。另有「abort 不污染调用方 furnaces」单测 |

分配 / 改柜 / 拆炉确认均走 `decideCommit(..., editSource:'manual')`，因而服从当前 `config.scheduleMode`。`addFurnace` 只建空炉（`canAddFurnace` 拦报废柜）；`deleteFurnace` 删除；演示种子写入不经闸门（见 §6 残留，非用户提交路径）。

---

## 4. P0 逐条

覆盖标记：

- **已自动化覆盖**：Vitest 直接证明预期
- **仅静态核对**：对照 `app.ts` / `index.html` / 种子，无浏览器 E2E
- **未覆盖需手工**：需真实点击/刷新/DevTools；不阻断本轮（用户允许单测+静态）

### 4.1 池事实（REQ-2.1）

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| **A-FACT-01** | **通过** | 已自动化 + 静态 | `facts.test.ts`：P001–P004 的 `dueLabel` 含各自 `due`；`hasDesignatedCabinet===true`；必有 `DESIGNATED` 芯片。P001/P004 在演示日 `2026-07-24` 为 `dueTone==='soon'` 且文案含「临近」。UI：工作台 `#poolTableBody` 与待灭菌池 `#fullPoolBody` 均渲染 `factStripHtml`（交期 span + 芯片） | 工作台列表是 **未分配** 可排池。演示种子把 P001–P004 装进炉后，工作台可能看不到它们；**待灭菌可排池仍列出**（与 PR #7 说明一致）。派生不调用 `validateFurnace` |
| **A-FACT-02** | **通过** | 已自动化 | P001：`DESIGNATED` label 含「指定柜」+「柜9」+「柜20」；`LOAD_TARGET` label 精确为 **`D002目标≥56`** | 与设计芯片表一致 |

量化（种子 + `asOf=2026-07-24`）：

| 行 | 交期 | dueTone | 指定柜芯片 | 其它芯片（单测已断言部分） |
|----|------|---------|------------|------------------------------|
| P001 | 2026-07-26（距 2 天） | soon · 临近 | 柜9,柜20 | LOAD_TARGET≥56；URGENT（P1 单测） |
| P002 | 2026-07-27（距 3 天） | soon | 柜9,柜20 | LOAD_TARGET |
| P003 | 2026-07-28（距 4 天） | ok（无临近芯片） | 柜9,柜20 | LOAD_TARGET |
| P004 | 2026-07-25（距 1 天） | soon · 临近 | 柜5,柜7,柜15 | BOX_LARGE「大箱·计入280」（P1） |

### 4.2 自动模式闸门（REQ-2.5）

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| **A-AUTO-01** | **通过** | 已自动化 + 静态 | D002（允许 9/20）→ 柜8：`aborted===true`、`CABINET_MISMATCH` **error**、`persisted` 仍为空炉、`manualViolation` 为假。UI：`assignSelected` → `decideCommit` → abort toast `'error'` | 无「手工违例」落盘 |
| **A-AUTO-02** | **通过** | 已自动化 | 大箱 `boxVol=largeBoxVol`、箱数 `maxBoxesWhenLarge+1`（默认 **281>280**）→ `BOX_LIMIT`，拒绝，`lines===[]`。口径2：只计大箱，规则引擎文案为「大箱（单箱≥…）合计」 | 该闸门用例未再断言 `sev==='error'`；`rule-engine.test.ts` 已断言 BOX_LIMIT 为 error |
| **A-AUTO-03** | **通过** | 已自动化 | D002 280×0.1m³ → 柜9：`aborted===false`、`lines===['P001']`、无 `manualViolation` | 合法路径可落盘 |

### 4.3 手工模式（REQ-2.5）

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| **A-MAN-01** | **通过** | 已自动化 + 静态 | 同上错柜：`ok===true`、`lines===['P001']`、`manualViolation===true`、`needsOverridePrompt===true`、issues 含 error。炉卡红条「手工违例」；校验中心可见 error（筛「仅手工违例」有单测 A-MAN-04） | 强预警三处：炉卡 / 工作台 banner / 校验中心 |
| **A-MAN-02** | **通过** | 已自动化 + 静态 | `overrideNotes:{}` 时 `decideCommit` 仍 `aborted===false`。UI：落盘**先于**原因弹窗；「跳过」仅 `mask.remove()`，**不**要求填写；空原因点「保存原因」会删空键但仍已保存炉次 | 与设计「建议填写、不阻断」一致 |

### 4.4 建议拼炉强制 auto

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| **A-SUG-01** | **通过** | 已自动化 + 静态 | 两行 D002 **仅允许柜20**，建议策略仍装 **柜9** → mismatch error → `aborted`、`persisted===[]`；config 为 **manual** 亦然。UI `suggestCombine` abort 不 `persist()` | 浏览器难以用演示种子直接打出该池状态（P001–P003 允许 9 与 20）；**单测即该闸门的可执行种子** |

### 4.5 模式持久化

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| **A-MODE-01** | **通过** | 已自动化 + 静态 | `savePlan` 后 `loadPlan`：`config.scheduleMode==='manual'`，`overrideNotes.F1` 仍在。UI：`setScheduleMode` 写 config 并 `persist()`；`renderWorkbench` 按 mode 切换 `#scheduleModeTabs .active`；`mergeConfig` / `persistableConfig` 只认 `'manual'` 否则 `'auto'` | 存储键仍为 `zhende_sterilization_plan_v2`。浏览器 F5 肉眼确认标 **未覆盖需手工** |

### 4.6 一期回归抽查（必过）

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| **A-REG-01** | **通过** | 已自动化 | 闸门：大箱=280 + 小箱=420 → **无** `BOX_LIMIT`，auto **允许**落盘。引擎：混合负荷炉总箱 500–700 不报。Excel R4：炉总箱 **620**、大箱 **82≤280** → 不触发 BOX_LIMIT；负例大箱 **281** 才 error，文案含 281、不含「合计 6xx 箱」 | **口径2 未被二期 A 改写**（`largeBoxCount` / `rule-engine.ts` 注释仍为 v1.3） |
| **A-REG-02** | **通过** | 已自动化 + 静态 | `effectiveMinLoadM3` 默认 56；`setProcessMinLoad(..., 30)` 覆盖工艺主数据 56。引擎：vol=40 在阈值 30 时无 `D002_MIN`，阈值 50 时 warning 且文案含 **50**、不含 **56m³**。UI `#cfgD002Min` → `setProcessMinLoad`（input/change 立刻 `persist`+`render`） | PR #1 报告缺陷 **D1（UI 改 D002 阈值不进引擎）在本基线上已修复**。闸门文件内 A-REG-02 只覆盖「降阈值后可 auto 落盘」，升阈值 warning 由 `rule-engine.test.ts` 承担 |
| **A-REG-03** | **通过** | 已自动化 + 静态 | `plan-store`：`virtualLines` round-trip、`P004-A/B` 刷新后仍挂炉、稀疏不 wipe 拆炉会话。拆炉确认走 `decideCommit`，**仅未 abort 才** `upsertVirtualLine` | 浏览器硬刷新肉眼确认仍 **未覆盖需手工**；持久化层已证明 |

---

## 5. P0 总表（成功标准）

| 用例ID | 优先级 | 结论 |
|--------|--------|------|
| A-FACT-01 | P0 | **通过** |
| A-FACT-02 | P0 | **通过** |
| A-AUTO-01 | P0 | **通过** |
| A-AUTO-02 | P0 | **通过** |
| A-AUTO-03 | P0 | **通过** |
| A-MAN-01 | P0 | **通过** |
| A-MAN-02 | P0 | **通过** |
| A-SUG-01 | P0 | **通过** |
| A-MODE-01 | P0 | **通过** |
| A-REG-01 | P0 | **通过** |
| A-REG-02 | P0 | **通过** |
| A-REG-03 | P0 | **通过** |

**P0：12 / 12 通过。铁律未破。**

---

## 6. 缺口与残留风险（非阻塞）

| ID | 级别 | 说明 | 是否破铁律 |
|----|------|------|------------|
| G1 | 信息 | 本轮 **无浏览器 E2E**：toast 文案、红条像素、F5 后工具栏「手工调整」高亮、原因弹窗「跳过」未点过 | 否（领域层已覆盖对应规则） |
| G2 | 低 | 演示种子同步后 P001–P004 离开工作台可排池；A-FACT-01 在工作台需先移除炉次行，或改看「待灭菌可排池」 | 否 |
| G3 | 低 | 演示种子将 **P004 整炉 350 大箱** 装入柜5，按口径2 会 `BOX_LIMIT` error。进炉同步后 auto 炉卡会标「需手工处理或改回合法」。属一期演示数据，**不是**闸门把 error 写进去 | 否（种子绕过 `decideCommit`） |
| G4 | 信息 | A-SUG-01 的「仅柜20 的 D002」需构造池状态；合法演示种子上点「建议拼炉」会走 A-SUG-02 成功路径 | 否 |
| G5 | 信息 | `suggestCombineD002Cab9` 对 `furnaces.slice()` 后仍 `f.lines.push`（浅拷贝）。生产路径 `commitSuggestCombine` 先 `cloneFurnaces`；abort 不污染调用方已有单测 | 否 |
| G6 | 信息 | 闸门 A-AUTO-02 / A-REG-02 断言略弱（未在同一用例里同时钉死 `sev` / 升阈值 warning）；由 rule-engine / excel 套件补齐 | 否 |

P1 抽样（非本轮必过，已有单测则记下）：

| 用例 | 结论 |
|------|------|
| A-FACT-03 BOX_LARGE | 自动化通过（P004「大箱·计入280」；P001 无） |
| A-FACT-04 URGENT | 自动化通过（P001 有 / P002 无） |
| A-FACT-05 点击开抽屉 | **仅静态**：`data-fact-open` → `openFactDrawer`，文案写明不代替校验中心；无 DOM 单测 |
| A-FACT-06 PENDING_ALLOW | 自动化通过（P006） |
| A-AUTO-04 拒追加不破坏已有行 | 自动化通过 |
| A-SUG-02 零 error 可写入 | 自动化通过（manual UI + 种子池） |
| A-MODE-02 缺省 auto | 自动化通过 |
| A-MODE-03 切模式不清除炉次 | 自动化通过 |
| A-MAN-03 有原因可持久化 | plan-store 已 round-trip `overrideNotes`；UI `saveOverrideNote` + `persist` |
| A-MAN-04 仅手工违例筛选 | 自动化通过 |
| A-MAN-05 切回 auto 禁新自动写入 | **仅静态**：`effectiveGate('auto')` 恒 auto；切 auto 时 toast「新的自动写入若含 error 将被拒绝」 |

---

## 7. 给开发的必改项 vs 可后续项

### 7.1 必改项（本轮交付阻塞）

**无。** 不得因本报告改业务功能代码。铁律与 P0 已在 `78247fb` 上成立。

### 7.2 建议（非阻塞，UAT / 下个迭代）

1. UAT 手工闸门 15 分钟：auto 错柜 toast 拒绝 → manual 同一操作红条落盘 → 跳过原因 → F5 模式仍为手工 → 任意模式下构造/mock 建议拼炉 error 确认整次回滚。
2. 演示种子：P004 改为已拆 `P004-A/B` 或不要整炉超 280 大箱，避免 G3 干扰手工验收观感。
3. 工作台 FactStrip 验收步骤写进 README（已有第 8 条；可补一句「种子占用后请看待灭菌池或先移除炉次」）。
4. 闸门单测补钉：A-AUTO-02 `sev==='error'`；A-REG-02 升阈值出现 `D002_MIN` warning。

### 7.3 明确不在本迭代（提纲 Out）

柜执行看板、分层拼柜+装柜率、进炉排序强化 → 迭代 B/C/D。手工违例升「必填原因」需提纲 v0.2 + 设计 v1.1。

---

## 8. 对照详细设计落点（静态）

| 设计点 | 实现 | 结论 |
|--------|------|------|
| `config.scheduleMode: 'auto'\|'manual'` 默认 auto | `defaultAppConfig` / `mergeConfig` | 成立 |
| `overrideNotes?: Record<furnaceId, string>` | `AppConfig.overrideNotes`；空不阻断 | 成立（设计 §2 曾写 `overrideReasonByFurnace`，§3.1 正式名为 overrideNotes，实现跟 §3.1） |
| `FurnaceRun.manualViolation` | 实体 + 闸门打标 + 炉卡红条 | 成立 |
| `deriveFacts` 不跑全量校验 | `facts.ts` 只读日期/allowed/boxVol/minLoad/urgent/pendingAllow | 成立 |
| 芯片码 DUE_* / DESIGNATED / NO_DESIGNATED / BOX_LARGE / LOAD_TARGET / PENDING_ALLOW / URGENT | 与设计 §4.2 一致 | 成立 |
| 提交闸门复用 `validateFurnace` | `decideCommit` → `validateFurnace` | 成立 |
| 建议拼炉 `editSource='auto'` | `commitSuggestCombine` | 成立 |
| 校验中心：全部 / 仅 error / 仅手工违例 | `#valFilterTabs` + `filterAndSortIssues` | 成立 |
| plan v2 key 不变、字段增量 | `STORAGE_KEY` 仍 `zhende_sterilization_plan_v2` | 成立 |
| 不改 BOX_LIMIT 口径2 / D002 拼载 / virtualLines 语义 | 相对 `origin/main` 未改 `rule-engine` 箱规公式、`min-load` 合同、`virtualLines` 字段 | 成立（本 PR 11 文件不含 `rule-engine.ts` / `min-load.ts` / `plan-store-v2.ts`） |

相对 `origin/main` 的业务改动文件：`README.md`、`index.html`、`config-defaults.ts`、`commit-gate.ts`+测试、`facts.ts`+测试、`plan-store.test.ts`、`entities.ts`、`styles.css`、`app.ts`。

---

## 9. 附录：闸门路径清单（防漏写）

| UI 动作 | 是否经 `decideCommit` | auto + error |
|---------|----------------------|--------------|
| 分配到选中炉 | 是 `editSource=manual` | 拒绝 |
| 炉卡改柜 | 是 `editSource=manual` | 拒绝 |
| 移除行 | 是 `editSource=manual` | 若剩余载荷仍 error 则拒绝本次（保守，不破坏铁律） |
| 拆炉确认 | 是 `editSource=manual` | 拒绝且不写 `virtualLines` |
| 建议拼炉 | 是 `editSource=auto` | 拒绝并回滚 |
| 添加空炉 | 否（`canAddFurnace`） | 空炉无行，引擎不报行级 error |
| 删除炉次 | 否 | 删除不是写入违例 |
| 进炉同步演示种子 | 否 | G3；非用户分配 |

---

*本报告仅新增于 `docs/验收报告-二期迭代A-PR7.md`，未修改业务功能代码。被测提交保持 `78247fb`。*
