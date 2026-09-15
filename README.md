# 振德医疗 · 灭菌中心排产 MVP

许昌灭菌中心 EO 自有柜：**待灭菌合格库存 → 日装炉 → 进炉多日甘特**。本仓库为 Vite + TypeScript SPA，对齐详细设计 v1.2 与原型交互。演示种子数据，无真实 SAP/WMS 后端。

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

1. **日排产工作台**：选日期/白班 → 勾选可排行 → 添加灭菌柜炉次 → 分配到选中炉 → 运行校验。
2. **建议拼炉**：将未分配 D002 装入柜 9（策略 `D002_CAB9_DEMO`）。
3. **拆炉向导（场景 A / TC-SPLIT-02）**
   1. 工作台选日期/白班，点「拆炉向导」（演示行 P004 带「需拆炉」）。
   2. 确认拆为 A/B 并分配到目标柜。
   3. 工作台应出现炉次载荷 `P004-A` / `P004-B`。
   4. **硬刷新**（F5）。炉次 `*-A`/`*-B` 仍在；DevTools → Application → Local Storage → `zhende_sterilization_plan_v2` 含 `virtualLines`（`id`/`splitOf`）。
   5. 有拆炉会话时**不会**被演示稀疏重种清掉炉次。
4. **进炉计划**：同步装炉结果 → 甘特分段条 → 点柜看顺序队列；视野 7/14/21。
5. **校验中心 / 主数据**：错误跳转炉次；柜 21、亚澳、EO 通用带琥珀色「待确认」。
6. **导出**：顶栏「导出日计划 CSV」（进炉页隐藏）；UTF-8 BOM。
7. **D002 最低拼载（v1.2）**：工作台「D002 最低拼载 (m³)」改为 `30` 后立刻影响校验与建议拼炉目标。约 40m³ 的 D002 分到柜 9 → `D002_MIN` 按 **30** 判定；改回 `50` 后低于 50 再告警。正式字段 `config.minLoadM3ByProcess.D002`，旧字段 `d002MinLoadM3` 读入迁移。

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
    pool.ts / dates.ts / min-load.ts  # 生效拼载（minLoadM3ByProcess）
  data/
    seed-cabinets.ts / seed-processes.ts / seed-pool.ts / seed-boxspecs.ts
    seed-demo-plan.ts
    config-defaults.ts   # 全部阈值默认值（禁止 UI 魔法数）
  persistence/
    plan-store-v2.ts     # localStorage zhende_sterilization_plan_v2
  ui/                    # 7 页中文界面（对齐原型 IA）
```

侧栏 7 页：`workbench` 日排产工作台 · `furnace-plan` 进炉计划 · `pool` 待灭菌可排池 · `cabinets` 灭菌柜 · `processes` 工艺与指定柜 · `boxspecs` 箱规 · `validation` 校验中心。

## 持久化（plan v2）

- Key：`zhende_sterilization_plan_v2`（兼容读取 `…_v1` 且非稀疏时迁移）
- 字段：`date` / `shift` / `furnaces` / `nextFurnaceSeq` / **`virtualLines: StockLine[]`** / `config` / `planSeedVersion`
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
| `box.largeBoxVol` | 0.12 | 大箱阈值 m³ |
| `box.maxBoxesWhenLarge` | 280 | 大箱每炉箱数上限（&gt;280 才 BOX_LIMIT） |
| `box.boardsPerFurnaceHint` | 30 | 经验提示，**非硬约束** |
| `config.allowFiller` | false | 仅改 TARGET_MIN 文案 |
| `config.mixCustomerWarn` | true | MIX_CUSTOMER 开关 |
| `config.showPendingTags` | true | 琥珀色待确认 |
| `eligibility.locations` | 待灭菌仓·老/新 | 可排地点 |
| `eligibility.stockStatuses` | 非限制 | 可排状态 |
| `suggest.strategy` | `D002_CAB9_DEMO` | |
| `export.blockOnError` | false | 有 error 仍可导出并 toast |
| `demo.enableSeed` / `VITE_ENABLE_DEMO_SEED` | true | 生产请关闭 |
| `fp.defaultHorizon` | 14 | 甘特默认视野 |
| `storage.key` | `zhende_sterilization_plan_v2` | |

解析天数在工艺主数据（D002=2 已确认；P006/P252/亚澳/EO通用 pending）。

## 校验码

**硬**：`CABINET_SCRAPPED`（报废不可添加炉次）、`CABINET_MISMATCH`、`BOX_LIMIT`  
**软**：`D002_MIN`、`TARGET_MIN`、`MIX_CUSTOMER`、`OVER_CAP`、`OCCUPANCY`、`STERILIZE_OVERLAP`、`PREHEAT_OVERLAP`  
**信息**：`CAB21`、`PROC_PENDING`

进炉排序：日期升序 → 白班先于夜班 → 体积降序 → furnaceId 字典序；`seq` 1…n。

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
