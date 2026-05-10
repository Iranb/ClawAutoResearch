export type ImageGenerationStatus =
  | "generated"
  | "skipped_missing_key"
  | "skipped_prompt_only"
  | "skipped_real_data_required"
  | "failed";

export type ImageGenerationReceipt = {
  schema_version: 1;
  provider: string;
  model: string | null;
  status: ImageGenerationStatus;
  prompt_path: string | null;
  output_path: string | null;
  figure_id: string | null;
  generated_at: string;
  error: string | null;
};

export type ImageGenerationParams = {
  prompt: string;
  outputPath: string;
  promptPath?: string | null;
  figureId?: string | null;
  model?: string | null;
  size?: string | null;
  quality?: string | null;
  outputFormat?: string | null;
};

export type ImageGenerationProvider = {
  name: string;
  defaultModel: string;
  isConfigured(): Promise<boolean>;
  generate(params: ImageGenerationParams): Promise<ImageGenerationReceipt>;
};
