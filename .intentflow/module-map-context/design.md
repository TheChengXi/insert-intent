# 设计文档：会话上下文模块地图注入（module-map-context）

> 交付形态：本迭代**仅文档**，代码留待后续执行阶段落地。本设计面向将要新增的独立 DSH 插件包。

## 项目状态判定

- **新模块**（插件代码从无到有），但应**顺应 DSH 既有插件结构**：锚点 = `@deepseek-ai/dsh-time-context`（`agent/pre-step` 快照注入）与 `@deepseek-ai/dsh-agent-instructions`（`ctx.fs` 读取、durable 上下文折入）。新插件复刻这两者的装配/折入/读取约定，不发明新分层。

---

## 0. 与需求文档的偏差（设计阶段新发现）

- **偏差**：需求提到 `.intentflow/_packages` "必定存在于每个工作区"，但实测当前工作区（`D:\w_dev\insert-intent`）与 `D:\w_dev\intent-flow` **都不存在**该目录。— **影响**：把它当作"约定目录"能力，按"若存在则注入，否则跳过"实现，装配始终可安全启用；不要求工作区现在就建目录。
- **偏差**：`time-context` 是"每个合格步骤都可重复"的快照；`agent-instructions` 是"基线 + 压缩后被遮蔽则重新补入"。用户明确选"**仅新会话首个步骤注入一次**"。— **影响**：不复用 agent-instructions 的"压缩后重补/恢复会话 re-arm"逻辑；只做首步一次性折入，实现更简单。
- **偏差**：用户选"**yml 原文拼接、不加引导头**"。— **影响**：不需 yml 解析/校验，不引入任何解析依赖；下层只做"枚举 + 读取 + 拼接"，无结构化中间模型。

---

## 1. 模块清单

新插件按 DSH bundle 惯例组织为单包 `@deepseek-ai/dsh-intentflow-context`（工程内暂名 `module-map-context`），内部再分四层：

- **装配接线（上层）**：`apply(ctx, config)` — 职责：校验配置、注册 `agent/pre-step` 监听（`prepend:true`）、编排"注入决策 → 渲染 → 读取"；依赖：注入决策层、渲染层、发现层。
- **注入决策（中间层 1）**：`injectDecision(agent, turn)` — 职责：判断是否本会话首个合格步骤、是否已注入过；职责：只做一次；依赖：发现层（探测目录是否存在）。
- **渲染拼接（中间层 2）**：`renderConcat(files)` — 职责：按文件名排序、逐字拼接各 yml 原文，构造 sourced `user/message` 快照源；依赖：无（纯函数）。
- **发现读取（低层）**：`discover(ctx, fs, session)` — 职责：定位项目根（marker 如 `.git`）、枚举 `.intentflow/_packages/*.yml`（仅顶层、不递归）、经 `ctx.fs` 读取内容；依赖：`ctx.fs` provider、`dsh-session` 的 `session.header.cwd`。

**依赖方向**：`apply`（上）→ `injectDecision`/`renderConcat`（中）→ `discover`（低）→ `ctx.fs`（系统边界）。低层不依赖任何上层模块。

### 类型与来源形态

- 注入消息采用 `time-context` 的**快照形态**：`source = { kind: 'plugin', plugin: 'module-map-context', form: 'snapshot', sections: [{ name: 'module-map-context', text: <拼接原文> }] }`，内容是 `user` 角色的文本消息，经 `createUserMessage({content:[{type:'text', text}]})` 构造。
- 位置：折入首步 `decision.messages` **的最前端**（`[...snapshotMessages, ...decision.messages]`），确保位于首条用户消息之前、处于上下文顶端。

---

## 2. 最小依赖链

从装配到数据层跑通本次需求的关键路径：

```
apply(ctx) [注册 agent/pre-step]
   → injectDecision (首步判断 + 探测 _packages 是否存在)
   → renderConcat (排序 + 原文拼接 + 构造快照源)
   → discover (marker 定位项目根 + 枚举顶层 *.yml + ctx.fs 读取)
   → 折入 decision.messages 最前端 → 进入持久历史
```

**跨层依赖体检**：上述链路严格自上而下；`discover` 只依赖系统边界 `ctx.fs` 与 `session.header.cwd`，不反向依赖 `apply`/`render`。**无跨层依赖**，无需本次修复项。

---

## 3. 测试策略

