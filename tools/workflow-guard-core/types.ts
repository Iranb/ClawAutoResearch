/**
 * 全局基础类型别名。
 *
 * 所有外部输入（JSON 文件、manifest、API 响应）在 TypeScript 中都是 `unknown`。
 * 在解析之前，它们是 `Record<string, unknown>`；解析之后，它们是强类型接口（`*Like`）。
 * `UnknownRecord` 是这个转换的唯一入口，避免了全代码库到处用 `any`。
 */
export type UnknownRecord = Record<string, unknown>;
