import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ImageGenerationParams,
  ImageGenerationProvider,
  ImageGenerationReceipt,
} from "./types";

const OPENAI_IMAGE_GENERATION_ENDPOINT =
  "https://api.openai.com/v1/images/generations";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeModel(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized || "gpt-image-2";
}

function buildReceipt(params: {
  status: ImageGenerationReceipt["status"];
  model: string | null;
  promptPath: string | null;
  outputPath: string | null;
  figureId: string | null;
  error?: string | null;
}): ImageGenerationReceipt {
  return {
    schema_version: 1,
    provider: "openai",
    model: params.model,
    status: params.status,
    prompt_path: params.promptPath,
    output_path: params.outputPath,
    figure_id: params.figureId,
    generated_at: nowIso(),
    error: params.error ?? null,
  };
}

export function createOpenAiGptImageProvider(options?: {
  apiKey?: string | null;
  defaultModel?: string | null;
  endpoint?: string | null;
  fetchImpl?: typeof fetch | null;
}): ImageGenerationProvider {
  const defaultModel = normalizeModel(options?.defaultModel);
  const endpoint = options?.endpoint ?? OPENAI_IMAGE_GENERATION_ENDPOINT;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  return {
    name: "openai",
    defaultModel,
    async isConfigured() {
      return Boolean(String(options?.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim());
    },
    async generate(params: ImageGenerationParams) {
      const model = normalizeModel(params.model ?? defaultModel);
      const apiKey = String(options?.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
      const relativeOutputPath = params.outputPath;
      if (!apiKey) {
        return buildReceipt({
          status: "skipped_missing_key",
          model,
          promptPath: params.promptPath ?? null,
          outputPath: relativeOutputPath,
          figureId: params.figureId ?? null,
        });
      }
      if (!fetchImpl) {
        return buildReceipt({
          status: "failed",
          model,
          promptPath: params.promptPath ?? null,
          outputPath: relativeOutputPath,
          figureId: params.figureId ?? null,
          error: "No fetch implementation is available in this runtime.",
        });
      }
      try {
        const body: Record<string, unknown> = {
          model,
          prompt: params.prompt,
        };
        if (params.size) {
          body.size = params.size;
        }
        if (params.quality) {
          body.quality = params.quality;
        }
        if (params.outputFormat) {
          body.output_format = params.outputFormat;
        }
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          return buildReceipt({
            status: "failed",
            model,
            promptPath: params.promptPath ?? null,
            outputPath: relativeOutputPath,
            figureId: params.figureId ?? null,
            error: `OpenAI image generation failed with HTTP ${response.status}: ${errorText.slice(0, 500)}`,
          });
        }
        const payload = (await response.json()) as {
          data?: Array<{ b64_json?: string | null }>;
        };
        const imageBase64 = payload.data?.[0]?.b64_json;
        if (!imageBase64) {
          return buildReceipt({
            status: "failed",
            model,
            promptPath: params.promptPath ?? null,
            outputPath: relativeOutputPath,
            figureId: params.figureId ?? null,
            error: "OpenAI image generation response did not include data[0].b64_json.",
          });
        }
        await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
        await fs.writeFile(params.outputPath, Buffer.from(imageBase64, "base64"));
        return buildReceipt({
          status: "generated",
          model,
          promptPath: params.promptPath ?? null,
          outputPath: relativeOutputPath,
          figureId: params.figureId ?? null,
        });
      } catch (error) {
        return buildReceipt({
          status: "failed",
          model,
          promptPath: params.promptPath ?? null,
          outputPath: relativeOutputPath,
          figureId: params.figureId ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
