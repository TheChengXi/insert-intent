# 设计文档：module-map-context — 「每会话至多一次」去重判定持久化（缺陷修复）

> 既有项目（插件已装配到 web profile），本迭代为缺陷修复，**顺应原有 4 层结构**（装配/判定/渲染/发现），只改「判定」一层，其余不动。

## 0. 与需求文档的偏差（设计阶段新发现）

- **偏差**：需求写「从该会话持久日志识别是否已有 module-map-context 来源的快照」。设计逐层验证发现，DSH 会话对象提供持久日志的**逐事件读取**接口——`agent.session.eventAt(seq)` + `agent.session.seq`（对齐 `dsh-tool-skill` 的 skill-catalog 探测：`event.type==='user/message' && event.data.source.kind===...`），以及整段读取 `agent.session.snapshotEvents(fromSeq, toSeqExclusive)`。已注入的 `user/message` 事件携带 `event.data.source`。— **影响**：判定采用「遍历 `0..session.seq`、`eventAt(i)` 过滤 source」的方式，落在已验证接口上，避免重蹈报告 D1「选错接口」覆辙。
- **偏差**：需求假设「跳过判定也跨重启持久」需要一个持久载体。设计确认 `session.append(type, data)` 可写**仅记日志事件**（`dsh-plan-mode` 用 `session.append('plan/mode', {active})` 持久每会话状态）。— **影响**：判定「跳过」时写一条本插件的仅记日志标记；判定「注入」时无需额外标记——注入快照本身即持久凭证。
- **偏差**：需求把根因锚定进程内 `WeakSet`。设计确认现有结构正是如此，且 `agent.session` 就是带 `eventAt/seq/append` 的持久 Session，可在 fresh 进程正确读到历史。— **影响**：去重迁移到持久语义即可闭环，无需进程内存。\n- **偏差（执行阶段新发现，官方解法）**：DSH 会话持久日志**只接受内置事件类型**；第三方（下游插件）append 自定义类型会因缺 `ignorable` 标记导致恢复时拒读日志。因此需求早期设想的「写跳过标记持久」**不可安全实现**。官方解决持久去重用的是**会话投影**（`ctx.sessionProjections.register` + `stateOf`）：`dsh-tmux-context`（`lib/index.js:1491-1543`）注册投影，apply 只认 `user/message` 且 `source.kind==='plugin' && source.plugin==='tmux-context'` 的事件来驱动 state，pre-step 用 `stateOf(session,key)` 读回「是否已注入」。投影在**已提交（持久）事件**上驱动，故跨重启成立，且**不写任何自定义持久事件**。— **影响**：去重改为「注册会话投影 + `stateOf` 探测」，注入快照即持久凭证；`session.append` 方案废弃。

## 1. 模块清单

沿用现有 4 层，只改「判定」层。

- **装配接线（上层）**：`index.js` — 职责：注册 `agent/pre-step`（`prepend:true`），编排「判定 → 渲染 → 发现」，构造最终注入。本次改动：调用方从「无条件 markDecided」改为「isDue 持久探测 + 空内容时 markSkipped」。依赖：判定层、渲染层、发现层。
- **注入判定（中间层·本次改动核心）**：`lib/inject-decision.js` — 职责：判断本会话是否「已判定（注入或跳过）」；是 → 放行不处理；否 → 判定并持久化。本次改造其内部从进程内 `WeakSet` 改为**会话持久日志探测**。依赖：`agent.session` 的系统边界（读 `eventAt`/`seq`、写 `append`）。
- **渲染拼接（中间层）**：`lib/render.js` — 职责：按文件名排序、逐字拼接各 yml 原文，构造 sourced 快照源。依赖：无（纯函数）。**本次不动**。
- **发现读取（低层）**：`lib/discover.js` — 职责：marker 定位项目根，枚举 `.intentflow/_packages/*.yml`，「经 `ctx.fs`」读取。依赖：`ctx.fs`（系统边界）、`session.header.cwd`。**本次不动**。

