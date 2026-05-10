import type {
  OpenClawMessagePresentation,
  OpenClawPresentationSelectOption,
} from "../runtime-api.js";

const QUERY_ANSWER_LIST_SCHEMA_VERSION = "query-answer-list-v1";
const DEFAULT_RESPONSE_PREFIX = "query_answer:";
const DEFAULT_PLACEHOLDER = "Choose an answer...";
const MAX_QUESTION_LENGTH = 1000;
const MAX_CONTEXT_LENGTH = 1000;
const MAX_PLACEHOLDER_LENGTH = 100;
const MAX_OPTION_LABEL_LENGTH = 100;
const MAX_OPTION_VALUE_LENGTH = 100;
const MAX_OPTION_DESCRIPTION_LENGTH = 180;
const MAX_OPTIONS = 25;

type QueryAnswerListOption = {
  label: string;
  value: string;
  description: string | null;
};

export type QueryAnswerListMessagePayload = {
  schemaVersion: typeof QUERY_ANSWER_LIST_SCHEMA_VERSION;
  kind: "query_answer_list";
  channel: string | null;
  requesterAgent: string | null;
  projectId: string | null;
  query: {
    question: string;
    context: string | null;
    placeholder: string;
    optionCount: number;
    truncatedOptionCount: number;
    responsePrefix: string;
  };
  options: QueryAnswerListOption[];
  message: {
    text: string;
    presentation: OpenClawMessagePresentation;
  };
  usage: {
    tool: "message";
    action: "send";
    messageField: "message.text";
    presentationField: "message.presentation";
    note: string;
  };
};

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactWhitespace(value: string): string {
  return value.replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function singleLine(value: string): string {
  return compactWhitespace(value).replace(/\n+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function slugify(value: string): string | null {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || null;
}

function normalizeResponsePrefix(value: unknown): string {
  const prefix = readString(value);
  if (!prefix) {
    return DEFAULT_RESPONSE_PREFIX;
  }
  const normalized = singleLine(prefix);
  if (normalized.length > 40) {
    throw new Error("queryAnswerList.responsePrefix must be 40 characters or fewer.");
  }
  return normalized;
}

function readOptionLabel(option: unknown, index: number): string {
  if (typeof option === "string") {
    const label = singleLine(option);
    if (!label) {
      throw new Error(`queryAnswerList.options[${index}].label is required.`);
    }
    return truncate(label, MAX_OPTION_LABEL_LENGTH);
  }

  const record = readRecord(option);
  const label =
    readString(record?.label) ??
    readString(record?.title) ??
    readString(record?.name) ??
    readString(record?.text);
  if (!label) {
    throw new Error(`queryAnswerList.options[${index}].label is required.`);
  }
  return truncate(singleLine(label), MAX_OPTION_LABEL_LENGTH);
}

function readOptionDescription(option: unknown): string | null {
  const record = readRecord(option);
  const description =
    readString(record?.description) ??
    readString(record?.rationale) ??
    readString(record?.reason);
  return description ? truncate(singleLine(description), MAX_OPTION_DESCRIPTION_LENGTH) : null;
}

function readExplicitOptionValue(option: unknown): string | null {
  const record = readRecord(option);
  const value =
    readString(record?.value) ?? readString(record?.id) ?? readString(record?.key);
  return value ? singleLine(value) : null;
}

function applyResponsePrefix(value: string, prefix: string): string {
  if (!prefix || value.startsWith(prefix)) {
    return truncate(value, MAX_OPTION_VALUE_LENGTH);
  }
  const availableValueLength = Math.max(1, MAX_OPTION_VALUE_LENGTH - prefix.length);
  return `${prefix}${truncate(value, availableValueLength)}`;
}

function makeUniqueValue(params: {
  value: string;
  explicit: boolean;
  usedValues: Set<string>;
  index: number;
}): string {
  if (!params.usedValues.has(params.value)) {
    return params.value;
  }
  if (params.explicit) {
    throw new Error(`queryAnswerList.options[${params.index}].value must be unique.`);
  }

  for (let attempt = 2; attempt <= 99; attempt += 1) {
    const suffix = `_${attempt}`;
    const candidate = `${params.value.slice(0, MAX_OPTION_VALUE_LENGTH - suffix.length)}${suffix}`;
    if (!params.usedValues.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`queryAnswerList.options[${params.index}].value could not be made unique.`);
}

function normalizeOption(params: {
  option: unknown;
  index: number;
  responsePrefix: string;
  usedLabels: Set<string>;
  usedValues: Set<string>;
}): QueryAnswerListOption {
  const label = readOptionLabel(params.option, params.index);
  if (params.usedLabels.has(label)) {
    throw new Error(`queryAnswerList.options[${params.index}].label must be unique.`);
  }
  params.usedLabels.add(label);

  const explicitValue = readExplicitOptionValue(params.option);
  const baseValue = explicitValue ?? slugify(label) ?? `option_${params.index + 1}`;
  const prefixedValue = applyResponsePrefix(baseValue, params.responsePrefix);
  const value = makeUniqueValue({
    value: prefixedValue,
    explicit: Boolean(explicitValue),
    usedValues: params.usedValues,
    index: params.index,
  });
  params.usedValues.add(value);

  return {
    label,
    value,
    description: readOptionDescription(params.option),
  };
}

function readOptions(record: Record<string, unknown>, responsePrefix: string) {
  const rawOptions =
    Array.isArray(record.options)
      ? record.options
      : Array.isArray(record.answers)
        ? record.answers
        : Array.isArray(record.choices)
          ? record.choices
          : null;
  if (!rawOptions || rawOptions.length === 0) {
    throw new Error("queryAnswerList.options must include at least one option.");
  }

  const usedLabels = new Set<string>();
  const usedValues = new Set<string>();
  const options = rawOptions.slice(0, MAX_OPTIONS).map((option, index) =>
    normalizeOption({
      option,
      index,
      responsePrefix,
      usedLabels,
      usedValues,
    })
  );

  return {
    options,
    truncatedOptionCount: Math.max(0, rawOptions.length - options.length),
  };
}

function buildFallbackText(params: {
  question: string;
  context: string | null;
  options: QueryAnswerListOption[];
}): string {
  const lines = [params.question];
  if (params.context) {
    lines.push("", params.context);
  }
  lines.push("", "Options:");
  params.options.forEach((option, index) => {
    lines.push(
      `${index + 1}. ${option.label}${option.description ? ` - ${option.description}` : ""}`
    );
  });
  return lines.join("\n");
}

export function buildQueryAnswerListMessage(params: {
  queryAnswerList: unknown;
  channel?: string | null;
  requesterAgent?: string | null;
  projectId?: string | null;
}): QueryAnswerListMessagePayload {
  const record = readRecord(params.queryAnswerList);
  if (!record) {
    throw new Error("queryAnswerList is required for build_query_answer_list.");
  }

  const question =
    readString(record.question) ?? readString(record.prompt) ?? readString(record.query);
  if (!question) {
    throw new Error("queryAnswerList.question is required.");
  }
  const context = readString(record.context) ?? readString(record.description);
  const placeholder =
    readString(record.placeholder) ?? readString(record.selectPlaceholder) ?? DEFAULT_PLACEHOLDER;
  const responsePrefix = normalizeResponsePrefix(record.responsePrefix);
  const { options, truncatedOptionCount } = readOptions(record, responsePrefix);
  const presentationOptions: OpenClawPresentationSelectOption[] = options.map((option) => ({
    label: option.label,
    value: option.value,
  }));
  const questionText = truncate(compactWhitespace(question), MAX_QUESTION_LENGTH);
  const contextText = context ? truncate(compactWhitespace(context), MAX_CONTEXT_LENGTH) : null;
  const presentation: OpenClawMessagePresentation = {
    tone: "info",
    blocks: [
      {
        type: "text",
        text: questionText,
      },
      ...(contextText
        ? [
            {
              type: "context" as const,
              text: contextText,
            },
          ]
        : []),
      {
        type: "select",
        placeholder: truncate(singleLine(placeholder), MAX_PLACEHOLDER_LENGTH),
        options: presentationOptions,
      },
    ],
  };

  return {
    schemaVersion: QUERY_ANSWER_LIST_SCHEMA_VERSION,
    kind: "query_answer_list",
    channel: params.channel ?? null,
    requesterAgent: params.requesterAgent ?? null,
    projectId: params.projectId ?? null,
    query: {
      question: questionText,
      context: contextText,
      placeholder: truncate(singleLine(placeholder), MAX_PLACEHOLDER_LENGTH),
      optionCount: options.length,
      truncatedOptionCount,
      responsePrefix,
    },
    options,
    message: {
      text: buildFallbackText({
        question: questionText,
        context: contextText,
        options,
      }),
      presentation,
    },
    usage: {
      tool: "message",
      action: "send",
      messageField: "message.text",
      presentationField: "message.presentation",
      note:
        "Send message.text as the outbound message text and message.presentation as the portable OpenClaw presentation payload. Component selections return the option value to the agent as inbound text.",
    },
  };
}
