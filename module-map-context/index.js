/**
 * @intent
 * module-map-context 插件入口：装配 agent/pre-step 监听，在“新会话全局开头”（首次进入且未被
 * 拒绝的 pre-step）读取项目根 .intentflow/_packages 顶层 *.yml 原文拼接，作为 sourced 用户消息
 * 快照追加到该步骤批次末尾（位于直接用户消息、AGENTS.md 基线与运行时上下文之后）。每个会话至多
 * 注入一次：由「会话投影」持久判定（跨宿主重启/恢复/压缩仍成立）+ 进程内 WeakSet 兜底共同保证。
 *
 * 边界：decision reject 或 signal 中止时不注入也不决策；无 fs provider 或 _packages 缺失（discover
 * 返回空）时原样返回 decision（进程内跳过，跨重启由调用方重新探测）；投影注册表不可用时降级为进程内
 * WeakSet 去重；注入消息 source 为 { kind:'plugin', plugin:name, form:'snapshot', sections:[{name,text}] }；
 * 注入顺序在末尾（[...decision.messages, snapshot]）。
 *
 * 验收条件：
 * - 导出 { name, inject, Config, apply }，装配名 name === 'module-map-context'
 * - apply 装配时向 ctx.get('sessionProjections') 注册 key='moduleMapContext' 的会话投影
 * - 会话首段有 yml 且未注入时：decision 变 { kind:'enter', messages:[...原消息, 模块地图快照] }
 * - 已注入（投影 stateOf 为 true）或进程内已判定的会话：decision 原样返回，不重复注入
 * - 会话首段无 yml、之后进程内才出现 yml：decision 原样返回，进程内不补注
 * - 无 fs provider / 已决定会话 / reject：decision 原样返回
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import { discoverModuleMap } from './lib/discover.js';
import { renderModuleMap } from './lib/render.js';
import {
  createInjectionDecider,
  createModuleMapProjection,
  isModuleMapInjected
} from './lib/inject-decision.js';

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
  const projections = ctx.get('sessionProjections');
  if (projections !== undefined) projections.register(createModuleMapProjection());
  const decider = createInjectionDecider(); // 进程内 WeakSet 兜底
  ctx.on(
    'agent/pre-step',
    async ({ agent, signal }, next) => {
      const decision = await next();
      if (decision.kind === 'reject' || signal.aborted) return decision;
      // 会话投影持久判定：跨宿主重启/恢复/压缩后仍识别「已注入」，不重复注入
      if (projections !== undefined && isModuleMapInjected(projections, agent.session)) return decision;
      if (!decider.isDue(agent.session)) return decision;
      decider.markDecided(agent.session); // 进程内本会话第一次到达这里：立即决定，之后不再复议
      const entries = await discoverModuleMap(ctx, agent.session, signal).catch(() => []);
      if (entries.length === 0) return decision; // 跳过（进程内持久；跨重启由官方语义重探）
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