**依赖方向体检**：`apply(上层)` → `判定/渲染(中层)` → `发现/会话持久日志(低层/系统边界)`。判定层新依赖会话持久日志（系统边界）——中层依赖低层，**无反向、无跨层**；渲染/发现不依赖判定；判定不依赖渲染。原有结构无跨层依赖可查，不需要本次一并修复的既有跨层项。

## 2. 最小依赖链

从装配到数据层跑通本次修复的关键路径和接口：

```
apply(ctx) [agent/pre-step, prepend:true]                    (上层)
  → await next() → decision；reject/abort 原样返回
  → decider.isDue(agent.session)                              (判定·读系统边界)
        = 遍历 i∈[0, session.seq)：session.eventAt(i)
          是否存在 event.type==='user/message'
          && event.data.source.kind==='plugin'
          && event.data.source.plugin==='module-map-context'
          || 是否存在本插件「已跳过」仅记日志标记事件
        → 存在 → 已判定，原样返回 decision（不注入）
  → [若空内容] decider.markSkipped(agent.session)            (判定·写系统边界)
        = 追加一条本插件仅记日志标记事件：session.append(<判定标记>, …)
        → 原样返回 decision
  → [有内容] discoverModuleMap(ctx, session, signal)         (低层·ctx.fs)
  → renderModuleMap(entries) → createUserMessage(snapshot)   (中层·纯函数)
  → 返回 {kind:'enter', messages:[...decision.messages, snapshot]}  (注入；快照即持久凭证)
```

**跨层体检**：判定层只经 `agent.session` 的持久日志读写（系统边界），不依赖渲染/发现/装配；发现层只依赖 `ctx.fs` 与 `session.header.cwd`；渲染零依赖。逐层无反向依赖→**无跨层依赖，无本次一并修复项**。

## 3. 测试策略

- **验证方式**：
  - 判定（`injectDecision.isDue/markSkipped` 的探测/标记逻辑）：**单测**，mock 系统边界 `session`，断言「有本插件快照 → not due」「无快照无标记 → due」「跳过标记持久后 → not due」。
  - 首步一次性 + 位置末尾 + 缺失跳过 + **重启后不重复**：**需运行时行为验证**（真实 headless 栈）。
- **依赖注入点**：判定层经**构造/参数**注入 `agent.session`（由 `apply` 从 pre-step payload 传入），不在内部自建 session；`markSkipped` 的 `session.append` 与 `isDue` 的 `eventAt/seq` 都走该 session，mock 即 mock 这个 session。
- **Mock 边界**：只 mock 系统边界——`session`（持久日志读/写）作单测注入点；**不 mock** 内部协作者（渲染原文拼接、发现排序用真实实现单测）。
- **验证命令**（对齐报告「读真实持久历史」技巧，避免假绿真红）：
  - [单测判定]：判定层单测跑过 — 预期：isDue/markSkipped 的持久探测各分支断言通过。
  - [装配生效]：`dsh web --dump-config` — 预期：`module-map-context` 出现在装配树。
  - [首步注入一次]：在含 `_packages/*.yml` 工作区起新会话发首条消息 — 预期：上下文末尾出现各 yml 原文拼接，位于用户消息/AGENTS.md/运行时上下文之后。
  - [重启不重复]：会话保持打开，**重启 dsh web** 回同一会话继续 — 预期：解压 `session.jsonl.zstd` 读持久历史，`module-map-context` 来源的 `user/message` **仅一条**。
  - [缺失跳过·重启不补]：无 `_packages` 工作区首步跳过；重启后有 `_packages` — 预期：同会话持久历史含「已跳过」标记，仍未注入模块地图。

## 4. 决策记录

- **决策 D-去重1：去重改为「会话投影」持久判定（官方解法）**
  - **理由**：`WeakSet` 随进程重启清空，是反复注入根因。官方（`dsh-tmux-context`）用 `ctx.sessionProjections.register` + `stateOf` 在已提交持久事件上驱动「本插件是否已注入」，跨重启/恢复成立，且不写自定义持久事件类型（避开内置类型限制）。对齐此惯例，探测条件定为 `user/message` 且 `source.kind==='plugin' && source.plugin==='module-map-context'`。
  - **影响**：判定层新增对 `ctx.sessionProjections`（系统边界服务）的依赖；`apply` 装配时注册投影、pre-step 用 `stateOf` 探测「是否已注入」。同时**保留进程内 `WeakSet` 作 fallback**（测试的 mock ctx 无 `sessionProjections` 时仍保住同进程不重复；生产下投影未及时反映提交前也可挡一次）。

