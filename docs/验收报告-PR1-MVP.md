# 振德医疗 · 灭菌排产 MVP · 验收报告（PR #1）

| 项 | 内容 |
|----|------|
| 验收对象 | [PR #1](https://github.com/lujie1980-oss/ZD-SterilizationPlan/pull/1) · 分支 `cursor/sterilization-plan-mvp-67f6` |
| 被测提交 | `3765bb2`（`fix: inline favicon to avoid 404 on first load`，其上为 `f98369c` MVP 实现） |
| 计划依据 | 《振德医疗-灭菌排产-MVP-测试验证计划》v0.1.1（对齐方案 v1.1 · `virtualLines` 正式字段） |
| 执行日 | 2026-09-15 |
| 执行方式 | 领域单测 + TypeScript/Vite 构建 + 源码静态核对；**未做浏览器手工点击** |
| 验收角色 | 验收执行助手（不改业务代码） |

---

## 1. 总结论

**带风险通过。**

- **P0 硬约束与阻塞项 B1–B10**：未发现可被静默绕过的失败；`CABINET_MISMATCH` / `CABINET_SCRAPPED` / `BOX_LIMIT` 均为 **error**；进炉排序、plan v2 + `virtualLines[]`、CSV BOM、侧栏 7 模块在单测或源码上成立。
- **允许带风险通过的项**：P0-1～P0-6 均按方案「可配置假设」实现，UI 标琥珀色「待确认」，**不得当作已定业务制度封口**。客户书面确认后必须回归。
- **未跑浏览器 E2E**：场景 A–E 的点击观感、甘特像素条、刷新后 localStorage 肉眼确认标为「未覆盖需手工」，不作为本轮硬失败依据（领域层已覆盖对应规则）。
- **非阻塞缺口**：工作台「D002 最低 m³」配置被工艺主数据 `minLoadM3` 抢先，改 UI 数字不改变 `D002_MIN` 阈值（默认仍为 56，硬约束不受影响）。见缺陷 D1。

项目群可同步口径：**MVP 可演示、硬约束未失守；业务 P0 六项未定稿 → 带风险通过。**

---

## 2. 环境与命令结果

| 项 | 结果 |
|----|------|
| 工作目录 | `/workspace` |
| Node | v22.14.0 |
| npm | 10.9.7 |
| OS | Linux 6.12.94+ |
| 命令顺序 | `npm install` → `npm test` → `npm run build` |

### 2.1 `npm install`

- **退出码**：0
- 新增 89 packages，审计 90 packages（约 2s）
- npm 提示 2 个 moderate 漏洞（`npm audit`）；**不作为功能验收失败**
- 弃用警告：`whatwg-encoding@3.1.1`（jsdom 传递依赖）

### 2.2 `npm test`（`vitest run`）

- **退出码**：0
- Vitest v3.2.7
- **Test Files 6 passed / Tests 39 passed (39)**，Duration ~1.05s

| 文件 | 用例数 | 结果 |
|------|--------|------|
| `src/domain/__tests__/plan-store.test.ts` | 6 | 通过 |
| `src/domain/__tests__/rule-engine.test.ts` | 17 | 通过 |
| `src/domain/__tests__/entry-scheduler.test.ts` | 9 | 通过 |
| `src/domain/__tests__/export-csv.test.ts` | 1 | 通过 |
| `src/domain/__tests__/split-wizard.test.ts` | 3 | 通过 |
| `src/domain/__tests__/suggest-combine.test.ts` | 3 | 通过 |

覆盖要点：硬/软/info 校验码、进炉排序与白夜周期、灭菌/预热重叠、拆炉虚拟行 round-trip、`virtualLines` 正式字段、CSV UTF-8 BOM、可排 `isEligible`、演示稀疏重种开关。

### 2.3 `npm run build`（`tsc --noEmit && vite build`）

- **退出码**：0
- Vite v6.4.3，21 modules transformed
- 产物：`dist/index.html` 14.67 kB；`dist/assets/index-mQdRk4En.css` 16.35 kB；`dist/assets/index-CXp4aLkF.js` 52.59 kB gzip 16.69 kB

---

## 3. 对照实现核对（验收任务第 3 条）

| 检查项 | 结论 | 证据 |
|--------|------|------|
| 硬校验码 `CABINET_SCRAPPED` / `CABINET_MISMATCH` / `BOX_LIMIT` 必须是 **error** | **成立** | `rule-engine.ts`：`canAddFurnace` 与 `validateFurnace` 均 `sev: 'error'`；单测断言 mismatch/box 为 error；报废柜 `usableCabinets()` 过滤 `status !== '报废'` |
| 软：`D002_MIN` / `TARGET_MIN` / `MIX_CUSTOMER` 为 **warning** | **成立（默认）** | 引擎 `sev: 'warning'`；`mix.customer === 'forbid'` 时可升 error（默认 `warn`）；单测覆盖开关 on/off 与 filler 文案 |
| plan v2 key `zhende_sterilization_plan_v2` + 正式字段 `virtualLines[]` | **成立** | `config-defaults.ts` `STORAGE_KEY`；`PlanSnapshot.virtualLines: StockLine[]`；`serializePlan` / `loadPlan` / `bootApp` merge |
| 周期/箱规阈值全配置化，无魔法数写死在 UI | **基本成立，有缺口 D1** | UI 周期/拼载输入绑定 `state.config.cycle` / `load`；箱规规则卡读 `cfg.box`；规则引擎 BOX_LIMIT 读 `ctx.config.box`。**D002 引擎阈值优先 `Process.minLoadM3`，工作台改 `load.d002MinM3` 不生效**。箱规样例 `note` 仍有「≥0.12 → 280」字面（种子备注，非判定逻辑） |
| 进炉排序：date↑ → 白班先夜班 → volume↓ → furnaceId | **成立** | `sortFurnaceRunsForEntry`；单测期望序 `Fb, F1, Fa, F2, F9` 且 seq=1…n |

---

## 4. P0 用例逐条

覆盖标记：

- **已自动化覆盖**：现有 Vitest 直接证明预期
- **仅静态核对**：对照 `index.html` / `app.ts` / 种子数据，无 UI/E2E 运行
- **未覆盖需手工**：需真实浏览器点击/刷新/目视甘特

### 4.1 日排产工作台

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| TC-WB-01 | **通过** | 仅静态核对 | `currentFurnaces` 过滤 `date=== && shift=== && !hidden`；日期/班次 change 后 `render()` | 无针对 `currentFurnaces` 的单测；炉卡网格只渲染当前班次可见炉 |
| TC-WB-02 | **通过** | 仅静态核对 | `assignSelected`：未分配勾选入 `f.lines`、清空 `selectedPool`、`furnaceVol`/`furnaceBoxes` 重算 | 勾选→加柜→分配闭环在源码闭合；**未覆盖需手工**点一次确认 toast |
| TC-WB-07 | **通过** | 仅静态核对 | `#btnValidate` → `navigate('validation')`；炉卡 `has-error`/`has-warn` 与 `validateFurnace` 一致 | 校验中心列表含 `code`；工作台芯片 `errCount+warnCount` |
| TC-WB-08 | **通过** | 仅静态核对 | `#btnGotoFurnacePlan` → `syncFurnacePlan()` + `navigate('furnace-plan')`；甘特 `fp-seg` 预热/灭菌/解析/BI | 同步走 `buildEntryLoads`，非手搓独立账 |

### 4.2 硬约束（必须失败）

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| TC-RULE-01 | **通过** | 已自动化覆盖 | `rule-engine.test.ts`：D002 入柜8 → `CABINET_MISMATCH` **error**；改柜9 消失 | 对应场景 D / B1 |
| TC-RULE-02 | **通过** | 已自动化覆盖 | Z051 入非柜16 → `CABINET_MISMATCH` | 单测未再断言 `sev==='error'`，源码与 D002 共用同一 error 分支 |
| TC-RULE-03 | **通过** | 已自动化覆盖 + 仅静态核对 | `canAddFurnace('柜1')` → `CABINET_SCRAPPED`；`usableCabinets()` 不含报废；拆炉 option `disabled` | 添加下拉不可选 + 引擎拒绝双保险 |
| TC-RULE-04 | **通过（假设）** | 已自动化覆盖 | 0.12 m³ × 281 箱 → `BOX_LIMIT` **error**；阈值来自 `config.box` | **部分待确认**（小柜折算）；按「大柜统一 280」假设。P0-5 |

### 4.3 软约束（P0）

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| TC-RULE-07 | **带风险通过** | 已自动化覆盖 | vol=10 的 D002 → `D002_MIN` **warning** | 口径毛体积假设；依赖 P0-5。注意 D1：改 UI 的 56 不一定改引擎 |
| TC-RULE-08 | **带风险通过** | 已自动化覆盖 | 手术衣 vol=1 → `TARGET_MIN` warning；`allowFiller` 仅改文案、不自动加料 | 依赖 P0-5 |

### 4.4 拆炉

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| TC-SPLIT-01 | **通过** | 已自动化覆盖 + 仅静态核对 | `applySplit` 产生 `P004-A/B`、`splitOf`、两可见炉 + hidden 父炉；向导按箱数拆、目标柜=允许∩台账 | 不改种子源文件；拆箱单位为假设 |
| TC-SPLIT-02 | **通过** | 已自动化覆盖 | `savePlan`/`loadPlan` round-trip；localStorage 含 `"virtualLines"`；`mergeVirtualLinesIntoPool` 可解析 `*-A/*-B`；`serializePlan` 正式字段 | `bootApp` 启动即 merge。**浏览器刷新肉眼确认仍标未覆盖需手工**，持久化层已证明 |

### 4.5 进炉计划 / 甘特

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| TC-FP-01 | **通过** | 已自动化覆盖 + 仅静态核对 | `buildEntryLoads` 由 plan 重建 `EntryLoad`；UI 四段 `preheat/sterilize/aerate/bi` | 场景 E |
| TC-FP-02 | **通过** | 已自动化覆盖 | 排序单测：同日白班大体积 `Fb` 先于 `F1`/`Fa`，再夜班 `F2`，再次日 `F9`；seq 1…n | B6 阻塞项通过 |
| TC-FP-03 | **带风险通过** | 已自动化覆盖 | 白班预热 date−0.5d→date；灭菌 1d；D002 解析 2d；BI 2d | 解析天数部分 pending（亚澳等） |
| TC-FP-04 | **通过** | 已自动化覆盖 | 夜班灭菌起点 date+0.5d；预热 date→灭菌起点 | `nightSterilizeOffsetDays` 在配置中，工作台无独立输入框（可后续） |
| TC-FP-06 | **通过** | 已自动化覆盖 + 仅静态核对 | 同柜白+夜默认灭菌窗相交 → `STERILIZE_OVERLAP` warning；`load.conflict`；甘特 `.fp-bar.conflict` / 柜行红条 | 不阻断查看 |
| TC-FP-09 | **通过** | 仅静态核对 | 队列表头：顺序、装炉来源、计划进炉、预计出柜、解析完成、BI完成；`renderFpQueue` 填 seq / furnaceId / sterilize / aerate / bi | 无队列字段单测 |

### 4.6 可排池 / 主数据 / 校验 / 非功能 / 场景

| 用例ID | 结果 | 覆盖 | 证据 | 备注 |
|--------|------|------|------|------|
| TC-POOL-01 | **带风险通过** | 已自动化覆盖 + 仅静态核对 | `isEligible`：待灭菌仓 ∧ 非限制 ∧ EO；P001 true / P015（限制）false；可排池页标「待确认」 | 工作台走 `isEligible`；**可排池页 `renderPool` 未复用 EO/`stockStatuses` 配置**（演示种子下与工作台等价，D2） |
| TC-MD-01 | **带风险通过** | 仅静态核对 | 柜1 报废；柜21 `pending`+可排；产能/基地列齐全 | 柜清单完整性未定稿（P0-3） |
| TC-MD-02 | **通过（已确认子集）/ 带风险（pending 行）** | 仅静态核对 | D002→9,20；Z181→5,7,15；Z051→16；帽子棉垫→8,13,18；换药包→17；P006→12,20；P252→14；手术衣→8；Z162→3 | 亚澳仅柜12（方案另有 10/12 pending）；EO通用含柜4/6 台账缺失（R2） |
| TC-MD-04 | **通过** | 仅静态核对 | `.tag-pending` 琥珀底 `#fff7e6` / `#d46b08`；`showPendingTags` 可关 | 展示本身不依赖客户定稿 |
| TC-VAL-01 | **通过** | 仅静态核对 | `sortIssues` error→warning→info；文案 meta 含 `代码 ${code}`；`data-jump` 回工作台并选中炉 | `sortIssues` 无独立单测；点击跳转未 E2E |
| TC-NF-01 | **通过** | 已自动化覆盖 | 文件名 `日计划_{date}_{shift}.csv`；UTF-8 BOM；列与 `CSV_HEADERS` 一致；品名引号；加急 Y | 16 列齐全 |
| TC-NF-02 | **通过** | 已自动化覆盖 + 仅静态核对 | v2 key；恢复 furnaces/virtualLines/config；稀疏演示重种**不清除** virtualLines | date/shift 由 `loadPlan` 回填；单测偏重 virtualLines |
| TC-UX-01 | **通过（逻辑）** | 仅静态核对 / 未覆盖需手工 | 工具栏按钮与分配/校验/导出绑定完整 | **建议客户验收时手工走一遍场景 A** |
| TC-UX-03 | **通过（逻辑）** | 已自动化覆盖 + 仅静态核对 | 拆炉 + `buildEntryLoads` 多 seq | 同 TC-SPLIT-01 + 甘特 |
| TC-UX-04 | **通过** | 已自动化覆盖 | 同 TC-RULE-01 | 场景 D |
| TC-UX-05 | **通过（逻辑）** | 已自动化覆盖 + 仅静态核对 | 同 TC-FP-01/09；视野 7/14/21 为 P1（TC-FP-08）已在 HTML 存在 | 场景 E |
| TC-UX-08 | **通过** | 仅静态核对 | 侧栏 7 项：`workbench` / `furnace-plan` / `pool` / `cabinets` / `processes` / `boxspecs` / `validation` | B10 通过 |

---

## 5. P1/P2 抽样结论

未全量执行 26 条 P1 / 6 条 P2，抽测如下。

| 抽样 | 结论 | 证据摘要 |
|------|------|----------|
| TC-RULE-05 箱数=280 不触发 BOX_LIMIT | **通过（自动化）** | `rule-engine.test.ts` 边界用例 |
| TC-RULE-09/10 MIX_CUSTOMER 开关 | **带风险通过（自动化）** | on→warning；`mixCustomerWarn=false` 不生成 |
| TC-RULE-13 CAB21 info | **带风险通过（自动化）** | `CAB21` + pendingFlag |
| TC-RULE-14 PROC_PENDING | **带风险通过（自动化）** | 亚澳 → info |
| TC-RULE-15 30 板/炉 | **通过（静态）** | 仅规则卡 hint，`boardsPerFurnaceHint`，**无硬 error** |
| TC-WB-09 开关写入 plan | **带风险通过（静态+规则单测）** | `#cfgFiller`/`#cfgMix` → `persist()`；规则随 config 变 |
| TC-FP-05 改 biDays | **通过（自动化）** | `cycle.biDays=4` 时 BI 段=4d；工作台 `#cfgBiDays` 变更后 `syncFurnacePlan` |
| TC-FP-07 PREHEAT_OVERLAP | **带风险通过（自动化）** | warning + pendingFlag |
| TC-FP-08 视野 7/14/21 | **通过（静态）** | `fpHorizonTabs`；默认 `fp.defaultHorizon=14` |
| TC-SUG-01/02 建议拼炉 | **通过（自动化）** | `D002_CAB9_DEMO`；&lt;2 行失败不装错 |
| TC-VAL-02 error 仍可导出 | **通过（静态）** | `export.blockOnError` 默认 false；有 error 时 toast warn |
| TC-NF-03 关 demo seed | **通过（自动化）** | `demo.enableSeed=false` 稀疏计划不 wipe |
| TC-FP-11 进炉页隐藏导出 | **通过（静态）** | `navigate` 时 `furnace-plan` 隐藏 `#btnExport` |
| TC-WB-03/04 移除/删炉 | **通过（静态）** | `removeFromFurnace` / `deleteFurnace` |
| P2 OVER_CAP / OCCUPANCY | **通过（自动化）** | 均为 warning |

未抽到的 P1（如可排全列 Excel 对齐、试用路径逐步点击）不阻断本轮；建议 UAT 补手工。

---

## 6. 缺陷清单

| ID | 严重级别 | 说明 | 影响 |
|----|----------|------|------|
| D1 | **中（非阻塞）** | `processMinLoad`：若工艺存在 `minLoadM3`（D002 种子=56），**忽略** `config.load.d002MinM3`。工作台「D002 最低 m³」可改并写入 plan，但 `D002_MIN` 仍按 56 | 配置化不彻底；默认值与方案一致，**不破坏硬约束** |
| D2 | **低** | 可排池页 `renderPool` 未调用 `isEligible`（写死 `stockStatus==='非限制'` + locations，无 EO 过滤） | 演示种子无非 EO 行，工作台左侧正确 |
| D3 | **低** | `seed-boxspecs.ts` 样例 `note` 字面「≥0.12 → 每炉≤280箱」 | 规则卡片已读配置；备注未随配置变 |
| D4 | **低** | EO通用允许柜含 **柜4/柜6**，`CABINETS` 无此两柜 | 方案风险 R2；候选交集会丢掉缺失柜 |
| D5 | **信息** | `canAddFurnace` 单测未断言 `sev==='error'`；`sortIssues` / `currentFurnaces` 无单测 | 源码级别正确；测试完备性缺口 |
| D6 | **信息** | 本轮无浏览器 E2E / 手工刷新截图 | 场景 A–E 观感待 UAT |

**无 P0 硬约束失败，无 B1–B10 阻塞项。**

---

## 7. 带风险通过项（对应 6 项 P0 待确认）

| P0 ID | 主题 | 本轮结果 | 证据 | 风险说明 | 回归触发 |
|-------|------|----------|------|----------|----------|
| P0-1 | 库存数据源 / 可排条件 | **带风险通过** | `isEligible` + 池页待确认文案；`eligibility.*` 可配 | 演示 POOL，非真实 3010/接口；刷新频率未测 | 客户确认可排条件/接口后 |
| P0-2 | 工艺 0305、N/K | **带风险通过** | 行上 `process`+`allowed`；`matType` N/K；`processMatch.key='K'` | 未对接 0305；N/K 完整料号可空 | 导入正式 0305 / 确认匹配键 |
| P0-3 | 柜21 / 报废 | **带风险通过** | 柜21 可添加 + `CAB21` info；柜1 报废不可选 | 台账尺寸/产能仅为示意 | 客户补柜清单 / 柜21 定稿 |
| P0-4 | 指定柜表完整性 | **已确认子集通过 + pending 带风险** | D002/Z051 等单测+种子表；亚澳/EO通用 `pending` | 亚澳 10# 未入允许列表；柜4/6 缺失 | 客户定稿指定柜全表 |
| P0-5 | 拼载/箱规/30板/填充物 | **硬 BOX_LIMIT 通过；软拼载带风险** | BOX_LIMIT error；D002_MIN/TARGET_MIN warning；30 板非硬约束；filler 仅文案 | 毛/有效体积、小柜折算未定；D1 使 UI 改 D002 阈值无效 | 口径/折算/填充物定稿后改阈值与级别 |
| P0-6 | 混炉 | **带风险通过** | `MIX_CUSTOMER` 可关；无混批/混解析/半成品伪硬约束 | 仅混客户 warning | 若改为 forbid，升 error 并补混批用例 |

---

## 8. 给开发的必改项 vs 可后续项

### 8.1 必改项（本轮交付阻塞）

**无。** 硬约束、主链路领域逻辑、plan v2、排序、CSV 均达到可演示 MVP 门槛。

### 8.2 建议必改（非阻塞，配置面板诚信）

1. **D1**：`processMinLoad` 应让 `config.load.d002MinM3` 生效（或 UI 标明「以工艺主数据为准」并只读）。否则「周期/阈值配置驱动」对 D002 名不副实。
2. UAT 前补 **场景 A 手工一遍**（选日班→分配→校验→导出）和 **拆炉后刷新**，把 TC-UX-01 / TC-SPLIT-02 从「逻辑通过」升为「手工通过」。

### 8.3 可后续项

- D2：可排池页与工作台共用 `isEligible`
- D3：箱规 note 改读配置模板
- D4：EO通用允许柜与柜台账对齐（或 info「主数据缺失」）
- 工作台增加 `nightSterilizeOffsetDays` 输入（现仅默认 0.5，代码已读配置）
- 单测补：`CABINET_SCRAPPED.sev`、`sortIssues`、`currentFurnaces`、改 `d002MinM3` 后 `D002_MIN` 阈值变化
- 生产构建文档已写 `VITE_ENABLE_DEMO_SEED=false`；发版检查项保持

---

## 9. 阻塞项 B1–B10 勾选

| # | 阻塞项 | 结论 |
|---|--------|------|
| B1 | 指定柜可被静默绕过 | **未发生**（error `CABINET_MISMATCH`） |
| B2 | 报废柜仍可添加 | **未发生** |
| B3 | 大箱超 280 不报 BOX_LIMIT | **未发生** |
| B4 | 装炉主链路无法完成 | **领域+UI 绑定存在**（手工点击待 UAT） |
| B5 | 进炉无分段/队列缺字段 | **未发生** |
| B6 | 进炉排序错误 | **未发生** |
| B7 | 灭菌重叠无告警 | **未发生** |
| B8 | CSV 缺列/无 BOM/文件名 | **未发生** |
| B9 | 刷新丢计划 / 虚拟行丢失 | **持久化层未发生** |
| B10 | 侧栏模块缺失 | **未发生** |

---

## 10. 附录：校验码与单测对照（计划 §9 / 方案 §16.3）

| code | 级别（默认） | 单测 |
|------|----------------|------|
| CABINET_SCRAPPED | error | 有（未断言 sev） |
| CABINET_MISMATCH | error | 有（含 sev） |
| BOX_LIMIT | error | 有（含边界 280） |
| D002_MIN | warning | 有 |
| TARGET_MIN | warning | 有（filler 文案） |
| MIX_CUSTOMER | warning | 有（开关） |
| OVER_CAP | warning | 有 |
| OCCUPANCY | warning | 有 |
| STERILIZE_OVERLAP | warning | 有 |
| PREHEAT_OVERLAP | warning | 有 |
| CAB21 | info | 有 |
| PROC_PENDING | info | 有 |

进炉排序、白班/夜班周期：均有单测。

---

*本报告仅新增于 `docs/验收报告-PR1-MVP.md`，未修改业务功能代码。*
