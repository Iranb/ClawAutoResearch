import * as path from "node:path";
import {
  asRecord,
  pickBoolean,
  pickString,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { createOpenAiGptImageProvider } from "./image-providers/openai-gpt-image";
import type { ImageGenerationReceipt } from "./image-providers/types";
import { writeImageGenerationReceipts } from "./image-generation-receipts";

export const DEFAULT_FIGURE_PROMPT_CONTRACT_PATH =
  "academic_writer/FIGURE_PROMPT_CONTRACT.json";
export const DEFAULT_FIGURE_REGISTRY_PATH = "academic_writer/FIGURE_REGISTRY.json";
export const DEFAULT_FIGURE_ANCHOR_PLAN_PATH =
  "academic_writer/FIGURE_ANCHOR_PLAN.md";

type FigurePromptMode = "prompt_only" | "openai_gpt_image";

type FigurePlanInput = {
  figure_id?: unknown;
  figureId?: unknown;
  kind?: unknown;
  title?: unknown;
  purpose?: unknown;
  label?: unknown;
  caption?: unknown;
  target_path?: unknown;
  targetPath?: unknown;
  requires_real_data?: unknown;
  requiresRealData?: unknown;
};

type FigurePromptEntry = {
  figure_id: string;
  kind: string;
  title: string;
  purpose: string;
  label: string;
  target_path: string;
  generated_path: string | null;
  prompt_path: string | null;
  placeholder_tex_path: string;
  caption: string;
  generation_status:
    | "prompt_ready"
    | "placeholder"
    | "generated"
    | "skipped_missing_key"
    | "blocked_needs_real_data"
    | "failed";
  requires_real_data: boolean;
  source_artifacts: string[];
};

export type FigurePromptContractResult = {
  contractPath: string;
  registryPath: string;
  receiptsPath: string | null;
  mode: FigurePromptMode;
  generatedFiles: string[];
  figures: FigurePromptEntry[];
  receipts: ImageGenerationReceipt[];
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function slugify(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function normalizeMode(value: unknown): FigurePromptMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "openai_gpt_image" || normalized === "openai"
    ? "openai_gpt_image"
    : "prompt_only";
}

function inferRequiresRealData(kind: string, explicit: boolean | null): boolean {
  if (explicit != null) {
    return explicit;
  }
  return /(^|[_\-\s])(result|metric|curve|roc|pr|map|loss|ablation|dataset|evidence|failure|qualitative|benchmark|table|chart|heatmap|scatter)([_\-\s]|$)/i.test(kind);
}

function latexEscape(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

function buildPrompt(params: {
  title: string;
  kind: string;
  purpose: string;
  caption: string;
  topic: string | null;
}): string {
  return [
    `Create a publication-ready academic ${params.kind} figure for a research paper.`,
    `Paper topic: ${params.topic ?? "the current research project"}.`,
    `Figure title: ${params.title}.`,
    `Purpose: ${params.purpose}.`,
    `Caption target: ${params.caption}.`,
    "Use a clean vector-style composition, restrained colors, high contrast, clear grouping, and no decorative clutter.",
    "Use generic labels only when needed; avoid tiny unreadable text, fake citations, fake numbers, fake plots, fake benchmarks, author names, venue logos, watermarks, or UI chrome.",
    "The image must communicate the concept visually without inventing empirical results.",
    "PaperNexus metadata-only papers can inform taxonomy or placeholder labels only; source-backed graph/import evidence is required for claims, comparisons, or result visuals.",
  ].join(" ");
}

function buildPromptMarkdown(params: {
  figure: FigurePromptEntry;
  prompt: string | null;
}): string {
  if (!params.prompt) {
    return "";
  }
  return [
    `# Figure Prompt: ${params.figure.figure_id}`,
    "",
    "Use this prompt in an external image generation tool or the optional OpenAI GPT Image provider.",
    "",
    "## Prompt",
    "",
    params.prompt,
    "",
    "## Caption",
    "",
    params.figure.caption,
    "",
    "## Guardrails",
    "",
    "- Do not invent empirical curves, metrics, citations, datasets, or paper screenshots.",
    "- Real result/data figures must be generated from project data instead of this prompt-only route.",
    "- PaperNexus metadataGraph or metadata-only candidates can guide taxonomy/coverage placeholders only; source-backed graph/import artifacts are required for claim-bearing or comparison figures.",
    "",
  ].join("\n");
}

function buildPlaceholderTex(figure: FigurePromptEntry): string {
  const body = figure.requires_real_data
    ? "Real data figure required. Generate this from project artifacts before submission."
    : `Prompt-ready placeholder. See ${figure.prompt_path ?? "prompt file"}.`;
  return [
    "\\begin{figure}[t]",
    "\\centering",
    "\\fbox{%",
    "\\begin{minipage}[c][0.28\\textheight][c]{0.92\\linewidth}",
    "\\centering",
    `\\textbf{${latexEscape(figure.title)}}\\\\[0.75em]`,
    latexEscape(body),
    "\\end{minipage}%",
    "}",
    `\\caption{${latexEscape(figure.caption)}}`,
    `\\label{${latexEscape(figure.label)}}`,
    "\\end{figure}",
    "",
  ].join("\n");
}

function parseAnchorPlanFigures(anchorText: string | null): FigurePlanInput[] {
  if (!anchorText) {
    return [];
  }
  const figures: FigurePlanInput[] = [];
  const lines = anchorText.split(/\r?\n/).map((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^[-*]\s*Figure\s+(\d+)\s*:\s*(.+)$/i);
    if (!match) {
      continue;
    }
    const figureId = `fig${match[1]}_${slugify(match[2], "anchor")}`;
    const purpose =
      lines
        .slice(index + 1, index + 5)
        .find((entry) => /^[-*]\s*Purpose\s*:/i.test(entry))
        ?.replace(/^[-*]\s*Purpose\s*:\s*/i, "") ??
      "Make the paper contribution structure visible before prose expands.";
    figures.push({
      figure_id: figureId,
      kind: /pipeline|framework|architecture|method/i.test(match[2])
        ? "architecture"
        : "concept",
      title: match[2],
      purpose,
    });
  }
  return figures.slice(0, 6);
}

function normalizeFigureInput(params: {
  input: FigurePlanInput;
  index: number;
  topic: string | null;
}): FigurePromptEntry {
  const input = params.input;
  const title =
    pickString(input as Record<string, unknown>, ["title"]) ??
    pickString(input as Record<string, unknown>, ["purpose"]) ??
    `Figure ${params.index + 1}`;
  const figureId =
    pickString(input as Record<string, unknown>, ["figure_id", "figureId"]) ??
    `fig${params.index + 1}_${slugify(title, "figure")}`;
  const kind =
    pickString(input as Record<string, unknown>, ["kind"]) ?? "concept";
  const requiresRealData = inferRequiresRealData(
    kind,
    pickBoolean(input as Record<string, unknown>, [
      "requires_real_data",
      "requiresRealData",
    ])
  );
  const label =
    pickString(input as Record<string, unknown>, ["label"]) ??
    `fig:${figureId.replace(/^fig\d+_?/, "").replace(/_/g, "-")}`;
  const caption =
    pickString(input as Record<string, unknown>, ["caption"]) ??
    `${title}: a placeholder caption to be refined against the final manuscript evidence.`;
  const targetPath =
    pickString(input as Record<string, unknown>, ["target_path", "targetPath"]) ??
    `academic_writer/paper/figures/${figureId}.pdf`;
  const promptPath = requiresRealData
    ? null
    : `academic_writer/paper/figures/prompts/${figureId}.prompt.md`;
  const placeholderTexPath =
    `academic_writer/paper/figures/placeholders/${figureId}_placeholder.tex`;
  return {
    figure_id: figureId,
    kind,
    title,
    purpose:
      pickString(input as Record<string, unknown>, ["purpose"]) ??
      `Explain ${title} for ${params.topic ?? "the paper"}.`,
    label,
    target_path: targetPath,
    generated_path: null,
    prompt_path: promptPath,
    placeholder_tex_path: placeholderTexPath,
    caption,
    generation_status: requiresRealData
      ? "blocked_needs_real_data"
      : "prompt_ready",
    requires_real_data: requiresRealData,
    source_artifacts: uniqueStrings([
      "PROJECT_MANIFEST.json",
      DEFAULT_FIGURE_ANCHOR_PLAN_PATH,
      "researcher/SOTA_MATRIX.md",
      "researcher/GAP_SYNTHESIS.md",
      "researcher/COVERAGE_SUMMARY.md",
      "researcher/papernexus/PAPERNEXUS_EVIDENCE_PACKET.md",
    ]),
  };
}

function collectConfiguredFigures(params: {
  materialization: Record<string, unknown>;
  anchorText: string | null;
  topic: string | null;
}): FigurePromptEntry[] {
  const rawFigures = Array.isArray(params.materialization.figures)
    ? (params.materialization.figures as FigurePlanInput[])
    : parseAnchorPlanFigures(params.anchorText);
  const fallback =
    rawFigures.length > 0
      ? rawFigures
      : [
          {
            figure_id: "fig1_teaser",
            kind: "teaser",
            title: "Conceptual teaser",
            purpose:
              "Summarize the problem, gap, proposed idea, and evidence boundary in one compact visual.",
          },
          {
            figure_id: "fig2_framework",
            kind: "architecture",
            title: "Method framework",
            purpose:
              "Show the major modules and information flow without claiming empirical results.",
          },
        ];
  return fallback.map((input, index) =>
    normalizeFigureInput({ input, index, topic: params.topic })
  );
}

async function writePromptAndPlaceholderFiles(params: {
  projectRoot: string;
  figures: FigurePromptEntry[];
  topic: string | null;
  generatedFiles: string[];
}): Promise<Map<string, string>> {
  const prompts = new Map<string, string>();
  for (const figure of params.figures) {
    const prompt = figure.requires_real_data
      ? null
      : buildPrompt({
          title: figure.title,
          kind: figure.kind,
          purpose: figure.purpose,
          caption: figure.caption,
          topic: params.topic,
        });
    if (prompt && figure.prompt_path) {
      const promptPath = resolveProjectArtifactPath(params.projectRoot, figure.prompt_path);
      if (!promptPath) {
        throw new Error(`Unable to resolve prompt path for ${figure.figure_id}.`);
      }
      await writeTextEnsured(
        promptPath,
        buildPromptMarkdown({ figure, prompt })
      );
      params.generatedFiles.push(figure.prompt_path);
      prompts.set(figure.figure_id, prompt);
    }
    const placeholderPath = resolveProjectArtifactPath(
      params.projectRoot,
      figure.placeholder_tex_path
    );
    if (!placeholderPath) {
      throw new Error(`Unable to resolve placeholder path for ${figure.figure_id}.`);
    }
    await writeTextEnsured(placeholderPath, buildPlaceholderTex(figure));
    params.generatedFiles.push(figure.placeholder_tex_path);
  }
  return prompts;
}

async function maybeGenerateImages(params: {
  projectRoot: string;
  mode: FigurePromptMode;
  provider: string | null;
  model: string | null;
  size: string | null;
  quality: string | null;
  outputFormat: string | null;
  figures: FigurePromptEntry[];
  prompts: Map<string, string>;
  generatedFiles: string[];
}): Promise<ImageGenerationReceipt[]> {
  if (params.mode !== "openai_gpt_image" || params.provider !== "openai") {
    return params.figures
      .filter((figure) => !figure.requires_real_data)
      .map((figure) => ({
        schema_version: 1,
        provider: params.provider ?? "prompt_only",
        model: params.model,
        status: "skipped_prompt_only",
        prompt_path: figure.prompt_path,
        output_path: null,
        figure_id: figure.figure_id,
        generated_at: new Date().toISOString(),
        error: null,
      }));
  }
  const provider = createOpenAiGptImageProvider({
    defaultModel: params.model,
  });
  const receipts: ImageGenerationReceipt[] = [];
  for (const figure of params.figures) {
    if (figure.requires_real_data) {
      receipts.push({
        schema_version: 1,
        provider: "openai",
        model: params.model ?? provider.defaultModel,
        status: "skipped_real_data_required",
        prompt_path: figure.prompt_path,
        output_path: null,
        figure_id: figure.figure_id,
        generated_at: new Date().toISOString(),
        error: null,
      });
      continue;
    }
    const prompt = params.prompts.get(figure.figure_id);
    if (!prompt) {
      continue;
    }
    const outputRelativePath =
      `academic_writer/paper/figures/generated/${figure.figure_id}.png`;
    const outputPath = resolveProjectArtifactPath(params.projectRoot, outputRelativePath);
    if (!outputPath) {
      throw new Error(`Unable to resolve output image path for ${figure.figure_id}.`);
    }
    const receipt = await provider.generate({
      prompt,
      outputPath,
      promptPath: figure.prompt_path,
      figureId: figure.figure_id,
      model: params.model,
      size: params.size,
      quality: params.quality,
      outputFormat: params.outputFormat,
    });
    const normalizedReceipt = {
      ...receipt,
      output_path: receipt.output_path ? outputRelativePath : null,
    };
    if (normalizedReceipt.status === "generated") {
      figure.generated_path = outputRelativePath;
      figure.generation_status = "generated";
      params.generatedFiles.push(outputRelativePath);
    } else if (normalizedReceipt.status === "skipped_missing_key") {
      figure.generation_status = "skipped_missing_key";
    } else if (normalizedReceipt.status === "failed") {
      figure.generation_status = "failed";
    }
    receipts.push(normalizedReceipt);
  }
  return receipts;
}

async function updateFigureRegistry(params: {
  projectRoot: string;
  figures: FigurePromptEntry[];
  generatedFiles: string[];
}): Promise<string> {
  const registryPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_FIGURE_REGISTRY_PATH
  );
  if (!registryPath) {
    throw new Error("Unable to resolve FIGURE_REGISTRY.json path.");
  }
  const current =
    (await readJsonIfExists<Record<string, unknown>>(registryPath)) ?? {};
  const existingEntries = Array.isArray(current.entries)
    ? (current.entries as Record<string, unknown>[])
    : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of existingEntries) {
    const key =
      pickString(entry, ["figure_id", "figureId", "id", "label"]) ??
      `existing-${byId.size + 1}`;
    byId.set(key, entry);
  }
  for (const figure of params.figures) {
    const key = figure.label;
    byId.set(key, {
      ...(byId.get(key) ?? {}),
      id: figure.label,
      figure_id: figure.figure_id,
      kind: "figure",
      role: figure.kind,
      label: figure.label,
      caption: figure.caption,
      path: figure.generated_path ?? figure.target_path,
      prompt_path: figure.prompt_path,
      placeholder_tex_path: figure.placeholder_tex_path,
      status: figure.generation_status,
      requires_real_data: figure.requires_real_data,
      provenanceStatus: figure.requires_real_data ? "blocked" : "placeholder",
      sourceArtifacts: figure.source_artifacts,
    });
  }
  await writeJsonEnsured(registryPath, {
    ...current,
    schemaVersion: current.schemaVersion ?? 1,
    schema_version: current.schema_version ?? 1,
    generatedAt: new Date().toISOString(),
    generated_at: new Date().toISOString(),
    entries: [...byId.values()],
    figure_prompt_contract_path: DEFAULT_FIGURE_PROMPT_CONTRACT_PATH,
    unresolvedPlaceholderCount: params.figures.filter(
      (figure) => figure.generation_status !== "generated"
    ).length,
  });
  params.generatedFiles.push(DEFAULT_FIGURE_REGISTRY_PATH);
  return DEFAULT_FIGURE_REGISTRY_PATH;
}

export async function materializeFigurePromptContract(params: {
  projectRoot: string;
  figurePromptContractMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<FigurePromptContractResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const materialization = params.figurePromptContractMaterialization ?? {};
  const paperDesignIntake = asRecord(manifest.paper_design_intake) ?? {};
  const figurePolicy = asRecord(paperDesignIntake.figure_policy) ?? {};
  const mode = normalizeMode(
    materialization.mode ?? figurePolicy.mode ?? manifest.figure_policy
  );
  const provider =
    pickString(materialization, ["provider"]) ??
    pickString(figurePolicy, ["provider"]) ??
    (mode === "openai_gpt_image" ? "openai" : null);
  const model =
    pickString(materialization, ["model"]) ??
    pickString(figurePolicy, ["model"]) ??
    (mode === "openai_gpt_image" ? "gpt-image-2" : null);
  const topic =
    pickString(materialization, ["topic"]) ??
    pickString(paperDesignIntake, ["topic", "field", "subfield"]) ??
    pickString(manifest, ["topic", "project_topic", "projectTopic"]);
  const anchorText = await readTextIfExists(
    resolveProjectArtifactPath(projectRoot, DEFAULT_FIGURE_ANCHOR_PLAN_PATH)
  );
  const generatedFiles: string[] = [];
  const figures = collectConfiguredFigures({
    materialization,
    anchorText,
    topic,
  });
  const prompts = await writePromptAndPlaceholderFiles({
    projectRoot,
    figures,
    topic,
    generatedFiles,
  });
  const receipts = await maybeGenerateImages({
    projectRoot,
    mode,
    provider,
    model,
    size: pickString(materialization, ["size"]) ?? "1536x1024",
    quality: pickString(materialization, ["quality"]) ?? "medium",
    outputFormat: pickString(materialization, ["output_format", "outputFormat"]) ?? "png",
    figures,
    prompts,
    generatedFiles,
  });
  const contractPath =
    pickString(materialization, ["contract_path", "contractPath"]) ??
    DEFAULT_FIGURE_PROMPT_CONTRACT_PATH;
  const contractResolvedPath = resolveProjectArtifactPath(projectRoot, contractPath);
  if (!contractResolvedPath) {
    throw new Error("Unable to resolve FIGURE_PROMPT_CONTRACT.json path.");
  }
  await writeJsonEnsured(contractResolvedPath, {
    schema_version: 1,
    status: "ready",
    mode,
    image_provider: provider,
    image_model: model,
    generated_at: new Date().toISOString(),
    openai_docs_basis:
      "Image API is reserved for single-prompt generation; missing OPENAI_API_KEY falls back to prompt-only.",
    figures,
  });
  generatedFiles.push(contractPath);
  const registryPath = await updateFigureRegistry({
    projectRoot,
    figures,
    generatedFiles,
  });
  const receiptsPath =
    receipts.length > 0
      ? await writeImageGenerationReceipts({ projectRoot, receipts })
      : null;
  if (receiptsPath) {
    generatedFiles.push(receiptsPath);
  }
  manifest.figure_prompt_contract = {
    schema_version: 1,
    status: "ready",
    mode,
    image_provider: provider,
    image_model: model,
    contract_path: contractPath,
    registry_path: registryPath,
    receipts_path: receiptsPath,
    figure_count: figures.length,
    placeholder_count: figures.filter((figure) => figure.generation_status !== "generated")
      .length,
    real_data_required_count: figures.filter((figure) => figure.requires_real_data)
      .length,
    updated_at: new Date().toISOString(),
  };
  await writeJsonEnsured(manifestPath, manifest);
  return {
    contractPath,
    registryPath,
    receiptsPath,
    mode,
    generatedFiles: uniqueStrings(generatedFiles),
    figures,
    receipts,
  };
}
