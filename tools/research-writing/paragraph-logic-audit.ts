import * as path from "node:path";

import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";
import {
  DEFAULT_PARAGRAPH_LOGIC_AUDIT_JSON_PATH,
  DEFAULT_PARAGRAPH_LOGIC_AUDIT_REPORT_PATH,
  DEFAULT_PARAGRAPH_LOGIC_REVERSE_OUTLINE_PATH,
  serializeParagraphLogicAuditState,
  type ParagraphLogicAuditState,
} from "../workflow-guard-state/paragraph-logic-audit";

type ParagraphRole =
  | "opening"
  | "background"
  | "gap"
  | "comparison"
  | "evidence"
  | "limitation"
  | "protocol"
  | "taxonomy"
  | "benchmark"
  | "open_problem"
  | "conclusion"
  | "support";

type AuditedParagraph = {
  index: number;
  openingSentence: string;
  closingSentence: string;
  role: ParagraphRole;
  anchorTokens: string[];
};

type SectionAudit = {
  sectionId: string;
  relativePath: string;
  paragraphCount: number;
  openingSentence: string | null;
  blockingIssueCount: number;
  advisoryIssueCount: number;
  sectionsAfterRepair: string[];
  paragraphs: AuditedParagraph[];
};

type PairIssue = {
  severity: "blocking" | "advisory";
  sectionId: string;
  fromParagraph: number;
  toParagraph: number;
  reason: string;
  sharedAnchors: string[];
  previousClosing: string;
  nextOpening: string;
};

type SectionTransitionIssue = {
  severity: "blocking" | "advisory";
  fromSectionId: string;
  toSectionId: string;
  reason: string;
  sharedAnchors: string[];
  previousClosing: string;
  nextOpening: string;
};

const STRUCTURAL_LINE_RE =
  /^\s*\\(?:section|subsection|subsubsection|paragraph|subparagraph|label|begin|end|centering|caption|small|footnotesize)\b/;

const STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "into",
  "than",
  "then",
  "when",
  "where",
  "while",
  "which",
  "their",
  "there",
  "about",
  "after",
  "before",
  "because",
  "between",
  "under",
  "over",
  "only",
  "also",
  "such",
  "each",
  "have",
  "has",
  "been",
  "being",
  "were",
  "them",
  "they",
  "more",
  "most",
  "very",
  "many",
  "much",
  "into",
  "onto",
  "through",
  "without",
  "within",
  "across",
  "paper",
  "section",
  "study",
  "studies",
  "method",
  "methods",
  "result",
  "results",
]);

const TRANSITION_OPENING_RE =
  /^(however|therefore|thus|consequently|by contrast|in contrast|moreover|furthermore|meanwhile|collectively|together|next|finally|beyond this|against this background|with this framing|to address this|to understand this|specifically)\b/i;
const TRANSITION_CLOSING_RE =
  /\b(this motivates|this leads to|this sets up|this raises|this suggests|this frames|the next section|in the next paragraph|to compare these|to understand why|to see whether|to examine this)\b/i;

function stripLatexComments(rawText: string): string {
  return rawText
    .split(/\r?\n/)
    .map((line) => {
      let output = "";
      let escaped = false;
      for (const char of line) {
        if (char === "%" && !escaped) {
          break;
        }
        output += char;
        escaped = char === "\\";
      }
      return output;
    })
    .join("\n");
}

function latexToPlainText(rawText: string): string {
  return rawText
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  const parts = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'`])/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [normalized];
}

