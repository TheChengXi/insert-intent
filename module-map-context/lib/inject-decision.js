/**
 * @intent
 * 注入时机判定：每个会话只在全局开头「决定一次」。第一次进入时 isDue 返回 true，调用方随即
 * markDecided 置为已决定；之后无论后续步骤、新 turn、压缩/恢复，还是中途才出现的 yml，都一律
 * 不再触发。语义等同 AGENTS.md：全局开头注入过就注入；当时没有 yml 就永久跳过，不补注。
 *
 * 边界：isDue 只对「尚未决定」的会话返回 true，与 step 无关；markDecided 在首次判定时即调用
 * （与是否真的注入到内容无关，so 中途出现的文件不会被补注）；WeakSet 按会话隔离。
 *
 * 验收条件：
 * - 未决定的会话 -> isDue === true
 * - markDecided 后同一会话再查 -> false
 * - 另一会话 -> true（会话间隔离）
 */
/**
 * 创建注入判定器（会话间互不影响的 WeakSet 跟踪，每个会话只“决定一次”）。
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