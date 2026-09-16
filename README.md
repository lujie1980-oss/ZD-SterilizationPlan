# 振德医疗 · 灭菌中心排产 MVP

许昌灭菌中心 EO 自有柜：**待灭菌合格库存 → 组柜（未排）→ 进炉甘特写回上线日期**。本仓库为 Vite + TypeScript SPA，对齐领域模型 v1.1 与变更-1（上线日期解耦 + 组柜双入口）。演示种子数据，无真实 SAP/WMS 后端。

## 运行

```bash
npm install
npm run dev      # 开发服务器
npm run build    # tsc --noEmit && vite build
npm test         # Vitest 领域单测
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。角色展示固定为「计划员 · 王工」，本期无鉴权。

生产构建关闭演示稀疏重种：

```bash
VITE_ENABLE_DEMO_SEED=false npm run build
```

## 演示路径（验收）

1. **组柜（变更-1 主路径）**
   1. 侧栏「组柜」默认进入。入口 **选柜 / 选需求**，无上线日期筛选、无白夜班切换。
   2. **选柜**：点柜 9 → 完整可进列表分栏「已进本柜 / 还可排入 / 已进其他柜」；灭菌中柜（演示柜14）灰显禁用但仍可见。
   3. 点「自动组柜」：按当前 **建议策略**（默认填满优先 80%、交期簇关）挑行；可见分层（托盘主数据）→ 装柜；柜卡「未排」，`date/shift=null`，**不建 CabinetTask**。层体积超过 `Tray.capacityM3` 时分层卡片显示红色「超托盘」且 `TRAY_OVERFLOW` error（C1-28：auto 拒绝落盘，手工可落盘+强预警）；装柜率分母仍为柜 `ratedLoadM3`。
   4. **建议策略面板**：预设（填满优先 / 交期簇优先 / 多柜均衡 / 自定义）、先填满一台 vs 多柜均衡、目标装柜率 70%～95%、交期簇开关与窗口天数。点「保存策略」只写入 `config.packSuggestPolicy`，**不**改写已有载荷；点「自动组柜」才按新策略重算。「恢复默认」回到填满优先 80% + 交期窗 3 天 + 交期簇关。硬约束与双模式不可配掉。
   5. **选需求**：单击行只查看可组柜列表（不勾选）；勾选框才进入多选批量。自动组柜按策略为行选柜（填满优先集中一台，多柜均衡分散）。
   6. 自动模式 error 不落盘；手工调整可违例。FactStrip / 自动|手工闸门（二期 A）仍在。
   7. **C1-31 装填完毕**：点「装填完毕」后柜为待入炉（不当空闲）。自动排产再拼 **拒绝落盘**；切「手工调整」可再拼，组柜红条 + 校验中心 `REPACK_AFTER_LOAD_COMPLETE`。
   8. **C1-40 OnTray 分量**：写入箱数/体积不得超过该 StockLine 剩余可排量（已占用 OnTray 之和）；超量 `ON_TRAY_QTY_OVERFLOW` 拒绝自动落盘。
2. **已排期浏览（过渡）**：原日排产工作台。顶部日期只过滤**已排期**结果，不作为组柜前置。
3. **建议拼炉**：将未分配 D002 装入柜 9（策略 `D002_CAB9_DEMO`），结果为未排。
4. **拆炉向导（场景 A / TC-SPLIT-02）**
   1. 过渡页选日期/白班，点「拆炉向导」（演示行 P004 带「需拆炉」）。
   2. 确认拆为 A/B 并分配到目标柜。
   3. 工作台应出现炉次载荷 `P004-A` / `P004-B`。
   4. **硬刷新**（F5）。炉次 `*-A`/`*-B` 仍在；DevTools → Application → Local Storage → `zhende_sterilization_plan_v2` 含 `virtualLines`（`id`/`splitOf`）。
   5. 有拆炉会话时**不会**被演示稀疏重种清掉炉次。
5. **进炉计划**：同步装炉结果 → **才创建 CabinetTask 链**（prev/next/FirstTask/IsFirst）并写回 date/shift/seq → 甘特分段条。交期 `due` 不变。
6. **校验中心 / 主数据**：错误跳转炉次；柜 21、亚澳、EO 通用带琥珀色「待确认」。灭菌柜页展示额定装载 `ratedLoadM3` 与托盘层数。
7. **导出**：顶栏「导出日计划 CSV」（进炉页/组柜页隐藏）；UTF-8 BOM；**未排载荷默认不含**。
8. **D002 最低拼载（v1.2）**：过渡页「D002 最低拼载 (m³)」改为 `30` 后立刻影响校验与建议拼炉目标。约 40m³ 的 D002 分到柜 9 → `D002_MIN` 按 **30** 判定；改回 `50` 后低于 50 再告警。正式字段 `config.minLoadM3ByProcess.D002`，旧字段 `d002MinLoadM3` 读入迁移。
9. **二期 A · 池事实标注（REQ-2.1）**：组柜需求行、过渡页可排池与「待灭菌可排池」行内 **FactStrip**（交期临近/逾期、指定柜是/否+柜列表、适用规则芯片）。只读派生，不跑全量校验；点击打开说明抽屉，不代替校验中心。
10. **二期 A · 双模式约束（REQ-2.5）**：组柜与过渡页「自动排产 | 手工调整」写入 `config.scheduleMode`（默认 `auto`，刷新不丢）。
   - **自动排产**：分配 / 改柜 / 拆炉确认 / 自动组柜若 `sev==='error'` → **拒绝落盘**（toast）。
   - **手工调整**：允许 error 落盘；炉卡红条「手工违例」；校验中心强预警；「违例原因（建议填写）」写入 `config.overrideNotes[furnaceId]`，**空原因不阻断**。
   - **建议拼炉**无论 UI 模式，内部 `editSource='auto'`，有 error **整次回滚**。
   - 切回 auto 不清除已有炉次；含 error 的炉次标「需手工处理或改回合法」，新的自动写入仍禁止 error。

## 模块地图

```
src/
  domain/
    entities.ts          # 领域类型与校验码
    rule-engine.ts       # 硬/软/info 约束
    entry-scheduler.ts   # 进炉排序 + 周期 + 重叠
    split-wizard.ts      # 拆炉虚拟行
    suggest-combine.ts   # D002 → 柜9 演示拼炉
    export-csv.ts        # 日计划 CSV
    grouping.ts          # 双入口完整可进列表 / 自动组柜 / 装填完毕
    pack-suggest-policy.ts # 变更-3 组柜建议策略（校验 / 打分 / 预设）
    cabinet-content.ts   # CabinetContent + TraysInCabinetContent + StockLinesOnTray
    cabinet-task.ts      # 甘特才建 Task 链并写回 date/shift
    cabinet-runtime.ts   # 柜运行态（与主数据分离）
    facts.ts             # 池行 FactStrip 派生（不跑全量校验）
    commit-gate.ts       # 双模式提交闸门（auto 拒 error / 建议拼炉强制 auto）
    pool.ts / dates.ts / min-load.ts  # 生效拼载（minLoadM3ByProcess）
  data/
    seed-cabinets.ts     # Cabinet + Tray 主数据（额定装载 / 一托盘一层）
    seed-processes.ts / seed-pool.ts / seed-boxspecs.ts
    seed-demo-plan.ts    # 未排组柜种子
    config-defaults.ts   # 全部阈值默认值（禁止 UI 魔法数）
  persistence/
    plan-store-v2.ts     # localStorage zhende_sterilization_plan_v2（contents 双写 furnaces）
  ui/                    # 中文界面（组柜双入口 + 过渡日排产）
