/**
 * 路径解析工具。
 *
 * 状态文件中存储的路径可能是：
 * - 相对路径（相对于项目根目录）
 * - 绝对路径
 * - 带 ~ 的 home 路径
 *
 * 这些函数统一处理各种路径格式，确保后续文件操作不会因为路径格式问题而失败。
 */
import os from "node:os";
import * as path from "node:path";
/**
 * 展开 home 目录路径。
 *
 * 将 `~` 和 `~/...` 展开为实际的 home 目录路径。
 * 配置文件可能使用 `~` 作为 home 目录的简写。
 *
 * @param value 路径字符串
 * @returns 展开后的路径
 */
export function expandHome(value) {
    if (value === "~") {
        return os.homedir();
    }
    if (value.startsWith("~/")) {
        return path.join(os.homedir(), value.slice(2));
    }
    return value;
}
/**
 * 将相对路径解析为项目根目录下的绝对路径。
 *
 * 状态文件中存储的路径大多是相对路径（如 `researcher/idea-catalyst/DECOMPOSITION_PACKET.json`）。
 * 这个函数将其与项目根目录拼接，得到可直接使用的绝对路径。
 *
 * @param projectRoot 项目根目录
 * @param artifactPath 制品相对路径
 * @returns 解析后的绝对路径，或 null（路径为空时）
 */
export function resolveProjectArtifactPath(projectRoot, artifactPath) {
    if (!artifactPath) {
        return null;
    }
    if (path.isAbsolute(artifactPath)) {
        return path.normalize(artifactPath);
    }
    if (!projectRoot) {
        return artifactPath;
    }
    return path.normalize(path.join(projectRoot, artifactPath));
}
/**
 * 解析 Track 相关的制品路径。
 *
 * 与 resolveProjectArtifactPath 类似，但专门用于 Track 级别的制品。
 *
 * @param projectRoot 项目根目录
 * @param artifactPath 制品相对路径
 * @returns 解析后的绝对路径，或 null
 */
export function resolveTrackArtifactPath(projectRoot, artifactPath) {
    if (!artifactPath) {
        return null;
    }
    return (resolveProjectArtifactPath(projectRoot, artifactPath) ??
        path.join(projectRoot, artifactPath));
}
