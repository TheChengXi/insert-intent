/**
 * @intent
 * 发现并读取工作区模块地图：定位项目根（marker 向上查找），枚举 .intentflow/_packages 顶层所有
 * *.yml 的内容，供会话首步注入。经 ctx.fs provider 读取，全程不解析 yml。
 *
 * 边界：无 fs provider 返回空数组；项目根定位取不到 marker 时回退到 cwd；_packages 缺失、非目录、
 * 为空或读取失败返回空数组且不抛异常；单文件读取失败仅跳过该文件；仅顶层不递归；返回条目按文件名
 * 排序。fs.resolve/stat 抛错一律视为“该 marker 不存在”，不中断向上查找。
 *
 * 验收条件：
 * - 有 fs provider 且 _packages 含 2 个 yml 时，返回按文件名升序的 2 条 { name, text }
 * - _packages 缺失/为空/读取抛错时返回空数组且不抛异常
 * - 无 fs provider 时返回空数组
 */
import { dirname, join, resolve } from 'node:path';

/** 项目根默认标记：存在该文件即认为此处为项目根。 */
const DEFAULT_MARKERS = ['.git'];

/** 顶层模块地图目录（相对项目根）。 */
const PACKAGES_REL = ['.intentflow', '_packages'];

/**
 * marker 是否存在（经 fs 确认，抛错一律视为不存在）。
 * @param fs  ctx.fs provider
 * @param dir 目录绝对路径
 * @param marker marker 文件名
 * @param signal 可选的 AbortSignal
 * @returns Promise<boolean>
 */
async function markerPresent(fs, dir, marker, signal) {
  try {
    const opts = signal === undefined ? undefined : { signal };
    const target = await fs.resolve(join(dir, marker), opts);
    if (target === undefined) return false;
    const info = await fs.stat(target, signal);
    return info !== undefined;
  } catch {
    return false;
  }
}

/**
 * 向上查找最近的含 marker 的项目根，找不到回退到 cwd。
 * @param fs ctx.fs provider
 * @param cwd 会话工作目录（绝对路径）
 * @param markers marker 文件名列表
 * @param signal 可选的 AbortSignal
 * @returns Promise<string> 项目根绝对路径
 */
export async function findProjectRoot(fs, cwd, markers = DEFAULT_MARKERS, signal) {
  let dir = resolve(cwd);
  for (;;) {
    for (const marker of markers) {
      if (await markerPresent(fs, dir, marker, signal)) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

/**
 * 读取项目根下 .intentflow/_packages 顶层所有 *.yml 的内容。
 * @param ctx cordis 插件上下文（含 .get('fs')）
 * @param session agent.session（读 header.cwd）
 * @param signal 可选的 AbortSignal
 * @returns Promise<Array<{ name: string, text: string }>> 按文件名升序
 */
export async function discoverModuleMap(ctx, session, signal) {
  const fs = ctx.get('fs');
  if (fs === undefined) return [];
  const cwd = (session?.header?.cwd) || process.cwd();
  let projectRoot;
  try {
    projectRoot = await findProjectRoot(fs, cwd, DEFAULT_MARKERS, signal).catch(() => cwd);
  } catch {
    projectRoot = cwd;
  }
  const packagesDir = join(projectRoot, ...PACKAGES_REL);
  let children;
  try {
    const dirTarget = await fs.resolve(packagesDir, signal === undefined ? undefined : { signal });
    children = await fs.listDir(dirTarget, signal);
  } catch {
    return []; // 缺失 / 非目录 / IO 错误 -> 视为不存在
  }
  const files = children
    .filter((child) => child.name.endsWith('.yml') && child.type === 'file')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const out = [];
  for (const child of files) {
    try {
      out.push({ name: child.name, text: await fs.readText(child.target, signal) });
    } catch {
      // 单文件读取失败 -> 跳过该文件，不阻塞其余
    }
  }
  return out;
}