```

侧栏：`grouping` 组柜（选柜/选需求）· `workbench` 已排期浏览（过渡）· `furnace-plan` 进炉计划 · `pool` 待灭菌可排池 · `cabinets` 灭菌柜 · `processes` 工艺与指定柜 · `boxspecs` 箱规 · `validation` 校验中心。

## 持久化（plan v2）

- Key：`zhende_sterilization_plan_v2`（兼容读取 `…_v1` 且非稀疏时迁移）
- 字段：`date` / `shift` / `furnaces`（= `contents` 双写，含可选 `manualViolation`） / `contents` / `tasks` / `runtimes` / `schedules` / `nextFurnaceSeq` / **`virtualLines: StockLine[]`** / `config`（含 **`scheduleMode`**、可选 **`overrideNotes`**、**`packSuggestPolicy`**） / `planSeedVersion`
- 组柜结构：`CabinetContent` → `TraysInCabinetContent`（必填 `trayId`）→ `StockLinesOnTray`；旧 `FurnaceRun`/`Layer`/`OnLayer` 仅为类型别名
- 组柜阶段 `date`/`shift`/`taskId` 为 null；进炉同步写回并建 `CabinetTask` 链（prev/next/FirstTask/IsFirst）
- 旧快照缺 `scheduleMode` 时缺省为 **`auto`**；切换模式不清除炉次
- 旧快照皆有 date 时视为 **scheduled**（C1-08）
- 拆炉确认时 upsert 虚拟行；load 时 merge 进可排池，保证 `poolById('P004-A')` 可解析
- 稀疏判定（演示）：可见有载炉次 &lt; 5 或涉及柜数 &lt; 5 → 可重种
- **例外**：存在 `virtualLines[]` 或炉次已挂 `*-A`/`*-B` 时视为拆炉会话，刷新/进炉同步都不得清炉次
- 种子版本：`planSeedVersion = 2`

## 配置键（§14）

| 键 | 默认 | 说明 |
|----|------|------|
| `cycle.preheatDays` | 0.5 | 白班预热 |
| `cycle.sterilizeDays` | 1 | 灭菌示意 |
| `cycle.biDays` | 2 | BI 示意（工作台可改，甘特随之变） |
| `cycle.nightSterilizeOffsetDays` | 0.5 | 夜班灭菌起点错开 |
| `config.minLoadM3ByProcess` | `{ D002: 56 }` | v1.2 正式：按工艺覆盖最低拼载 |
| `d002MinLoadM3` | 56 | 旧字段；读入迁移到 map，写出与 D002 同步 |
| `Process.minLoadM3` | D002=56 | 工艺主数据默认；无 map 项时回退 |
| `load.defaultMinM3` | 60 | 其他目标拼载 |
| `box.largeBoxVol` | 0.12 | 大箱单箱体积阈值 m³ |
| `box.maxBoxesWhenLarge` | 280 | v1.3：每炉**大箱箱数合计**上限（`sum(boxes where boxVol ≥ largeBoxVol)` &gt;280 才 BOX_LIMIT；炉总箱数不触发） |
| `box.boardsPerFurnaceHint` | 30 | 经验提示，**非硬约束** |
| `config.allowFiller` | false | 仅改 TARGET_MIN 文案 |
| `config.mixCustomerWarn` | true | MIX_CUSTOMER 开关 |
| `config.scheduleMode` | `'auto'` | 二期 A：`auto` 时 error 拒绝落盘；`manual` 允许 error + 手工违例红条 |
| `config.overrideNotes` | `{}` | 手工违例原因（建议填写，按 furnaceId；空不阻断保存） |
| `eligibility.locations` | 待灭菌仓·老/新 | 可排地点 |
| `eligibility.stockStatuses` | 非限制 | 可排状态 |
| `suggest.strategy` | `D002_CAB9_DEMO` | |
| `export.blockOnError` | false | 有 error 仍可导出并 toast |
| `demo.enableSeed` / `VITE_ENABLE_DEMO_SEED` | true | 生产请关闭 |
| `fp.defaultHorizon` | 14 | 甘特默认视野 |
| `fillRateDenom` | `ratedLoadM3` | 装柜率分母（不用日产能） |
| `grouping.skipInOtherCabinet` | true | 自动组柜跳过已进其他柜 |
| `config.packSuggestPolicy` | 填满优先 80%，交期簇关 | 变更-3：组柜自动建议。`fillMode`=`fillOneFirst`\|`balanceAcrossCabinets`；`targetFillRate` 0.70～0.95；`dueWindowDays` 1～14；`dimensions` 序=优先级（`gapMin` / `targetFill` / `dueCluster`）。缺省或旧 plan 无字段视为默认。非法配置拒存（`PACK_POLICY_*`）。保存后**下次自动组柜**生效 |
| `storage.key` | `zhende_sterilization_plan_v2` | |

解析天数在工艺主数据（D002=2 已确认；P006/P252/亚澳/EO通用 pending）。

## 校验码

**硬**：`CABINET_SCRAPPED`（报废不可添加炉次）、`CABINET_MISMATCH`、`BOX_LIMIT`（v1.3：仅大箱合计 &gt; `maxBoxesWhenLarge`；大箱+小箱混炉总箱 500–700 但大箱 ≤280 通过）、`TRAY_OVERFLOW`（层体积 &gt; `Tray.capacityM3`，分层示意「超托盘」；auto 拒落盘 / manual 可落盘+强预警）、`REPACK_AFTER_LOAD_COMPLETE`（装填完毕待入炉：自动禁再拼；手工再拼须强预警）、`ON_TRAY_QTY_OVERFLOW`（OnTray 箱/体积分量超过 StockLine 剩余可排量）  
**软**：`D002_MIN`、`TARGET_MIN`、`MIX_CUSTOMER`、`OVER_CAP`、`OCCUPANCY`、`STERILIZE_OVERLAP`、`PREHEAT_OVERLAP`  
**信息**：`CAB21`、`PROC_PENDING`

进炉排序：日期升序 → 白班先于夜班 → 体积降序 → furnaceId 字典序；`seq` 1…n。

**提交闸门（二期 A）**：复用上表 RuleEngine 结果。`scheduleMode=auto` 或 `editSource=auto`（建议拼炉）时任一 `error` 禁止写入 `lines` / `virtualLines`；`scheduleMode=manual` 且人工操作允许写入并置 `FurnaceRun.manualViolation`。不改变 BOX_LIMIT 口径 2、D002 最低拼载、virtualLines 语义。

## P0 待确认（不阻塞演示）

UI 琥珀色标签 + 规则 `pendingFlag`。**不定稿为业务制度**，客户确认后须回归。

| ID | 主题 | 本版假设 |
|----|------|----------|
| P0-1 | 可排条件 / 库存接口 | 待灭菌仓 ∧ 非限制 ∧ EO；演示池 |
| P0-2 | 工艺 0305、N/K 匹配键 | 行上 process/allowed；匹配键暂 K |
| P0-3 | 柜 21 / 柜台账完整性 | 柜 21 可排 + pending；报废不可选 |
| P0-4 | 指定柜表完整性 | 按设计默认表；亚澳/EO通用 pending |
| P0-5 | 拼载口径 / 填充物 / 30 板 | 毛体积 56/60；allowFiller 仅文案；30 板不进硬约束 |
| P0-6 | 混炉 | 仅混客户 warning 可关 |

明确 **Out**：现场状态回写、电子束/伽玛/委外统一排产、绍兴/南通统一排产权责、真实 SAP/WMS。

## CSV 列（§13.2）

`日期,班次,炉次号,灭菌柜,基地,物料行ID,REF,品名,客户号,工艺,箱数,单箱体积,体积m³,工单,生产批号,加急`

品名双引号；加急 `Y`/`N`；文件名 `日计划_{date}_{shift}.csv`；UTF-8 BOM `\ufeff`。
