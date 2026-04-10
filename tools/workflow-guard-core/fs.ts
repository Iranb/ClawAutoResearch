import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function isNonEmptyDirectory(targetPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

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

export async function writeJsonEnsured(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeTextEnsured(targetPath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function writeJsonAtomicEnsured(
  targetPath: string,
  value: unknown
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, targetPath);
}

export async function withAdvisoryLock<T>(params: {
  lockPath: string;
  task: () => Promise<T>;
  timeoutMs?: number;
  retryMs?: number;
}): Promise<T> {
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(50, Math.floor(params.timeoutMs))
      : 5_000;
  const retryMs =
    typeof params.retryMs === "number" && Number.isFinite(params.retryMs)
      ? Math.max(10, Math.floor(params.retryMs))
      : 50;
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(params.lockPath), { recursive: true });

  while (true) {
    try {
      await fs.mkdir(params.lockPath, { recursive: false });
      break;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : null;
      if (code !== "EEXIST") {
        throw error;
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
