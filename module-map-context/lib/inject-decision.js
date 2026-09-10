/**
 * @intent
 * 会话「每会话至多注入一次」的判定层：提供进程内 WeakSet 判定器与「会话投影」持久判定两种能力。
 * 进程内 WeakSet 兜底同进程不重复；会话投影（ctx.sessionProjections）在已提交（持久）事件上折叠，
 * 只认 module-map-context 来源的 user/message 置「已注入」标记，使判定跨宿主重启/恢复/压缩仍成立，
 * 且不写自定义持久事件类型（DSH 只接受内置事件类型）。
 *
 * 边界：探测仅看本插件来源（source.kind==='plugin' && source.plugin==='module-map-context'），不做
 * 内容 digest 比对（固定快照、不刷新）；投影注册表不可用时调用方降级为进程内 WeakSet；跳过判定不
 * 持久化（官方一致，跨重启由调用方重新探测）。探测失败不抛异常，保守视为未注入。
 *
 * 验收条件：
 * - createModuleMapProjection() 的 apply 只在本插件来源 user/message 时返回 true，其余事件原样透传 state
 * - createInjectionDecider() 未决定会话 isDue 为 true；markDecided 后同一会话 isDue 为 false
 * - isModuleMapInjected(projections, session) 在 stateOf===true 时返回 true；无投影或非 true 返回 false
 */
import z from '@deepseek-ai/schemastery';

/** 本插件装配名（注入消息 source.plugin 与投影探测的判别值，须与 index.js 的 name 一致）。 */
export const MODULE_MAP_PLUGIN = 'module-map-context';
/** 会话投影键：本插件「是否已注入」的持久判定。 */
export const PROJECTION_KEY = 'moduleMapContext';
/** 会话投影状态 schema：schemastery 用 z.boolean()（nullable 经 default/required 表达），故 init 用 false 而非 null。 */
const PROJECTION_SCHEMA = z.boolean();

/**
 * 创建注入判定器（会话间互不影响的 WeakSet 跟踪，进程内兜底：每会话只“决定一次”）。
 * @returns {{ isDue(session): boolean, markDecided(session): void }}
 */
export function createInjectionDecider() {
  const decided = new WeakSet();
  return {
    isDue(session) {
      return !decided.has(session);
    },
    markDecided(session) {
      decided.add(session);
    }
  };
}

/**
 * 创建「是否已注入」的会话投影定义（官方解法，对齐 dsh-tmux-context）。
 * 在已提交（持久）事件上折叠：遇到本插件来源的 user/message 即置 true，其余事件原样透传。
 * @returns {{ key, stateVersion, stateSchema, init, apply }} 会话投影注册定义
 */
export function createModuleMapProjection() {
  return {
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: PROJECTION_SCHEMA,
    init: () => false,
    apply: (state, event) => {
      if (event.type !== 'user/message') return state;
      const source = event.data?.source;
      if (source?.kind !== 'plugin' || source?.plugin !== MODULE_MAP_PLUGIN) return state;
      return true;
    }
  };
}

/**
 * 探测本会话是否已注入（读会话投影的持久判定）。
 * @param projections ctx.sessionProjections 注册表（可空）
 * @param session agent.session
 * @returns boolean 已注入为 true；注册表不可用或未注入为 false
 */
export function isModuleMapInjected(projections, session) {
  return projections?.stateOf?.(session, PROJECTION_KEY) === true;
}
