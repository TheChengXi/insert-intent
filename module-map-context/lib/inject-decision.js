/**
 * @intent
 * 注入时机判定：只在“新会话”的首个步骤（step === 1）且该会话尚未注入过时触发一次性注入；
 * 会话内后续步骤、压缩/恢复后均不再重复（用户明确只首步一次）。
 *
 * 边界：step !== 1 或会话已注入过则 isDue 返回 false；用 WeakSet 按会话跟踪已注入；只有真正注入
 * 成功后才 markInjected（重负拒绝首步时保留那唯一一次机会，不误标）。
 *
 * 验收条件：
 * - 首步且未注入 -> isDue === true
 * - markInjected 后同一会话再查 -> false
 * - 另一会话首步 -> true（会话间隔离）
 */
/**
 * 创建注入判定器（会话间互不影响的 WeakSet 跟踪）。
 * @returns {{ isDue(session, step): boolean, markInjected(session): void }}
 */
export function createInjectionDecider() {
  const injected = new WeakSet();
  return {
    isDue(session, step) {
      if (step !== 1) return false;
      return !injected.has(session);
    },
    markInjected(session) {
      injected.add(session);
    }
  };
}
