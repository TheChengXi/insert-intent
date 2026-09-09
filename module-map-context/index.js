/**
 * @intent
 * module-map-context 插件入口：装配 agent/pre-step 监听，在“新会话首个步骤”读取项目根下
 * .intentflow/_packages 顶层 *.yml 原文拼接，作为 sourced 用户消息快照追加到该步骤批次末尾
 * （位于直接用户消息、AGENTS.md 基线、运行时上下文之后，不抢占高位）。缺失目录/无 fs provider/
 * 非首步/会话已注入时直接放行，不报错。
 *
 * 边界：仅 step===1 且会话未注入过时注入；decision reject 或 signal 已中止时不注入；无 fs provider
 * 或 _packages 缺失（discover 返回空）时原样返回 decision；注入消息 source 为
 * { kind:'plugin', plugin, form:'snapshot', sections:[{name,text}] }；注入顺序在末尾
 * （[...decision.messages, snapshot]）。后续步骤/压缩恢复后不重复注入。
 *
 * 验收条件：
 * - 导出 { name, inject, Config, apply }，装配名 name === 'module-map-context'
 * - 首步且未注入、且有模块地图时：decision 变 { kind:'enter', messages:[...原消息, 模块地图快照] }
 * - 非首步 / 已注入会话 / _packages 缺失 / 无 fs provider：decision 原样返回
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
 * 装配插件——注册 agent/pre-step 监听并进行首步模块地图注入。
 * @param ctx cordis 插件上下文
 */
export function apply(ctx) {
  const decider = createInjectionDecider();
  ctx.on(
    'agent/pre-step',
    async ({ agent, step, signal }, next) => {
      const decision = await next();
      if (decision.kind === 'reject' || signal.aborted) return decision;
      if (!decider.isDue(agent.session, step)) return decision;
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
      decider.markInjected(agent.session);
      return { kind: 'enter', messages: [...decision.messages, snapshot] };
    },
    { prepend: true }
  );
}