- **决策 D-去重2：识别依据用来源标识（kind/plugin），不做 digest 比对**
  - **理由**：用户明确「固定快照、会话中途不刷新」，无「内容变更重注」需求，故只需判断「是否存在本插件来源」；做文本 digest 比对是 `dsh-tmux-context` 的重注驱动模式，这里不需要。探测条件定死为 `source.kind==='plugin' && source.plugin==='module-map-context'`。
  - **影响**：探测 O(会话事件数) 遍历，最坏全量扫一次；不随内容比较，实现最简。若未来要刷新（L04）再加 digest——不做预留。

- **决策 D-跳过：跳过判定降级为「重启后重新探测」（官方一致）**
  - **理由**：需求原确认「首步无内容则本会话永久跳过、跨重启不补」。执行阶段发现 DSH 只接受内置持久事件类型，第三方无法安全地持久化「已跳过」判定；且**官方插件从不持久化跳过/未注入判定**——投影只在「确实注入消息」时非空，未注入则始终为初始值，重启后重新评估。故照官方语义：首步无内容 → 本会话内（进程内 `WeakSet`）记住不补；跨重启 → 重新探测 `_packages`，有内容则注入一次。
  - **影响**：与需求「永久跳过」有一处偏差（跨重启后若目录出现会补注一次），作为设计阶段新发现记录；注入分支快照即持久凭证，无需任何自定义持久事件。

- **决策 D-边界：改造限于 `lib/inject-decision.js`（判定层），不新增顶层模块**
  - **理由**：本工作区项目局部小、分块处理，遵循「顺应原有结构、最小改动」；4 层拆分（装配/判定/渲染/发现）已适配，判定层自恰即可，无需为少量探测逻辑抽新层。
  - **影响**：新文件=无（可选：如需纯函数化便于单测，可把"source 命中判定"抽为 `lib/inject-decision.js` 内部导出的小纯函数，不建独立模块）。`index.js` 仅调整 `apply` 内两处调用点（isDue 语义、空内容 markSkipped），不涉渲染/发现。

## 5. 改动点清单（已有项目）

**改动已有文件**：
- `module-map-context/lib/inject-decision.js` — 判定改造成「会话投影持久判定 + 进程内 WeakSet 兜底」：
  - 保留 `createInjectionDecider()`（进程内 `WeakSet`，作为 fallback：无 `sessionProjections` 的装配或提交前间隔仍挡同进程重复）；
  - 新增 `createModuleMapProjection()`（投影定义）：`{key:'moduleMapContext', stateVersion:1, stateSchema:z.boolean().nullable(), init:()=>null, apply:(state,event)=>` 只在 `event.type==='user/message' && event.data.source.kind==='plugin' && event.data.source.plugin==='module-map-context'` 时置 `true`，否则原样 `state`；
  - 新增 `isModuleMapInjected(projections, session)`：`projections?.stateOf?.(session,'moduleMapContext')===true`。
- `module-map-context/index.js` — `apply` 内判定调用点调整：
  - `const projections = ctx.get('sessionProjections'); if (projections !== undefined) projections.register(createModuleMapProjection());`
  - pre-step：reject/abort 原样返回 → `if (projections !== undefined && isModuleMapInjected(projections, agent.session)) return decision;`（跨重启持久去重）→ `if (!decider.isDue(agent.session)) return decision; decider.markDecided(agent.session);`（进程内兜底）→ `discover` → 空内容 `return decision`（跳过；跨重启会重探，见 D-跳过）→ 有内容走注入 `{kind:'enter', messages:[...decision.messages, snapshot]}`。

**新增文件**：无。

**不动**：`lib/discover.js`、`lib/render.js`、注入位置（末尾）、装配方式、注入消息 source 形态。
