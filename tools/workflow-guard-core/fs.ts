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
