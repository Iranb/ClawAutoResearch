import * as path from "node:path";
import type { ImageGenerationReceipt } from "./image-providers/types";
import { writeJsonEnsured } from "../workflow-guard-core/fs";

export const DEFAULT_IMAGE_GENERATION_RECEIPTS_PATH =
  "academic_writer/IMAGE_GENERATION_RECEIPTS.json";

export async function writeImageGenerationReceipts(params: {
  projectRoot: string;
  relativePath?: string | null;
  receipts: ImageGenerationReceipt[];
}): Promise<string> {
  const relativePath =
    params.relativePath ?? DEFAULT_IMAGE_GENERATION_RECEIPTS_PATH;
  const resolvedPath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(params.projectRoot, relativePath);
  await writeJsonEnsured(resolvedPath, {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    receipts: params.receipts,
  });
  return path.relative(params.projectRoot, resolvedPath);
}