function extractAnchorTokens(text: string): string[] {
  const normalized = latexToPlainText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ");
  const counts = new Map<string, number>();
  for (const token of normalized.split(/\s+/)) {
    if (token.length < 4 || STOPWORDS.has(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function guessParagraphRole(params: {
  text: string;
  paragraphIndex: number;
  paragraphCount: number;
}): ParagraphRole {
  const text = latexToPlainText(params.text).toLowerCase();
  if (params.paragraphIndex === 0) {
    return "opening";
  }
  if (
    params.paragraphIndex === params.paragraphCount - 1 &&
    /\b(overall|in conclusion|taken together|in summary|collectively)\b/.test(text)
  ) {
    return "conclusion";
  }
  if (/\b(compare|contrast|versus|whereas|while|trade-?off)\b/.test(text)) {
    return "comparison";
  }
  if (/\b(show|observe|find|result|evidence|empirical|benchmark|dataset|metric)\b/.test(text)) {
    return "evidence";
  }
  if (/\b(limit|caveat|weakness|unclear|fragile|bias|failure)\b/.test(text)) {
    return "limitation";
  }
  if (/\b(protocol|include|exclude|screen|search|retrieve)\b/.test(text)) {
    return "protocol";
  }
  if (/\b(taxonomy|family|cluster|category|group)\b/.test(text)) {
    return "taxonomy";
  }
  if (/\b(gap|missing|remain|challenge|open problem)\b/.test(text)) {
    return "gap";
  }
  if (/\b(benchmark|leaderboard|evaluation|metric)\b/.test(text)) {
    return "benchmark";
  }
  if (/\b(open problem|future|direction|opportunity)\b/.test(text)) {
    return "open_problem";
  }
  if (/\b(background|prior|existing|field)\b/.test(text)) {
    return "background";
  }
  return "support";
}

function extractParagraphs(rawText: string): string[] {
  const stripped = stripLatexComments(rawText);
  return stripped
    .split(/\n\s*\n/)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !STRUCTURAL_LINE_RE.test(line.trim()))
        .join(" ")
        .trim()
    )
    .filter((chunk) => latexToPlainText(chunk).split(/\s+/).length >= 8);
}

function buildPairIssue(params: {
  sectionId: string;
  previous: AuditedParagraph;
  next: AuditedParagraph;
}): PairIssue | null {
  const sharedAnchors = params.previous.anchorTokens.filter((token) =>
    params.next.anchorTokens.includes(token)
  );
  const nextHasCue = TRANSITION_OPENING_RE.test(params.next.openingSentence);
  if (sharedAnchors.length > 0 || nextHasCue) {
    return null;
  }
  return {
    severity: "blocking",
    sectionId: params.sectionId,
    fromParagraph: params.previous.index,
    toParagraph: params.next.index,
    reason:
      "adjacent paragraphs change topic without a shared anchor token or an explicit transition cue",
    sharedAnchors,
    previousClosing: params.previous.closingSentence,
    nextOpening: params.next.openingSentence,
  };
}

async function collectSectionAudits(params: {
  projectRoot: string;
  sectionOrder: string[];
}): Promise<{
  sections: SectionAudit[];
  blockingIssues: PairIssue[];
  advisoryIssues: PairIssue[];
  sectionTransitionIssues: SectionTransitionIssue[];
}> {
  const sections: SectionAudit[] = [];
  const blockingIssues: PairIssue[] = [];
  const advisoryIssues: PairIssue[] = [];

  for (const sectionId of params.sectionOrder) {
    const relativePath = `academic_writer/paper/sections/${sectionId}.tex`;
    const resolved = resolveProjectArtifactPath(params.projectRoot, relativePath);
    const sectionText = await readTextIfExists(resolved);
    if (!sectionText) {
      continue;
    }
    const paragraphs = extractParagraphs(sectionText);
    if (paragraphs.length === 0) {
      continue;
    }
    const auditedParagraphs = paragraphs.map((paragraph, index) => {
      const sentences = extractSentences(latexToPlainText(paragraph));
      return {
        index: index + 1,
        openingSentence: sentences[0] ?? latexToPlainText(paragraph),
        closingSentence: sentences[sentences.length - 1] ?? latexToPlainText(paragraph),
        role: guessParagraphRole({
          text: paragraph,
          paragraphIndex: index,
          paragraphCount: paragraphs.length,
        }),
        anchorTokens: extractAnchorTokens(paragraph),
      } satisfies AuditedParagraph;
    });

    const sectionBlockingIssues: PairIssue[] = [];
    const sectionAdvisoryIssues: PairIssue[] = [];
    for (let index = 0; index < auditedParagraphs.length - 1; index += 1) {
      const issue = buildPairIssue({
        sectionId,
        previous: auditedParagraphs[index],
        next: auditedParagraphs[index + 1],
      });
      if (issue) {
        sectionBlockingIssues.push(issue);
      }
      if (
        auditedParagraphs[index].role === auditedParagraphs[index + 1].role &&
        auditedParagraphs[index].role !== "evidence" &&
        auditedParagraphs[index].role !== "support"
      ) {
        sectionAdvisoryIssues.push({
          severity: "advisory",
          sectionId,
          fromParagraph: auditedParagraphs[index].index,
          toParagraph: auditedParagraphs[index + 1].index,
          reason: `adjacent paragraphs both look like ${auditedParagraphs[index].role} roles; consider a clearer handoff`,
          sharedAnchors: auditedParagraphs[index].anchorTokens.filter((token) =>
            auditedParagraphs[index + 1].anchorTokens.includes(token)
          ),
          previousClosing: auditedParagraphs[index].closingSentence,
          nextOpening: auditedParagraphs[index + 1].openingSentence,
        });
      }
    }

    sections.push({
      sectionId,
      relativePath,
      paragraphCount: auditedParagraphs.length,
      openingSentence: auditedParagraphs[0]?.openingSentence ?? null,
      blockingIssueCount: sectionBlockingIssues.length,
      advisoryIssueCount: sectionAdvisoryIssues.length,
      sectionsAfterRepair: uniqueStrings(
        sectionBlockingIssues.map(
          (issue) => `Repair P${issue.fromParagraph} -> P${issue.toParagraph}`
        )
      ),
      paragraphs: auditedParagraphs,
    });
    blockingIssues.push(...sectionBlockingIssues);
    advisoryIssues.push(...sectionAdvisoryIssues);
  }

  const sectionTransitionIssues: SectionTransitionIssue[] = [];
  for (let index = 0; index < sections.length - 1; index += 1) {
    const fromSection = sections[index];
    const toSection = sections[index + 1];
    const previousParagraph = fromSection.paragraphs[fromSection.paragraphs.length - 1];
    const nextParagraph = toSection.paragraphs[0];
    if (!previousParagraph || !nextParagraph) {
      continue;
    }
    const sharedAnchors = previousParagraph.anchorTokens.filter((token) =>
      nextParagraph.anchorTokens.includes(token)
    );
    const nextHasCue = TRANSITION_OPENING_RE.test(nextParagraph.openingSentence);
    if (sharedAnchors.length === 0 && !nextHasCue) {
      sectionTransitionIssues.push({
        severity: "advisory",
        fromSectionId: fromSection.sectionId,
        toSectionId: toSection.sectionId,
        reason:
          "adjacent sections switch argument focus without a visible lexical anchor or explicit transition cue",
        sharedAnchors,
        previousClosing: previousParagraph.closingSentence,
        nextOpening: nextParagraph.openingSentence,
      });
    }
  }

  return { sections, blockingIssues, advisoryIssues, sectionTransitionIssues };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatWeakestSections(sections: SectionAudit[]): string[] {
  return [...sections]
    .sort(
      (left, right) =>
        right.blockingIssueCount - left.blockingIssueCount ||
        right.advisoryIssueCount - left.advisoryIssueCount ||
        left.sectionId.localeCompare(right.sectionId)
    )
    .filter((section) => section.blockingIssueCount > 0 || section.advisoryIssueCount > 0)
    .slice(0, 3)
    .map((section) => section.sectionId);
}

function buildReverseOutlineMarkdown(sections: SectionAudit[]): string {
  const lines = ["# Paragraph Logic Reverse Outline", ""];
  for (const section of sections) {
    lines.push(`## ${section.sectionId}`);
    lines.push(`- Source: ${section.relativePath}`);
    lines.push(`- Paragraph count: ${section.paragraphCount}`);
    if (section.openingSentence) {
      lines.push(`- Section thesis guess: ${section.openingSentence}`);
    }
    lines.push("");
    lines.push("| Paragraph | Role | Opening Sentence | Bridge Status |");
    lines.push("| --- | --- | --- | --- |");
    for (const paragraph of section.paragraphs) {
      const bridgeStatus =
        paragraph.index < section.paragraphs.length &&
        section.blockingIssueCount > 0 &&
        section.sectionsAfterRepair.some((entry) => entry.includes(`P${paragraph.index} ->`))
          ? "repair"
          : paragraph.index === section.paragraphs.length
            ? "section-end"
            : "ok";
      lines.push(
        `| P${paragraph.index} | ${paragraph.role} | ${paragraph.openingSentence.replace(/\|/g, "\\|")} | ${bridgeStatus} |`
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function buildAuditReportMarkdown(params: {
  sections: SectionAudit[];
  blockingIssues: PairIssue[];
  advisoryIssues: PairIssue[];
  sectionTransitionIssues: SectionTransitionIssue[];
  state: ParagraphLogicAuditState;
}): string {
  const lines = [
    "# Paragraph Logic Audit",
    "",
    `- status: ${params.state.status}`,
    `- audited sections: ${params.state.auditedSectionCount}`,
    `- multi-paragraph sections: ${params.state.multiParagraphSectionCount}`,
    `- audited paragraphs: ${params.state.auditedParagraphCount}`,
    `- blocking issues: ${params.state.blockingIssueCount}`,
    `- advisory issues: ${params.state.advisoryIssueCount}`,
    `- section transition issues: ${params.state.sectionTransitionAdvisoryIssueCount}`,
    `- weakest sections: ${params.state.weakestSections.join(", ") || "none"}`,
    "",
    "## Summary",
    params.state.pendingReason ?? "Paragraph flow looks coherent enough for the current manuscript state.",
    "",
    "## Blocking Issues",
  ];
  if (params.blockingIssues.length === 0) {
    lines.push("- none");
  } else {
    for (const issue of params.blockingIssues) {
      lines.push(
        `- ${issue.sectionId} P${issue.fromParagraph} -> P${issue.toParagraph}: ${issue.reason}`
      );
      lines.push(`  - previous closing: ${issue.previousClosing}`);
      lines.push(`  - next opening: ${issue.nextOpening}`);
      if (issue.sharedAnchors.length > 0) {
        lines.push(`  - shared anchors: ${issue.sharedAnchors.join(", ")}`);
      }
    }
  }
  lines.push("", "## Advisory Issues");
  if (params.advisoryIssues.length === 0) {
    lines.push("- none");
  } else {
    for (const issue of params.advisoryIssues.slice(0, 10)) {
      lines.push(
        `- ${issue.sectionId} P${issue.fromParagraph} -> P${issue.toParagraph}: ${issue.reason}`
      );
    }
  }
  lines.push("", "## Section Transition Issues");
  if (params.sectionTransitionIssues.length === 0) {
    lines.push("- none");
  } else {
    for (const issue of params.sectionTransitionIssues) {
      lines.push(
        `- ${issue.fromSectionId} -> ${issue.toSectionId}: ${issue.reason}`
      );
      lines.push(`  - previous closing: ${issue.previousClosing}`);
      lines.push(`  - next opening: ${issue.nextOpening}`);
    }
  }
  lines.push("", "## Section Summary");
  for (const section of params.sections) {
    lines.push(
      `- ${section.sectionId}: paragraphs=${section.paragraphCount}, blocking=${section.blockingIssueCount}, advisory=${section.advisoryIssueCount}`
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function materializeParagraphLogicAudit(params: {
  projectRoot: string;
}): Promise<{
  state: ParagraphLogicAuditState;
  auditJsonPath: string;
  auditReportPath: string;
  reverseOutlinePath: string;
  generatedFiles: string[];
  blockingIssues: string[];
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const sectionOrder =
    writingContract.sectionOrder.length > 0
      ? writingContract.sectionOrder
      : writingContract.requiredSections;
  const auditJsonResolved = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_PARAGRAPH_LOGIC_AUDIT_JSON_PATH
  );
  const auditReportResolved = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_PARAGRAPH_LOGIC_AUDIT_REPORT_PATH
  );
  const reverseOutlineResolved = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_PARAGRAPH_LOGIC_REVERSE_OUTLINE_PATH
  );
  if (!auditJsonResolved || !auditReportResolved || !reverseOutlineResolved) {
    throw new Error("Unable to resolve paragraph logic audit paths.");
  }

  const { sections, blockingIssues, advisoryIssues, sectionTransitionIssues } =
    await collectSectionAudits({
    projectRoot: params.projectRoot,
    sectionOrder,
  });

  const auditedParagraphCount = sections.reduce(
    (sum, section) => sum + section.paragraphCount,
    0
  );
  const multiParagraphSectionCount = sections.filter(
    (section) => section.paragraphCount >= 2
  ).length;
  const weakestSections = formatWeakestSections(sections);
  const lastUpdatedAt = new Date().toISOString();
  const status: ParagraphLogicAuditState["status"] =
    sections.length === 0 || multiParagraphSectionCount === 0
      ? "pending"
      : blockingIssues.length > 0
        ? "blocked"
        : "ready";
  const pendingReason =
    sections.length === 0
      ? "No section drafts were available to audit for paragraph-to-paragraph flow yet."
      : multiParagraphSectionCount === 0
        ? "The manuscript does not yet have enough multi-paragraph sections to audit paragraph handoffs."
      : blockingIssues.length > 0
        ? `Repair paragraph handoffs in ${weakestSections.join(", ") || "the weakest sections"} before the next review handoff.`
        : advisoryIssues.length > 0
          ? "No blocking paragraph-flow breaks remain, but a few adjacent paragraphs still need cleaner role separation."
          : "Paragraph-to-paragraph flow is coherent across the currently drafted sections.";
  const nextRepairAction =
    blockingIssues.length > 0
      ? `Rewrite the flagged paragraph pairs in ${weakestSections[0] ?? "the weakest section"} and rerun the paragraph logic audit.`
      : advisoryIssues.length > 0
        ? "Tighten repeated paragraph roles and rerun the paragraph logic audit before final closeout."
        : null;
  const state: ParagraphLogicAuditState = {
    status,
    auditJsonPath: DEFAULT_PARAGRAPH_LOGIC_AUDIT_JSON_PATH,
    auditReportPath: DEFAULT_PARAGRAPH_LOGIC_AUDIT_REPORT_PATH,
    reverseOutlinePath: DEFAULT_PARAGRAPH_LOGIC_REVERSE_OUTLINE_PATH,
    auditedSectionCount: sections.length,
    multiParagraphSectionCount,
    auditedParagraphCount,
    blockingIssueCount: blockingIssues.length,
    advisoryIssueCount: advisoryIssues.length,
    sectionTransitionBlockingIssueCount: 0,
    sectionTransitionAdvisoryIssueCount: sectionTransitionIssues.length,
    weakestSections,
    nextRepairAction,
    pendingReason,
    lastUpdatedAt,
  };

  await writeJsonEnsured(auditJsonResolved, {
    schema_version: 1,
    generated_at: lastUpdatedAt,
    ...serializeParagraphLogicAuditState(state),
    sections,
    blocking_issues: blockingIssues,
    advisory_issues: advisoryIssues,
    section_transition_issues: sectionTransitionIssues,
  });
  await writeTextEnsured(reverseOutlineResolved, buildReverseOutlineMarkdown(sections));
  await writeTextEnsured(
    auditReportResolved,
    buildAuditReportMarkdown({
      sections,
      blockingIssues,
      advisoryIssues,
      sectionTransitionIssues,
      state,
    })
  );

  manifest.paragraph_logic_audit = serializeParagraphLogicAuditState(state);
  manifest.writing_contract = {
    ...(manifest.writing_contract && typeof manifest.writing_contract === "object"
      ? (manifest.writing_contract as Record<string, unknown>)
      : {}),
    paragraph_logic_status:
      status === "ready" ? "green" : status === "blocked" ? "red" : "pending",
    last_paragraph_logic_audit_at: lastUpdatedAt,
  };
  await writeJsonEnsured(manifestPath, manifest);

  return {
    state,
    auditJsonPath: DEFAULT_PARAGRAPH_LOGIC_AUDIT_JSON_PATH,
    auditReportPath: DEFAULT_PARAGRAPH_LOGIC_AUDIT_REPORT_PATH,
    reverseOutlinePath: DEFAULT_PARAGRAPH_LOGIC_REVERSE_OUTLINE_PATH,
    generatedFiles: [
      DEFAULT_PARAGRAPH_LOGIC_AUDIT_JSON_PATH,
      DEFAULT_PARAGRAPH_LOGIC_AUDIT_REPORT_PATH,
      DEFAULT_PARAGRAPH_LOGIC_REVERSE_OUTLINE_PATH,
    ],
    blockingIssues: blockingIssues.map(
      (issue) =>
        `${issue.sectionId} P${issue.fromParagraph} -> P${issue.toParagraph}: ${issue.reason}`
    ),
  };
}
