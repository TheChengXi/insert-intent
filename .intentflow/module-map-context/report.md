# module-map-context 关账报告

## 1. 项目概览

做一个 DSH 插件：在每个新工作会话首个步骤，把当前工作区 `.intentflow/_packages/` 顶层 `*.yml` 原文拼接后作为 sourced 用户消息注入会话上下文，让模型免扫描即可了解项目模块职责/入口/依赖，省 token 省解释；目录缺失时优雅跳过。

## 2. 计划 vs 实际

- **会话首步注入模块地图** — ✅ 完成（`agent/pre-step` 监听，`step===1` 一次性注入）
- **工作区自适应（无 `_packages` 优雅跳过）** — ✅ 完成（discover 返回空即放行，不报错）
- **yml 原文拼接（不解析/不加引导头）** — ✅ 完成（按文件名排序逐字拼接）
- **装配到 web profile** — ✅ 完成（装入 `~/.dsh/profiles/web/node_modules/module-map-context` + `cordis.patch.yml` insert）
- **注入位置调整** — ✅ 完成（需求原为「最顶端」，用户验证后改为「末尾」，见关键决策 D3）

## 3. 关键决策

- **D1 — `streamText` 改为 `readText`**：真实 `ctx.fs` 的 `streamText(target)` 返回 `Promise<AsyncIterable<string>>`，`for await (x of Promise)` 抛「not async iterable」，被逐文件静默 catch 吞掉 → 所有 yml 被跳过。改为 `await fs.readText(target, signal)`（整串返回）。这是集成期唯一真实 bug，用 headless 真实栈复现定位。
- **D2 — 交付形态从「仅文档」改为「文档 + 代码」**：需求阶段用户选「仅做设计/文档」，随后 `/execute` 要求落地代码，故最终产出含插件源码与装配。
- **D3 — 注入位置从「最前端」改为「末尾」**：需求原文是「注入到上下文最顶端」，用户实测后认为优先级过高（压过用户直接消息/AGENTS.md/运行时上下文的视觉位置），故由 `[snapshot, ...decision.messages]` 改为 `[...decision.messages, snapshot]`。系统提示等更高优先级内容不受影响（模块地图属 user 角色消息）。

## 4. 经验记录

- **有效做法**：用 `dsh --profile headless` 在真实工作区跑一次，再解压 `session.jsonl.zstd` 读持久历史，能 100% 定位「注入到底进没进历史」；比单测和读文档都直接。
- **有效做法**：直接读 `@deepseek-ai/dsh-fs/lib/types/*.d.ts` 的接口签名（`readText(target): Promise<string>`、`streamText(target): Promise<AsyncIterable<string>>`、`listDir(target): Promise<FsDirEntry[]>`），而不是只靠 README 摘要。
- **踩坑**：单元测试的假 fs 签名与真实 fs 不一致（假 `streamText` 直接返回 async 迭代器，真实返回 `Promise<AsyncIterable>`），导致「假绿真红」——单测全绿但真实栈不注入。**教训：mock 系统边界时必须贴着真实类型签名写。**
- **工具反馈**：无。

## 5. 后续待办

- **立即跟进**：重启 `dsh web` 后，在含 `.intentflow/_packages/*.yml` 的工作区开新会话，确认模块地图出现在上下文末尾（用户直接消息 → AGENTS.md → 运行时上下文之后）。
- **长期备忘**：见 `D:\w_dev\insert-intent\.intentflow\module-map-context\later-on.md`
  - L01 递归扫描 `_packages` 子目录
  - L02 顶层 yml 总量字节预算/截断
  - L03 结构化注入（解析 yml 后带引导头重排）
  - L04 会话中途监听 yml 变更增量更新

## 6. 开发工作流反馈

- 需求/设计阶段对 `ctx.fs` 只写了「经 ctx.fs 读取」这一句，没锁定**具体方法名与签名**，导致实现阶段选错 `streamText` 用法。建议：design.md 的「实现对齐」对系统边界调用应落到具体接口签名（或直接在 design 阶段引用 `.d.ts`），把「mock 与真实签名一致」作为测试策略的显式约束。

## 7. 结论

- **当前状态**：需补测（代码与装配已完成，端到端注入已用 headless 真实栈验证通过，注入位置已改为末尾；`dsh web` 待最后一次重启后由用户确认最终位置体验）。
- **建议下一步**：重启 `dsh web` → 实测末尾注入 → 确认后收敛 L01–L04 的后续演进。