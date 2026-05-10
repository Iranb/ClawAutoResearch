import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";

export type PaperDesignIntakeStatus = "missing" | "draft" | "ready";
export type PaperDesignFigureMode = "prompt_only" | "openai_gpt_image";

export type PaperDesignFigurePolicy = {
  mode: PaperDesignFigureMode;
  provider: string | null;
  model: string | null;
  allowGeneratedConceptFigures: boolean;
  requireRealDataForResultFigures: boolean;
};

export type PaperDesignIntakeState = {
  schemaVersion: 1;
  status: PaperDesignIntakeStatus;
  field: string | null;
  subfield: string | null;
  paperType: string | null;
  targetVenue: string | null;
  venueFamily: string | null;
  templateMode: string | null;
  pageBudget: string | null;
  experimentDataStatus: string | null;
  language: string | null;
  deadline: string | null;
  methodParadigm: string | null;
  noveltyModule: string | null;
  innovationDirections: string[];
  baselineFamilies: string[];
  citationStyle: string | null;
  figurePolicy: PaperDesignFigurePolicy;
  sourceArtifacts: string[];
  lastUpdatedAt: string | null;
};

const DEFAULT_FIGURE_POLICY: PaperDesignFigurePolicy = {
  mode: "prompt_only",
  provider: null,
  model: null,
  allowGeneratedConceptFigures: true,
  requireRealDataForResultFigures: true,
};

function normalizeFigureMode(value: unknown): PaperDesignFigureMode {
  const normalized = normalizeStage(value);
  if (normalized === "openai" || normalized === "openai_gpt_image") {
    return "openai_gpt_image";
  }
  return "prompt_only";
}

function normalizeStatus(value: unknown, hasAnyIntakeField: boolean): PaperDesignIntakeStatus {
  const normalized = normalizeStage(value);
  if (normalized === "ready") {
    return "ready";
  }
  if (normalized === "draft" || normalized === "pending" || normalized === "incomplete") {
    return "draft";
  }
  if (!hasAnyIntakeField) {
    return "missing";
  }
  return "ready";
}

export function normalizePaperDesignFigurePolicy(
  value: unknown
): PaperDesignFigurePolicy {
  const record = asRecord(value) ?? {};
  const mode = normalizeFigureMode(record.mode);
  return {
    mode,
    provider:
      pickString(record, ["provider", "image_provider", "imageProvider"]) ??
      (mode === "openai_gpt_image" ? "openai" : null),
    model: pickString(record, ["model", "image_model", "imageModel"]),
    allowGeneratedConceptFigures:
      pickBoolean(record, [
        "allowGeneratedConceptFigures",
        "allow_generated_concept_figures",
      ]) ?? DEFAULT_FIGURE_POLICY.allowGeneratedConceptFigures,
    requireRealDataForResultFigures:
      pickBoolean(record, [
        "requireRealDataForResultFigures",
        "require_real_data_for_result_figures",
      ]) ?? DEFAULT_FIGURE_POLICY.requireRealDataForResultFigures,
  };
}

export function normalizePaperDesignIntakeState(
  value: unknown
): PaperDesignIntakeState {
  const record = asRecord(value) ?? {};
  const figurePolicy = normalizePaperDesignFigurePolicy(
    record.figurePolicy ?? record.figure_policy
  );
  const field = pickString(record, ["field"]);
  const subfield = pickString(record, ["subfield", "sub_field"]);
  const paperType = pickString(record, ["paperType", "paper_type"]);
  const targetVenue = pickString(record, ["targetVenue", "target_venue", "venue"]);
  const venueFamily = pickString(record, ["venueFamily", "venue_family"]);
  const templateMode = pickString(record, ["templateMode", "template_mode"]);
  const pageBudget = pickString(record, ["pageBudget", "page_budget"]);
  const experimentDataStatus = pickString(record, [
    "experimentDataStatus",
    "experiment_data_status",
    "dataStatus",
    "data_status",
  ]);
  const language = pickString(record, ["language"]);
  const deadline = pickString(record, ["deadline"]);
  const methodParadigm = pickString(record, [
    "methodParadigm",
    "method_paradigm",
  ]);
  const noveltyModule = pickString(record, [
    "noveltyModule",
    "novelty_module",
    "organizingLens",
    "organizing_lens",
  ]);
  const innovationDirections = uniqueStrings(
    asStringArray(record.innovationDirections ?? record.innovation_directions)
  );
  const baselineFamilies = uniqueStrings(
    asStringArray(record.baselineFamilies ?? record.baseline_families)
  );
  const citationStyle = pickString(record, ["citationStyle", "citation_style"]);
  const sourceArtifacts = uniqueStrings(
    asStringArray(record.sourceArtifacts ?? record.source_artifacts)
  );
  const lastUpdatedAt = pickString(record, ["lastUpdatedAt", "last_updated_at"]);
  const hasAnyIntakeField =
    Boolean(field) ||
    Boolean(subfield) ||
    Boolean(paperType) ||
    Boolean(targetVenue) ||
    Boolean(venueFamily) ||
    Boolean(experimentDataStatus) ||
    innovationDirections.length > 0 ||
    baselineFamilies.length > 0;

  return {
    schemaVersion: 1,
    status: normalizeStatus(record.status, hasAnyIntakeField),
    field,
    subfield,
    paperType,
    targetVenue,
    venueFamily,
    templateMode,
    pageBudget,
    experimentDataStatus,
    language,
    deadline,
    methodParadigm,
    noveltyModule,
    innovationDirections,
    baselineFamilies,
    citationStyle,
    figurePolicy,
    sourceArtifacts,
    lastUpdatedAt,
  };
}

