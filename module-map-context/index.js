/**
 * @intent
 * module-map-context 插件入口：装配 agent/pre-step 监听，在“新会话全局开头”（首次进入且未被
 * 拒绝的 pre-step）读取项目根 .intentflow/_packages 顶层 *.yml 原文拼接，作为 sourced 用户消息
 * 快照追加到该步骤批次末尾（位于直接用户消息、AGENTS.md 基线与运行时上下文之后）。每个会话只
 * 决定一次：有 yml 就注入，没有就永久跳过——中途才出现的 yml 不补注（等同 AGENTS.md 语义）。
 *
 * 边界：每个会话仅在其首个未被拒绝的 pre-step 决定一次（注入或跳过），之后不再重复，决策标记与
 * 是否真正注入无关；decision reject 或 signal 中止时不注入也不决策；无 fs provider 或 _packages
 * 缺失（discover 返回空）时原样返回 decision；注入消息 source 为
 * { kind:'plugin', plugin, form:'snapshot', sections:[{name,text}] }；注入顺序在末尾
 * （[...decision.messages, snapshot]）。
 *
 * 验收条件：
 * - 导出 { name, inject, Config, apply }，装配名 name === 'module-map-context'
 * - 会话首段有 yml 时：decision 变 { kind:'enter', messages:[...原消息, 模块地图快照] }
 * - 会话首段无 yml、之后才出现 yml：decision 原样返回，永不补注
 * - 无 fs provider / 已决定会话 / reject：decision 原样返回
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import { discoverModuleMap } from './lib/discover.js';
import { renderModuleMap } from './lib/render.js';
import { createInjectionDecider } from './lib/inject-decision.js';

/** 插件装配名（也用于 cordis.patch.yml 的 insert id）。 */
export const name = 'module-map-context';
/** 需要注入的依赖服务：agents（agent/pre-step 事件源）。 */
export const inject = ['agents'];
/** 配置 schema：项目根 marker 列表，默认 ['.git']。 */
export const Config = z.object({
  projectRootMarkers: z.array(z.string()).default(['.git'])
});

/**
 * 装配插件——注册 agent/pre-step 监听，在会话全局开头一次性决定是否注入模块地图。
 * @param ctx cordis 插件上下文
 */
export function apply(ctx) {
  const decider = createInjectionDecider();
  ctx.on(
    'agent/pre-step',
    async ({ agent, signal }, next) => {
      const decision = await next();
      if (decision.kind === 'reject' || signal.aborted) return decision;
      if (!decider.isDue(agent.session)) return decision;
      decider.markDecided(agent.session); // 本会话第一次到达这里：立即决定，之后不再复议
      const entries = await discoverModuleMap(ctx, agent.session, signal).catch(() => []);
      if (entries.length === 0) return decision;
      const text = renderModuleMap(entries);
      const snapshot = createUserMessage({
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: name,
          form: 'snapshot',
          sections: [{ name, text }]
        }
      });
      return { kind: 'enter', messages: [...decision.messages, snapshot] };
    },
    { prepend: true }
  );
}