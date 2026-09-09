/**
 * @intent
 * 渲染注入文本：把 discovery 返回的各模块 yml 条目按传入顺序逐字拼接成最终注入的模块地图。
 * 不解析、不校验 yml、不加引导头——内容与源文件逐字一致。
 *
 * 边界：空输入返回空字符串且不抛异常；单文件返回其原文（含缩进与注释）；多文件按条目顺序以换行
 * 分隔拼接；顺序稳定性由调用方传入的已排序条目保证。
 *
 * 验收条件：
 * - 传入 1 条时返回该文件原文，逐字一致
 * - 传入 N 条时按条目顺序 join('\n')，顺序与输入完全一致
 * - 传入空数组返回 ''，不抛异常
 */
/**
 * 拼接模块地图注入文本。
 * @param entries Array<{ name: string, text: string }> 已按文件名排序的条目
 * @returns string 注入文本
 */
export function renderModuleMap(entries) {
  if (entries.length === 0) return '';
  return entries.map((entry) => entry.text).join('\n');
}