export function serializePaperDesignIntakeState(
  state: PaperDesignIntakeState
): Record<string, unknown> {
  return {
    schema_version: 1,
    status: state.status,
    field: state.field,
    subfield: state.subfield,
    paper_type: state.paperType,
    target_venue: state.targetVenue,
    venue_family: state.venueFamily,
    template_mode: state.templateMode,
    page_budget: state.pageBudget,
    experiment_data_status: state.experimentDataStatus,
    language: state.language,
    deadline: state.deadline,
    method_paradigm: state.methodParadigm,
    novelty_module: state.noveltyModule,
    innovation_directions: state.innovationDirections,
    baseline_families: state.baselineFamilies,
    citation_style: state.citationStyle,
    figure_policy: {
      mode: state.figurePolicy.mode,
      provider: state.figurePolicy.provider,
      model: state.figurePolicy.model,
      allow_generated_concept_figures:
        state.figurePolicy.allowGeneratedConceptFigures,
      require_real_data_for_result_figures:
        state.figurePolicy.requireRealDataForResultFigures,
    },
    source_artifacts: state.sourceArtifacts,
    last_updated_at: state.lastUpdatedAt,
  };
}

export function summarizePaperDesignIntakeForPrompt(
  state: PaperDesignIntakeState
): string {
  if (state.status === "missing") {
    return "Paper design intake: missing; use conservative multi-domain defaults and ask for field, paper type, venue, evidence status, and figure policy only when they affect the next artifact.";
  }
  const identity = [
    state.field ? `field=${state.field}` : null,
    state.subfield ? `subfield=${state.subfield}` : null,
    state.paperType ? `type=${state.paperType}` : null,
    state.targetVenue ? `venue=${state.targetVenue}` : null,
    state.experimentDataStatus ? `data=${state.experimentDataStatus}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  const baselines =
    state.baselineFamilies.length > 0
      ? `baselines=${state.baselineFamilies.slice(0, 4).join(", ")}`
      : null;
  const novelty =
    state.noveltyModule ?? state.innovationDirections.slice(0, 3).join(", ");
  return [
    `Paper design intake: ${state.status}`,
    identity.length > 0 ? identity.join("; ") : "domain details unset",
    novelty ? `novelty=${novelty}` : null,
    baselines,
    `figures=${state.figurePolicy.mode}${state.figurePolicy.model ? `/${state.figurePolicy.model}` : ""}`,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("; ");
}

export function applyPaperDesignIntakePatch(params: {
  current: unknown;
  patch: unknown;
  updatedAt?: string | null;
}): PaperDesignIntakeState {
  const current = normalizePaperDesignIntakeState(params.current);
  const patch = asRecord(params.patch) ?? {};
  const serializedCurrent = serializePaperDesignIntakeState(current);
  const next = normalizePaperDesignIntakeState({
    ...serializedCurrent,
    ...patch,
    figure_policy: {
      ...(asRecord(serializedCurrent.figure_policy) ?? {}),
      ...(asRecord(patch.figurePolicy ?? patch.figure_policy) ?? {}),
    },
  });
  return {
    ...next,
    lastUpdatedAt:
      params.updatedAt ??
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      current.lastUpdatedAt,
  };
}

export function scorePaperDesignIntakeCompleteness(
  state: PaperDesignIntakeState
): {
  requiredKnown: number;
  requiredTotal: number;
  optionalKnown: number;
  missing: string[];
} {
  const required: Array<[string, unknown]> = [
    ["field", state.field],
    ["paper_type", state.paperType],
    ["target_venue", state.targetVenue],
    ["experiment_data_status", state.experimentDataStatus],
  ];
  const optional: unknown[] = [
    state.subfield,
    state.venueFamily,
    state.methodParadigm,
    state.noveltyModule,
    state.citationStyle,
    state.language,
    state.deadline,
    state.pageBudget,
    state.templateMode,
    state.innovationDirections.length > 0 ? state.innovationDirections : null,
    state.baselineFamilies.length > 0 ? state.baselineFamilies : null,
    pickNumber({ value: state.sourceArtifacts.length }, ["value"]),
  ];
  const missing = required
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return {
    requiredKnown: required.length - missing.length,
    requiredTotal: required.length,
    optionalKnown: optional.filter(Boolean).length,
    missing,
  };
}
