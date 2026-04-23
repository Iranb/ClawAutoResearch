/**
 * 安全的文件系统操作原语。
 *
 * 工作流系统在多个进程/Agent 并发读写状态文件。
 * 没有原子写入和锁，两个 Agent 同时写 manifest 会导致一个覆盖另一个的更新（lost update）。
 *
 * 核心原则：
 * - "文件不存在不是错误"——返回 null 而非抛异常
 * - 关键文件使用原子写入（防止进程崩溃导致半写文件）
 * - 基于 mkdir 的 Advisory Lock（POSIX 原子性，无外部依赖）
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 检查路径是否存在。
 *
 * 使用 fs.access 而非 fs.stat，更轻量且不抛异常。
 * 在热路径中频繁使用（每次检查阶段就绪性都要检查 10+ 个文件）。
 *
 * @param targetPath 目标路径
 * @returns 路径是否存在
 */
export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查目录是否包含条目。
 *
 * 用于验证 sources/ 和 corpus/ 目录是否有内容。
 * 空目录意味着知识图谱构建的前置条件不满足。
 *
 * @param targetPath 目标目录
 * @returns 目录是否非空
 */
export async function isNonEmptyDirectory(targetPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * 安全读取 JSON 文件。
 *
 * 核心原则：文件不存在或格式错误不是错误，返回 null。
 * 状态文件可能在项目初始化时不存在，Agent 首次运行时某些产物还不存在。
 * 返回 null 让调用方可以优雅地处理缺失状态，而不是让整个工作流崩溃。
 *
 * @param targetPath JSON 文件路径（null 时直接返回 null）
 * @returns 解析后的 JSON 对象，或 null
 */
export async function readJsonIfExists<T>(targetPath: string | null): Promise<T | null> {
  if (!targetPath) {
    return null;
  }
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * 安全读取文本文件。
 *
 * 与 readJsonIfExists 同理——文件不存在返回 null。
 * 用于读取 Markdown 文件、日志、配置文本等。
 *
 * @param targetPath 文本文件路径（null 时直接返回 null）
 * @returns 文件内容，或 null
 */
export async function readTextIfExists(targetPath: string | null): Promise<string | null> {
  if (!targetPath) {
    return null;
  }
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 写入 JSON 文件。
 *
 * 自动创建父目录（recursive: true，避免 TOCTOU 竞争条件），
 * 使用 2 空格缩进和尾换行（方便 git diff 和人工审查）。
 *
 * 用于普通状态文件。关键状态文件（如 manifest）应使用 writeJsonAtomicEnsured。
 *
 * @param targetPath 目标路径
 * @param value 要序列化的 JSON 值
 */
export async function writeJsonEnsured(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * 写入文本文件。
 *
 * 自动创建父目录。用于写入 Markdown 报告、日志等。
 *
 * @param targetPath 目标路径
 * @param value 要写入的文本
 */
export async function writeTextEnsured(targetPath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AdvisoryLockMetadata = {
  version: 1;
  pid: number;
  ppid: number;
  hostname: string;
  acquiredAt: string;
};

const ADVISORY_LOCK_METADATA_FILE = "owner.json";

function advisoryLockMetadataPath(lockPath: string): string {
  return path.join(lockPath, ADVISORY_LOCK_METADATA_FILE);
}

async function writeAdvisoryLockMetadata(lockPath: string): Promise<void> {
  const metadata: AdvisoryLockMetadata = {
    version: 1,
    pid: process.pid,
    ppid: process.ppid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
  };
  await fs.writeFile(
    advisoryLockMetadataPath(lockPath),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
}

async function readAdvisoryLockMetadata(
  lockPath: string
): Promise<AdvisoryLockMetadata | null> {
  try {
    const raw = await fs.readFile(advisoryLockMetadataPath(lockPath), "utf8");
    const parsed = JSON.parse(raw) as Partial<AdvisoryLockMetadata>;
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.pid === "number" &&
      Number.isFinite(parsed.pid) &&
      typeof parsed.ppid === "number" &&
      Number.isFinite(parsed.ppid) &&
      typeof parsed.hostname === "string" &&
      parsed.hostname.trim() &&
      typeof parsed.acquiredAt === "string" &&
      parsed.acquiredAt.trim()
    ) {
      return {
        version: 1,
        pid: Math.floor(parsed.pid),
        ppid: Math.floor(parsed.ppid),
        hostname: parsed.hostname.trim(),
        acquiredAt: parsed.acquiredAt.trim(),
      };
    }
  } catch {}
  return null;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : null;
    return code === "EPERM";
  }
}

async function maybeRecoverStaleAdvisoryLock(params: {
  lockPath: string;
  staleMs: number | null;
}): Promise<boolean> {
  const staleMs = params.staleMs;
  const metadata = await readAdvisoryLockMetadata(params.lockPath);
  if (metadata && metadata.hostname === os.hostname() && !isPidAlive(metadata.pid)) {
    await fs.rm(params.lockPath, { recursive: true, force: true });
    return true;
  }
  if (staleMs == null || staleMs <= 0) {
    return false;
  }
  if (metadata && metadata.hostname === os.hostname() && isPidAlive(metadata.pid)) {
    return false;
  }
  let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    stat = await fs.stat(params.lockPath);
  } catch {
    return false;
  }
  const metadataAgeMs = metadata ? Date.parse(metadata.acquiredAt) : NaN;
  const ageMs = Number.isFinite(metadataAgeMs)
    ? Date.now() - metadataAgeMs
    : Date.now() - stat.mtimeMs;
  if (ageMs < staleMs) {
    return false;
  }
  await fs.rm(params.lockPath, { recursive: true, force: true });
  return true;
}

/**
 * 原子写入 JSON 文件。
 *
 * 防止进程崩溃导致半写文件。如果进程在写入中间崩溃，
 * 文件会被截断（只写了一半的 JSON），下次读取时 JSON.parse 会失败。
 *
 * 通过两步操作解决：
 * 1. 写入临时文件（写坏了只影响临时文件）
 * 2. fs.rename() 是原子操作——要么完成要么不完成
 *
 * 用于 manifest 等关键状态文件。
 *
 * @param targetPath 目标路径
 * @param value 要序列化的 JSON 值
 */
export async function writeJsonAtomicEnsured(
  targetPath: string,
  value: unknown
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, targetPath);
}

/**
 * 基于目录的 Advisory Lock（建议锁）。
 *
 * 为什么用 mkdir 而不是文件锁？因为 mkdir 在 POSIX 系统上是原子的——
 * 两个进程同时 mkdir 同一个目录，只有一个会成功（返回 EEXIST）。
 * 这比基于文件的锁更简单、不需要外部依赖。
 *
 * 为什么不使用 flock？因为 flock 在某些文件系统（如 NFS）上不可靠。
 *
 * 注意：这是进程间锁，不是分布式锁。假设所有进程在同一台机器上。
 *
 * @param params.lockPath 锁目录路径
 * @param params.task 要执行的任务函数
 * @param params.timeoutMs 超时时间（默认 5000ms）
 * @param params.retryMs 重试间隔（默认 50ms）
 * @returns 任务的返回值
 * @throws 超时后抛出异常
 */
export async function withAdvisoryLock<T>(params: {
  lockPath: string;
  task: () => Promise<T>;
  timeoutMs?: number;
  retryMs?: number;
  staleMs?: number | null;
}): Promise<T> {
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(50, Math.floor(params.timeoutMs))
      : 5_000;
  const retryMs =
    typeof params.retryMs === "number" && Number.isFinite(params.retryMs)
      ? Math.max(10, Math.floor(params.retryMs))
      : 50;
  const staleMs =
    typeof params.staleMs === "number" && Number.isFinite(params.staleMs)
      ? Math.max(0, Math.floor(params.staleMs))
      : null;
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(params.lockPath), { recursive: true });

  while (true) {
    try {
      await fs.mkdir(params.lockPath, { recursive: false });
      await writeAdvisoryLockMetadata(params.lockPath).catch(() => null);
      break;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : null;
      if (code !== "EEXIST") {
        throw error;
      }
      const recovered = await maybeRecoverStaleAdvisoryLock({
        lockPath: params.lockPath,
        staleMs,
      }).catch(() => false);
      if (recovered) {
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for advisory lock: ${params.lockPath}`);
      }
      await sleep(retryMs);
    }
  }

  try {
    return await params.task();
  } finally {
    await fs.rm(params.lockPath, { recursive: true, force: true });
  }
}
