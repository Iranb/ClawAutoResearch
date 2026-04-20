/**
 * 安全类型转换原语。
 *
 * 整个系统处理来自 JSON 文件（manifest 和各类状态文件）的 `unknown` 输入，
 * 这个模块提供统一的类型转换函数，确保全代码库的行为一致、可测试、可审计。
 *
 * 设计原则：
 * - 每个函数都返回 `null` 而非抛出异常（文件缺失/格式错误/旧版 schema 不是错误）
 * - 严格类型检查（`typeof === "boolean"` 不做 truthy 转换）
 * - `pick*` 函数支持多键名兼容（camelCase / snake_case 共存）
 */
import type { GraphPresenceStatus } from "../graph-presence";
import type { UnknownRecord } from "./types";

/**
 * 将任意值标准化为阶段名称。
 *
 * 阶段名称可能来自多种来源——Discord 命令参数（可能有空格）、
 * JSON 配置文件（可能用 camelCase）、代码常量（可能用 snake_case）。
 * 统一为 `snake_case` 确保后续 switch / 对象查找 / 字符串比较不会失败。
 *
 * 例如: "Graph Build" → "graph_build"
 * @returns 标准化后的 snake_case 阶段名，或 null（非字符串/为空时）
 */
export function normalizeStage(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/**
 * 标准化知识图谱存在状态。
 *
 * 知识图谱存在性是关键的门禁条件——如果图谱不存在，
 * 后续所有需要图谱的操作都会失败。将允许的枚举值硬编码在此，
 * 确保任何模块对同一状态的判断一致。
 *
 * 只允许 4 个值: ready / missing_papers / missing_corpus / missing_sources
 * @returns 标准化的图谱存在状态，或 null
 */
export function normalizeGraphPresenceStatus(
  value: unknown
): GraphPresenceStatus | null {
  const normalized = normalizeStage(value);
  if (
    normalized === "ready" ||
    normalized === "missing_papers" ||
    normalized === "missing_corpus" ||
    normalized === "missing_sources"
  ) {
    return normalized;
  }
  return null;
}

/**
 * 安全提取字符串。
 *
 * 仅当值是 `string` 且 trim() 后非空时返回，否则 null。
 * 处理 JSON 中可能出现的 ""、"   "、null、undefined、数字等情况。
 *
 * @returns 非空字符串，或 null
 */
export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 安全提取对象。
 *
 * 排除 null、undefined、数组和非对象类型。
 * 注意 `Array.isArray` 检查是必须的，因为 `typeof [] === "object"`。
 *
 * @returns 对象，或 null
 */
export function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

/**
 * 字符串数组去重 + trim + 去除空字符串。
 *
 * 状态文件中同一个列表可能被多个 Agent 追加导致重复。
 * 使用 Set 保证 O(n) 复杂度。
 *
 * @returns 去重后的字符串数组
 */
export function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

/**
 * 将任意值转为字符串数组。
 *
 * 非字符串元素变为空字符串并被过滤掉。
 * JSON 数组可能包含非字符串元素（数字、null、嵌套对象），
 * 此函数安全地将它们全部过滤。
 *
 * @returns 纯字符串数组
 */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean)
  );
}

/**
 * 按优先级从对象的多个键中取第一个有效字符串。
 *
 * 状态文件的 schema 在不同版本中可能变化（camelCase ↔ snake_case），
 * 或者同一个值可能以不同的名字存储。此函数一次性兼容所有变体。
 *
 * 例如: pickString(obj, ["path", "filePath", "file_path"])
 *
 * @param source 源对象
 * @param keys 候选键名列表，按优先级排列
 * @returns 第一个有效字符串，或 null
 */
export function pickString(
  source: UnknownRecord,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

/**
 * 按优先级从对象的多个键中取第一个有效数字。
 *
 * 使用 isFinite 检查排除 NaN 和 Infinity（这两个值在 JSON 序列化时会变成 null）。
 * 不检查会导致 NaN 传播到后续计算中（NaN + 1 = NaN），难以追踪。
 *
 * @param source 源对象
 * @param keys 候选键名列表，按优先级排列
 * @returns 第一个有效数字，或 null
 */
export function pickNumber(
  source: UnknownRecord,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/**
 * 按优先级从对象的多个键中取第一个有效布尔值。
 *
 * 故意不做 truthy/falsy 转换——因为 JSON 中 0 和 1 是合法数字，
 * "true" 是合法字符串。如果把 0 转为 false、"true" 转为 true，
 * 当某个字段恰好存储数字 0 时就会被误读为布尔值。
 *
 * @param source 源对象
 * @param keys 候选键名列表，按优先级排列
 * @returns 第一个有效布尔值，或 null
 */
export function pickBoolean(
  source: UnknownRecord,
  keys: string[]
): boolean | null {
  for (const key of keys) {
    if (typeof source[key] === "boolean") {
      return source[key] as boolean;
    }
  }
  return null;
}
