# module-map-context 关账报告（缺陷修复迭代）

## 1. 项目概览
`module-map-context` DSH 会话上下文模块地图注入插件：每个新会话首步把 `.intentflow/_packages/*.yml` 原文拼接注入上下文末尾。本迭代是**缺陷修复**：因 DSH 宿主反复重启，原"每会话至多一次"的进程内 `WeakSet` 判定失效，导致同一会话每次重启后又被注入，形成反复注入。改为官方一致的**会话投影持久判定**（`ctx.sessionProjections` 折叠已提交事件），使"已注入"跨宿主重启/恢复/压缩不再重复。

## 2. 计划 vs 实际
- **去重判定持久化（跨宿主重启不重复）** — ✅ 完成：`apply` 装配时向 `ctx.get('sessionProjections')` 注册 key=`moduleMapContext` 的会话投影，pre-step 用 `stateOf(session,key)===true` 探测"已注入"，跨重启/恢复/压缩不重复。测试含"同一 durable store 两次 apply（模拟重启）不重复注入"断言。
- **进程内兜底** — ✅ 完成：保留 `createInjectionDecider()`（WeakSet），无投影装配或提交前间隔仍挡同进程重复。
- **工作区自适应（跳过）** — 🔸 部分：进程内"跳过不补注"完成；**跨重启"永久跳过"降级为重新探测**（DSH 只接受内置持久事件类型，第三方无法安全持久化"已跳过"，官方插件亦不持久化跳过）——与需求原确认点偏差，执行前已向用户确认"照官方做"。
- **注入位置/顶层扫描/原文拼接/会话内不刷新** — ✅ 完成：保持现状（注注入位置末尾、`[...decision.messages, snapshot]`），未改动 `discover`/`render`。

## 3. 关键决策
- **D1 — 采用会话投影做持久去重（官方解法）**：需求早期设想"会话持久日志探测 + 写跳过标记"。执行阶段发现 DSH 会话只接受**内置事件类型**，自定义事件因缺 `ignorable` 标记会导致恢复时拒读日志；官方插件（`dsh-tmux-context`）用 `ctx.sessionProjections.register` + `stateOf` 折叠持久事件识别"已注入"，不写自定义事件。照官方改为投影方案。
- **D2 — 跳过判定降级**：`session.append` 写"已跳过"标记不可安全实现（内置类型限制）；官方从不持久化跳过。故"永久跳过"改为：进程内 WeakSet 记住 + 跨重启重探。需求/设计文档均已同步该偏差，并经用户确认。
- **D3 — 投影状态用 `z.boolean()`，init 返 `false` 而非 `null`**：schemastery 无 `z.boolean().nullable()`（nullable 经 `.default()/.required()` 表达），改用 `init:()=>false` + `stateSchema:z.boolean()`，`isModuleMapInjected` 判 `===true`。

## 4. 经验记录
- **有效做法**：去重持久化照官方已交付插件（`dsh-tmux-context` 的 `ctx.sessionProjections.register/stateOf`、`dsh-tool-skill` 的 source 探测）找现成惯例，而非自创；比读文档更快锁定接口。
- **有效做法**：集成测试用"同一 durable store 上两次 `apply`（模拟进程重启）+ 手动 feed 提交事件"验证跨重启去重，避免只在单进程 mock 里自证。
- **踩坑**：mock 会话投影注册表时，同 key 重注册误重置为 init——真实注册表同 key+stateVersion **共享 cell、保留已折叠值**。教训：mock 系统边界要贴着真实契约语义写，不能照自己直觉。
- **踩坑**：schemastery `z.boolean().nullable()` 不存在。教训：改投影 schema 前核对 schemastery 的 nullable 表达方式。

## 5. 后续待办
- **立即跟进**：重启 `dsh web` 让新装配实例生效（本环境即运行中 dsh web，未代为重启以免中断）；重启后在同一会话继续，确认模块地图不再叠加。
- **长期备忘**：见 `D:\w_dev\insert-intent\.intentflow\module-map-context\later-on.md`
  - L01 递归扫描 `_packages` 子目录
  - L02 顶层 yml 字节预算/截断
  - L03 结构化注入
  - L04 会话中途监听 yml 变更增量更新（用户明确不需要）
  - L05 跳过判定若依赖自定义持久事件不可行的降级确认
  - L06 若要会话中途刷新时的 digest 化去重

## 6. 开发工作流反馈
- requirement 阶段把"永久跳过"确认为需求后，execute 阶段才暴露"DSH 内置事件类型限制、无法持久化跳过"这一硬约束，导致一个已确认功能点降级。建议 design 阶段对"持久化/跨重启语义"这类依赖宿主约束的边界，先做一轮宿主接口验证（现成插件惯例 + `.d.ts` 签名），避免把"官方不可能提供的语义"写进需求。
- 接口细节应像本报告 D3 / 既有 D1 教训一样在 design 阶段参照真实 `.d.ts`/源码锁定（投影的 `init`/`apply`/`stateSchema` 签名即属此列）。

## 7. 结论
- **当前状态**：可发布（代码/装配已同步至 `~/.dsh/profiles/web/node_modules/module-map-context`，集成测试全绿且 3 次循环稳定；待用户重启 `dsh web` 生效验证最终体验）。
- **建议下一步**：重启后在同一会话实测"重启不重复"，确认位置与去重体验；若确认，收敛"永久跳过降级"这一已知偏差，并视需要评估 L05/L06。