- **验证方式**：
  - `Config` 归一化 / 排序拼接：**类型/肉眼可验证**（纯函数，单测断言输入输出）。
  - 首步一次性 + 位置前置 + 缺失目录跳过：**需运行时行为验证**（起一个真实会话，检查首个请求历史顶端与重复性）。
  - 装配生效：**配置可验证**（`--dump-config` 确认插件已装入）。
- **依赖注入点**：`discover` 通过 **构造/参数注入** `ctx.fs` 与 `session.header.cwd`，不在内部自建 fs；`apply` 通过参数接收 `config`。
- **验证命令**（代码留待后续，此处记录届时命令）：
  - [装配生效]：`dsh web --dump-config` — 预期：`module-map-context` 出现在装配树。
  - [会话首步注入]：在含 `_packages/*.yml` 的工作区起新会话发首条消息 — 预期：上下文最顶端出现各 yml 原文拼接（位于首条用户消息之前），且该会话后续步骤不再重复注入。
  - [缺失目录跳过]：在无 `_packages` 的工作区起会话 — 预期：不注入、正常会话、无报错。
- **Mock 边界**：只 mock 系统边界 —— `ctx.fs`（IO）作注入点 mock；内部协作者（排序/拼接/决策）不 mock，用真实实现单测。

---

## 4. 决策记录

- **决策 1：采用 `time-context` 式 `snapshot` 快照形态，而非 `agent-instructions` 式 `instructions` 基线形态**
  - **理由**：用户明确"仅新会话首步一次、压缩后不重补、不加引导头"。snapshot 形态契合"一次性注入、不复基线重补"；instructions 形态自带"Workspace instructions may be relevant…"引导头、且内含压缩重补 re-arm 逻辑，与需求相悖。
  - **影响**：实现不含压缩重补、不含引导框；注入即为一条持久 sourced 快照。

- **决策 2：经 `ctx.fs` provider 读取，不静态注入 `fs`、不直接用 Node fs**
  - **理由**：与 `agent-instructions` 一致，文件读取走 DSH 文件沙箱/观测策略边界；无 provider 的装配不读取也不报错。
  - **影响**：`discover` 依赖 `ctx.fs` 的 resolve/stat/read 接口；这是唯一系统边界注入点。

- **决策 3：项目根用 marker（默认 `.git`）定位，读 `项目根/.intentflow/_packages/*.yml`，而非 `session.cwd` 相对路径**
  - **理由**：`.intentflow/_packages` 是"每个工作区顶层的固定目录"，以项目根锚定最稳；若从 cwd 相对解析，子目录内启动会找错位置。
  - **影响**：`discover` 需跑祖先链找最近 marker，行为与 `agent-instructions` 的项目根发现一致。

- **决策 4：文件名排序拼接、逐字保留、不设字节预算**
  - **理由**：用户选"原文拼接、不加引导头"，且要求同一工作区下顺序稳定；排序保证确定性。无预算以保持"原文不变"的语义。
  - **影响**：若未来某工作区顶层 yml 总量过大，可能产生超大注入；此为已知取舍，列入 later-on（L02），当前不预留截断逻辑。

- **决策 5：仅顶层 `*.yml`，不递归子目录**
  - **理由**：用户明确"仅顶层"。模块 yml 约定平铺于 `_packages` 根。
  - **影响**：`discover` 只枚举该目录一层；嵌套结构留待 later-on（L01）。

---

## 5. 改动点清单（已有项目）

本特征为**新增独立插件包**，不改动任何既有 DSH 包。新增文件清单（代码留待后续执行阶段）：

- `packages/insert-intent/module-map-context/`（新包，工程内暂名，装配名 `module-map-context`）
  - `package.json` — 插件元数据、peerDependencies（`@deepseek-ai/dsh-agent`、`dsh-session`、`dsh-invariants`、`cordis`）
  - `src/index.ts` — `{ name, Config, inject, apply }`：配置校验 + 注册 `agent/pre-step` 监听 + 编排
  - `src/inject-decision.ts` — 首步一次性 + 缺失目录探测
  - `src/render-concat.ts` — 排序 + 原文拼接 + 构造快照源（纯函数）
  - `src/discover.ts` — marker 定位项目根 + 枚举顶层 `*.yml` + `ctx.fs` 读取
  - `src/invariant.ts`（可选伴生，对齐 `time-context/invariant` 惯例）— 校验注入快照形态
  - `tests/...` — 上述纯函数单测（后续执行阶段）
