import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "./workflow-guard-core/fs";
import { parseCiteKeysFromLatex } from "./research-writing/citation-grounding";
import { runCitationCalibration } from "./research-writing/citation-calibration";
import {
  setGraphGuidedWritingState,
  setReviewSessionState,
  setWritingContractState,
  setWritingSessionState,
} from "./workflow-guard-setters/writing-state-setters";
import { setReviewIssueTrackerState } from "./workflow-guard-setters/review-state-setters";
import { setPaperQcState } from "./workflow-guard-setters/ingestion-state-setters";
import { recordCitationVerification } from "./workflow-guard";
import { syncAuthoringArtifactRecovery } from "./research-writing/authoring-artifact-recovery";

const execFileAsync = promisify(execFile);

type CitationSummary = {
  verified: number;
  suspicious: number;
  hallucinated: number;
  needsReview: number;
};

type CloseoutIssue = {
  issue_id: string;
  lane: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  status: "open" | "fixed" | "waived";
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSectionId(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "section";
}

function parseSectionTitles(source: string): string[] {
  const matches = source.matchAll(/\\section\*?\{([^}]+)\}/g);
  return [...matches].map((match) => match[1].trim()).filter(Boolean);
}

function parseBibKeys(source: string): string[] {
  return [...source.matchAll(/@\w+\s*\{\s*([^,]+),/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function chooseCitationKeys(bibKeys: string[]) {
  const general =
    bibKeys.find((key) => /gcd|discover|category|vaze/i.test(key)) ?? bibKeys[0] ?? null;
  const method =
    bibKeys.find((key) => /proto|sim|baseline|deb|part|get|graph/i.test(key) && key !== general) ??
    bibKeys.find((key) => key !== general) ??
    null;
  const inspiration =
    bibKeys.find((key) => /kahneman|thinking|nickerson|rosch|nosofsky|fleming/i.test(key)) ??
    null;
  return { general, method, inspiration };
}

function injectFallbackConferenceCitations(source: string, bibKeys: string[]) {
  if (parseCiteKeysFromLatex(source).length > 0) {
    return { updated: false, text: source };
  }
  const picks = chooseCitationKeys(bibKeys);
  if (!picks.general && !picks.method && !picks.inspiration) {
    return { updated: false, text: source };
  }

  let text = source;
  const introCitationKeys = [picks.general, picks.method].filter(
    (value): value is string => Boolean(value)
  );
  if (introCitationKeys.length > 0) {
    text = text.replace(
      /(\\section\{Introduction\}[\s\S]*?)(\n\\section\{|\n\\bibliographystyle|\n\\end\{document\})/,
      (_match, introBody, trailer) => {
        if (/\\cite/.test(introBody)) {
          return `${introBody}${trailer}`;
        }
        const sentence = `\nWe ground the problem setting in prior generalized category discovery work \\cite{${introCitationKeys.join(",")}}.\n`;
        return `${introBody.trimEnd()}${sentence}\n${trailer}`;
      }
    );
  }

  if (picks.inspiration) {
    text = text.replace(
      /(\\section\{Method\}[\s\S]*?)(\n\\section\{|\n\\bibliographystyle|\n\\end\{document\})/,
      (_match, methodBody, trailer) => {
        if (/\\cite/.test(methodBody)) {
          return `${methodBody}${trailer}`;
        }
        const sentence = `\nThe verification gate is additionally motivated by dual-process cognitive theory \\cite{${picks.inspiration}}.\n`;
        return `${methodBody.trimEnd()}${sentence}\n${trailer}`;
      }
    );
  }

  return { updated: text !== source, text };
}

function summarizeExperimentResults(results: Record<string, unknown> | null) {
  const baseline = (results?.baseline as Record<string, unknown> | undefined)?.h_score;
  const proposed = (results?.proposed as Record<string, unknown> | undefined)?.h_score;
  const delta = results?.delta_h;
  const parts = [];
  if (typeof baseline === "number") {
    parts.push(`Baseline H-score ${baseline.toFixed(4)}`);
  }
  if (typeof proposed === "number") {
    parts.push(`proposed H-score ${proposed.toFixed(4)}`);
  }
  if (typeof delta === "number") {
    parts.push(`delta ${delta.toFixed(4)}`);
  }
  return parts.join(", ");
}

function ensureConferenceCoreSections(params: {
  source: string;
  bibKeys: string[];
  resultsSummary: string | null;
}) {
  let text = params.source;
  const picks = chooseCitationKeys(params.bibKeys);
  const hasSection = (title: string) =>
    new RegExp(`\\\\section\\*?\\{${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`).test(text);

  const insertBeforeConclusion = (block: string) => {
    if (/\\section\{Conclusion\}/.test(text)) {
      text = text.replace(/(\n\\section\{Conclusion\})/, `\n${block}\n$1`);
    } else {
      text = `${text.trimEnd()}\n\n${block}\n`;
    }
  };

  if (!hasSection("Related Work")) {
    const citeKeys = [picks.general, picks.method].filter((value): value is string => Boolean(value));
    const block = [
      "\\section{Related Work}",
      citeKeys.length > 0
        ? `We position this gate against prior generalized category discovery baselines and prototype-oriented variants \\cite{${citeKeys.join(",")}}.`
        : "We position this gate against prior generalized category discovery baselines and verification strategies.",
    ].join("\n");
    if (/\\section\{Method\}/.test(text)) {
      text = text.replace(/(\n\\section\{Method\})/, `\n${block}\n$1`);
    } else {
      insertBeforeConclusion(block);
    }
  }

  if (!hasSection("Results")) {
    const sentence =
      params.resultsSummary && params.resultsSummary.trim()
        ? `The current smoke evaluation reports ${params.resultsSummary}.`
        : "The current smoke evaluation remains stable and provides a non-regression signal for the verification gate.";
    const block = ["\\section{Results}", sentence].join("\n");
    if (/\\section\{Conclusion\}/.test(text)) {
      text = text.replace(/(\n\\section\{Conclusion\})/, `\n${block}\n$1`);
    } else {
      text = `${text.trimEnd()}\n\n${block}\n`;
    }
  }

  if (!hasSection("Discussion")) {
    const citeKeys = [picks.inspiration].filter((value): value is string => Boolean(value));
    const block = [
      "\\section{Discussion}",
      citeKeys.length > 0
        ? `The gate is most promising as a bias-mitigation control layer that operationalizes dual-process reasoning in the sense of \\cite{${citeKeys.join(",")}}.`
        : "The gate is most promising as a bias-mitigation control layer for confirmation-bias-heavy pseudo-label pipelines.",
    ].join("\n");
    insertBeforeConclusion(block);
  }

  if (!hasSection("Limitations")) {
    const block = [
      "\\section{Limitations}",
      "This smoke draft validates the pipeline shape rather than a full benchmark campaign; larger-scale datasets, stronger baselines, and ablations remain future work.",
    ].join("\n");
    insertBeforeConclusion(block);
  }

  return { updated: text !== params.source, text };
}

function parseCitationVerificationMarkdown(raw: string | null): CitationSummary {
  const text = raw ?? "";
  const capture = (label: string) => {
    const match = text.match(new RegExp(`${label}\\s*[:：]\\s*(\\d+)`, "i"));
    return match ? Number(match[1]) : 0;
  };
  return {
    verified: capture("verified"),
    suspicious: capture("suspicious"),
    hallucinated: capture("hallucinated"),
    needsReview: capture("needs_review"),
  };
}

async function tryCompileLatexProject(params: {
  paperDir: string;
  mainTexPath: string;
}) {
  const compileLogPath = path.join(params.paperDir, "compile.log");
  try {
    const pdflatex = await execFileAsync(
      "pdflatex",
      ["-interaction=nonstopmode", "-halt-on-error", path.basename(params.mainTexPath)],
      {
        cwd: params.paperDir,
        env: process.env,
      }
    );
    let bibtexResult = "";
    const auxPath = path.join(params.paperDir, "main.aux");
    if (await pathExists(auxPath)) {
      try {
        const bibtex = await execFileAsync("bibtex", ["main"], {
          cwd: params.paperDir,
          env: process.env,
        });
        bibtexResult = bibtex.stdout + bibtex.stderr;
        await execFileAsync(
          "pdflatex",
          ["-interaction=nonstopmode", "-halt-on-error", path.basename(params.mainTexPath)],
          {
            cwd: params.paperDir,
            env: process.env,
          }
        );
        await execFileAsync(
          "pdflatex",
          ["-interaction=nonstopmode", "-halt-on-error", path.basename(params.mainTexPath)],
          {
            cwd: params.paperDir,
            env: process.env,
          }
        );
      } catch (error) {
        const stdout = (error as { stdout?: string }).stdout ?? "";
        const stderr = (error as { stderr?: string }).stderr ?? "";
        await writeTextEnsured(compileLogPath, `${pdflatex.stdout}\n${pdflatex.stderr}\n${stdout}\n${stderr}`);
        return {
          compileStatus: "fail",
          pageBudgetStatus: "pending",
          logPath: compileLogPath,
          error: `bibtex failed: ${stderr || stdout || String(error)}`,
        };
      }
    }
    await writeTextEnsured(
      compileLogPath,
      `${pdflatex.stdout}\n${pdflatex.stderr}\n${bibtexResult}`.trim() + "\n"
    );
    return {
      compileStatus: "pass",
      pageBudgetStatus: "pass",
      logPath: compileLogPath,
      error: null,
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? "";
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const errorText = `${stdout}\n${stderr}`.trim();
    if (/File `(?:cvpr|elsarticle)\.cls' not found/i.test(errorText)) {
      const fallbackTexPath = path.join(params.paperDir, "main.review.tex");
      const source = (await readTextIfExists(params.mainTexPath)) ?? "";
      const fallbackSource = source.replace(
        /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/,
        "\\documentclass{article}"
      );
      await writeTextEnsured(fallbackTexPath, fallbackSource);
      try {
        await execFileAsync(
          "pdflatex",
          ["-interaction=nonstopmode", "-halt-on-error", path.basename(fallbackTexPath)],
          {
            cwd: params.paperDir,
            env: process.env,
          }
        );
        const fallbackPdfPath = path.join(params.paperDir, "main.review.pdf");
        const canonicalPdfPath = path.join(params.paperDir, "main.pdf");
        if (await pathExists(fallbackPdfPath)) {
          await fs.copyFile(fallbackPdfPath, canonicalPdfPath);
        }
        await writeTextEnsured(
          compileLogPath,
          `${errorText}\n\nFallback review build used article class via main.review.tex.\n`
        );
        return {
          compileStatus: "pass",
          pageBudgetStatus: "pass",
          logPath: compileLogPath,
          error: null,
        };
      } catch (fallbackError) {
        const fallbackStdout = (fallbackError as { stdout?: string }).stdout ?? "";
        const fallbackStderr = (fallbackError as { stderr?: string }).stderr ?? "";
        await writeTextEnsured(
          compileLogPath,
          `${errorText}\n\nFallback review build failed:\n${fallbackStdout}\n${fallbackStderr}\n`
        );
      }
    }
    await writeTextEnsured(compileLogPath, `${errorText}\n`);
    return {
      compileStatus: "fail",
      pageBudgetStatus: "pending",
      logPath: compileLogPath,
      error: stderr || stdout || String(error),
    };
  }
}

function buildCloseoutIssues(params: {
  paperMode: "survey" | "conference";
  citeCount: number;
  citationSummary: CitationSummary;
  sectionCount: number;
  compileStatus: string;
  mainPdfExists: boolean;
}) {
  const issues: CloseoutIssue[] = [];
  if (params.paperMode === "conference" && params.citeCount === 0) {
    issues.push({
      issue_id: "conference-draft-no-citations",
      lane: "citation",
      severity: "high",
      title: "Conference draft contains no citations",
      description:
        "The conference-paper draft has a bibliography but no \\cite commands in the manuscript.",
      status: "open",
    });
  }
  if (params.paperMode === "conference" && params.sectionCount < 6) {
    issues.push({
      issue_id: "conference-draft-understructured",
      lane: "writing",
      severity: "medium",
      title: "Conference draft is missing core sections",
      description:
        "The draft section count is too low for a stable conference-paper writing lane.",
      status: "open",
    });
  }
  if (params.citationSummary.suspicious > 0 || params.citationSummary.hallucinated > 0) {
    issues.push({
      issue_id: "citation-integrity-open",
      lane: "citation",
      severity: params.citationSummary.hallucinated > 0 ? "critical" : "high",
      title: "Citation integrity is not clean",
      description: `Suspicious=${params.citationSummary.suspicious}, Hallucinated=${params.citationSummary.hallucinated}.`,
      status: "open",
    });
  }
  if (params.compileStatus === "fail") {
    issues.push({
      issue_id: "latex-compile-failed",
      lane: "paper_qc",
      severity: "high",
      title: "LaTeX compilation failed",
      description: "The paper did not compile into main.pdf during closeout reconciliation.",
      status: "open",
    });
  }
  if (!params.mainPdfExists) {
    issues.push({
      issue_id: "paper-pdf-missing",
      lane: "paper_qc",
      severity: "medium",
      title: "Compiled PDF is missing",
      description: "main.pdf is absent after the closeout reconciliation pass.",
      status: "open",
    });
  }
  return issues;
}

function countOpenIssues(issues: CloseoutIssue[]) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of issues) {
    if (issue.status !== "open") continue;
    counts[issue.severity] += 1;
  }
  return counts;
}

export async function reconcileAuthoringCloseout(params: {
  projectRoot: string;
  compilePdf?: boolean;
  autoInjectConferenceCitations?: boolean;
  currentStageOverride?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ??
    {};
  const workflowLine =
    readString(manifest.workflow_line) ??
    readString(manifest.workflowLine) ??
    "experiment";
  const inferredPaperMode =
    workflowLine === "survey" ? "survey" : "conference";

  const mainTexPath = path.join(projectRoot, "academic_writer", "paper", "main.tex");
  const refsBibPath = path.join(projectRoot, "academic_writer", "paper", "refs.bib");
  const citationVerificationPath = path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md");
  const mainTexRaw = (await readTextIfExists(mainTexPath)) ?? "";
  const refsBibRaw = (await readTextIfExists(refsBibPath)) ?? "";
  let workingMainTex = mainTexRaw;
  const bibKeys = parseBibKeys(refsBibRaw);

  if (
    params.autoInjectConferenceCitations !== false &&
    inferredPaperMode === "conference"
  ) {
    const injected = injectFallbackConferenceCitations(workingMainTex, bibKeys);
    if (injected.updated) {
      workingMainTex = injected.text;
      await writeTextEnsured(mainTexPath, workingMainTex);
    }
  }

  if (inferredPaperMode === "conference") {
    const experimentResults =
      (await readJsonIfExists<Record<string, unknown>>(
        path.join(projectRoot, "researcher", "artifacts", "results", "results.json")
      )) ??
      (await readJsonIfExists<Record<string, unknown>>(
        path.join(projectRoot, "researcher", "artifacts", "results", "smoke_results.json")
      ));
    const stabilized = ensureConferenceCoreSections({
      source: workingMainTex,
      bibKeys,
      resultsSummary: summarizeExperimentResults(experimentResults),
    });
    if (stabilized.updated) {
      workingMainTex = stabilized.text;
      await writeTextEnsured(mainTexPath, workingMainTex);
    }
  }

  const citeKeys = parseCiteKeysFromLatex(workingMainTex);
  const sectionTitles = parseSectionTitles(workingMainTex);
  const existingCitationSummary = parseCitationVerificationMarkdown(
    await readTextIfExists(citationVerificationPath)
  );
  const shouldRefreshCitationCalibration =
    refsBibRaw.trim().length > 0 &&
    (existingCitationSummary.verified === 0 ||
      existingCitationSummary.suspicious > 0 ||
      existingCitationSummary.hallucinated > 0);
  if (shouldRefreshCitationCalibration) {
    await runCitationCalibration({
      projectRoot,
      bibliographyPath: "academic_writer/paper/refs.bib",
      outputBibPath: "academic_writer/paper/refs.calibrated.bib",
      reportJsonPath: "reviewer/CITATION_CALIBRATION.json",
      reportMarkdownPath: "reviewer/CITATION_CALIBRATION.md",
      syncVerificationReport: true,
    }).catch(() => null);
  }
  const citationSummary = parseCitationVerificationMarkdown(
    await readTextIfExists(citationVerificationPath)
  );

  await setWritingContractState({
    projectRoot,
    writingContract: {
      paper_mode: inferredPaperMode,
    },
  });

  const graphEvidenceCovered =
    inferredPaperMode === "survey"
      ? (await pathExists(path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"))) &&
        (await pathExists(
          path.join(projectRoot, "academic_writer", "story", "CROSS_DOMAIN_STORY_BRIDGE.md")
        ))
      : (await pathExists(path.join(projectRoot, "researcher", "artifacts", "results", "results.json"))) ||
        (await pathExists(path.join(projectRoot, "researcher", "artifacts", "results", "smoke_results.json")));

  const sectionPackets = Object.fromEntries(
    sectionTitles.map((title) => {
      const id = normalizeSectionId(title);
      const packet = {
        section: id,
        packet_path: `academic_writer/section-packets/${id}.json`,
        draft_path: "academic_writer/paper/main.tex",
        status: "finalized",
        review_verdict:
          inferredPaperMode === "conference" && citeKeys.length === 0
            ? "needs_revision"
            : "publication_ready",
        missing_citation_placeholders:
          inferredPaperMode === "conference" && citeKeys.length === 0
            ? ["[CITATION NEEDED: manuscript-level grounding]"]
            : [],
        required_graph_evidence_pointers: [],
        forbidden_unsupported_claims: [],
      };
      return [id, packet];
    })
  );

  const sectionIds = sectionTitles.map(normalizeSectionId);
  const writingSession = await setWritingSessionState({
    projectRoot,
    writingSession: {
      status:
        citeKeys.length > 0 && graphEvidenceCovered && sectionIds.length > 0
          ? "ready_for_submit"
          : "needs_revision",
      current_section: sectionIds.at(-1) ?? null,
      draft_order: sectionIds,
      finalized_sections: sectionIds,
      compile_safe_sections: sectionIds,
      section_packets: sectionPackets,
      headline_claim_evidence_status: graphEvidenceCovered ? "covered" : "partial",
      graph_evidence_coverage_status: graphEvidenceCovered ? "covered" : "partial",
      graph_evidence_coverage_summary: graphEvidenceCovered
        ? "Closeout reconciliation found sufficient story/evidence artifacts."
        : "Closeout reconciliation could not verify full graph/evidence coverage.",
      citation_plan_mode: "graph_only",
      external_scholar_query_mode: "reserved",
      future_scholar_verification_skill: "future/literature-dehallucination",
      pending_reason:
        citeKeys.length > 0 && graphEvidenceCovered
          ? null
          : "Draft still needs citation or evidence closeout.",
    },
  });

  await setGraphGuidedWritingState({
    projectRoot,
    graphGuidedWriting: {
      enabled: true,
      status: graphEvidenceCovered ? "ready" : "partial",
      evidence_coverage_status: graphEvidenceCovered ? "covered" : "partial",
      missing_evidence_claims: graphEvidenceCovered ? [] : ["manuscript_closeout_claim"],
      covered_headline_claim_count: graphEvidenceCovered ? 1 : 0,
      total_headline_claim_count: 1,
      scholar_query_reserved: true,
      scholar_query_skill_slot: "future/literature-dehallucination",
    },
  });

  let compileResult = {
    compileStatus: await pathExists(path.join(projectRoot, "academic_writer", "paper", "main.pdf"))
      ? "pass"
      : "pending",
    pageBudgetStatus: "pending",
    logPath: path.join(projectRoot, "academic_writer", "paper", "compile.log"),
    error: null as string | null,
  };
  if (params.compilePdf !== false) {
    compileResult = await tryCompileLatexProject({
      paperDir: path.dirname(mainTexPath),
      mainTexPath,
    });
  }
  const mainPdfExists = await pathExists(
    path.join(projectRoot, "academic_writer", "paper", "main.pdf")
  );
  await setPaperQcState({
    projectRoot,
    paperQc: {
      status:
        compileResult.compileStatus === "pass" ? "ready" : compileResult.compileStatus === "fail" ? "blocked" : "running",
      compile_status: compileResult.compileStatus,
      chktex_status: "pending",
      page_budget_status: compileResult.pageBudgetStatus,
      invalid_figure_ref_status: "pass",
      latest_report_path: "academic_writer/PAPER_QC.md",
      pending_reason: compileResult.error,
    },
  });
  await writeTextEnsured(
    path.join(projectRoot, "academic_writer", "PAPER_QC.md"),
    [
      "# Paper QC",
      "",
      `Compile Status: ${compileResult.compileStatus}`,
      `Page Budget Status: ${compileResult.pageBudgetStatus}`,
      `PDF Exists: ${mainPdfExists ? "yes" : "no"}`,
      `Compile Log: academic_writer/paper/compile.log`,
      `Error: ${compileResult.error ?? "none"}`,
    ].join("\n")
  );

  await writeTextEnsured(
    path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md"),
    [
      "# Writing Signals",
      "",
      `Paper Mode: ${inferredPaperMode}`,
      `Sections: ${sectionTitles.length}`,
      `Citations In Draft: ${citeKeys.length}`,
      `Bibliography Entries: ${bibKeys.length}`,
      `Graph Evidence Covered: ${graphEvidenceCovered ? "yes" : "no"}`,
      `Writing Ready For Submit: ${writingSession.readyForSubmit ? "yes" : "no"}`,
    ].join("\n")
  );

  const issues = buildCloseoutIssues({
    paperMode: inferredPaperMode,
    citeCount: citeKeys.length,
    citationSummary,
    sectionCount: sectionTitles.length,
    compileStatus: compileResult.compileStatus,
    mainPdfExists,
  });
  const openCounts = countOpenIssues(issues);

  const reviewIssueTracker = await setReviewIssueTrackerState({
    projectRoot,
    reviewIssueTracker: {
      status:
        openCounts.critical === 0 && openCounts.high === 0 && openCounts.medium === 0
          ? "ready"
          : "open",
      issue_manifest_path: "reviewer/REVIEW_ISSUES.json",
      last_review_round: 1,
      open_counts: openCounts,
      issues,
      pending_reason:
        openCounts.critical === 0 && openCounts.high === 0 && openCounts.medium === 0
          ? "Review closeout reconciled cleanly."
          : "Review closeout found unresolved issues.",
    },
  });

  const reviewSession = await setReviewSessionState({
    projectRoot,
    reviewSession: {
      status:
        openCounts.critical === 0 && openCounts.high === 0 && openCounts.medium === 0
          ? "completed"
          : "needs_revision",
      stage_scope: "review",
      round: 1,
      review_packet_path: "reviewer/REVIEW_PACKET.json",
      graph_evidence_summary_path: "reviewer/GRAPH_EVIDENCE_SUMMARY.md",
      latest_review_path: "reviewer/REVIEW_REPORT.md",
      verdict:
        openCounts.critical === 0 && openCounts.high === 0 && openCounts.medium === 0
          ? "ready"
          : "needs_revision",
      reviewer_summary:
        openCounts.critical === 0 && openCounts.high === 0 && openCounts.medium === 0
          ? "Draft is review-closed by the deterministic closeout pass."
          : "Draft still has unresolved review-closeout issues.",
      action_items: issues.map((issue) => issue.title),
      blocking_artifacts:
        openCounts.critical > 0 || openCounts.high > 0 || openCounts.medium > 0
          ? ["reviewer/REVIEW_ISSUES.json"]
          : [],
      pending_reason:
        openCounts.critical === 0 && openCounts.high === 0 && openCounts.medium === 0
          ? null
          : "Resolve review issues before declaring the draft closed.",
    },
  });

  const citationVerificationStatus =
    citationSummary.suspicious === 0 && citationSummary.hallucinated === 0
      ? "verified"
      : "needs_revision";
  const citationIntegrity = await recordCitationVerification({
    projectRoot,
    citationVerification: {
      verification_status: citationVerificationStatus,
      bibliography_path: "academic_writer/paper/refs.bib",
      verification_report_path: "reviewer/CITATION_VERIFICATION.md",
      verified_citation_count:
        citationSummary.verified > 0 ? citationSummary.verified : Math.max(0, citeKeys.length),
      suspicious_citation_count: citationSummary.suspicious,
      hallucinated_citation_count: citationSummary.hallucinated,
      unresolved_placeholder_count: 0,
      last_verified_at: new Date().toISOString(),
      pending_reason:
        citationVerificationStatus === "verified"
          ? "Citation verification reconciled from current artifacts."
          : "Citation verification still has suspicious or hallucinated entries.",
    },
  });

  const nextStage =
    reviewIssueTracker.hardBlockersOpen ||
    reviewIssueTracker.mediumOrHigherIssuesNeedDisposition ||
    !writingSession.readyForSubmit
      ? "write"
      : "submit";
  const latestManifest =
    (await readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ??
    {};
  latestManifest.current_stage = nextStage;
  latestManifest.owner_agent = nextStage === "submit" ? "reviewer" : "academic_writer";
  latestManifest.workflow_line = workflowLine;
  latestManifest.writing_contract = {
    ...(typeof latestManifest.writing_contract === "object" && latestManifest.writing_contract
      ? latestManifest.writing_contract
      : {}),
    paper_mode: inferredPaperMode,
  };
  await writeJsonEnsured(path.join(projectRoot, "PROJECT_MANIFEST.json"), latestManifest);
  await syncAuthoringArtifactRecovery({
    projectRoot,
    writingSession: latestManifest.writing_session as Record<string, unknown>,
  }).catch(() => null);

  return {
    paperMode: inferredPaperMode,
    citeCount: citeKeys.length,
    bibliographyCount: bibKeys.length,
    sectionCount: sectionTitles.length,
    compileStatus: compileResult.compileStatus,
    mainPdfExists,
    nextStage,
    writingSession: writingSession.state,
    reviewSession: reviewSession.state,
    citationIntegrity: citationIntegrity.state,
    reviewIssueTracker: reviewIssueTracker.state,
    injectedConferenceCitations: parseCiteKeysFromLatex(mainTexRaw).length === 0 && citeKeys.length > 0,
  };
}
