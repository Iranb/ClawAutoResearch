import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { ArtifactTabs, type ArtifactTabId } from "../components/artifacts/ArtifactTabs";
import { RawFileViewer } from "../components/artifacts/RawFileViewer";
import { AppShell } from "../components/layout/AppShell";
import { BlockingReasonCard } from "../components/summary/BlockingReasonCard";
import { NextActionCard } from "../components/summary/NextActionCard";
import { SummaryCards } from "../components/summary/SummaryCards";
import {
  fetchProjectArtifacts,
  fetchProjectRawArtifact,
  fetchProjectSummary,
  type ArtifactDescriptor,
  type ProjectDetailSummary,
  type RawArtifact,
} from "../lib/api";

export function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const [summary, setSummary] = useState<ProjectDetailSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [activeTab, setActiveTab] = useState<ArtifactTabId>("summary");
  const [artifacts, setArtifacts] = useState<ArtifactDescriptor[] | null>(null);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [artifactsStatus, setArtifactsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<ArtifactDescriptor["key"] | null>(null);
  const [rawArtifactCache, setRawArtifactCache] = useState<
    Partial<Record<ArtifactDescriptor["key"], RawArtifact>>
  >({});
  const [rawArtifactError, setRawArtifactError] = useState<
    Partial<Record<ArtifactDescriptor["key"], string>>
  >({});
  const [loadingArtifactKey, setLoadingArtifactKey] = useState<ArtifactDescriptor["key"] | null>(
    null,
  );

  useEffect(() => {
    let isMounted = true;
    setSummary(null);
    setSummaryStatus("loading");
    setSummaryError(null);
    setActiveTab("summary");
    setArtifacts(null);
    setArtifactsError(null);
    setArtifactsStatus("idle");
    setSelectedArtifactKey(null);
    setRawArtifactCache({});
    setRawArtifactError({});
    setLoadingArtifactKey(null);

    void fetchProjectSummary(projectId)
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setSummary(response);
        setSummaryStatus("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setSummary(null);
        setSummaryStatus("error");
        setSummaryError(error instanceof Error ? error.message : "Failed to load project summary.");
      });

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (activeTab === "summary" || artifactsStatus !== "idle") {
      return;
    }

    let isMounted = true;
    setArtifactsStatus("loading");
    setArtifactsError(null);

    void fetchProjectArtifacts(projectId)
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setArtifacts(response);
        setArtifactsStatus("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setArtifactsStatus("error");
        setArtifactsError(error instanceof Error ? error.message : "Failed to load artifacts.");
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, artifactsStatus, projectId]);

  const visibleArtifacts = filterArtifactsForTab(activeTab, artifacts ?? []);

  useEffect(() => {
    if (activeTab === "summary" || artifactsStatus !== "ready") {
      return;
    }

    if (visibleArtifacts.length === 0) {
      setSelectedArtifactKey(null);
      return;
    }

    if (
      selectedArtifactKey &&
      visibleArtifacts.some((artifact) => artifact.key === selectedArtifactKey)
    ) {
      return;
    }

    setSelectedArtifactKey(visibleArtifacts[0]?.key ?? null);
  }, [activeTab, artifactsStatus, selectedArtifactKey, visibleArtifacts]);

  useEffect(() => {
    if (
      activeTab === "summary" ||
      !selectedArtifactKey ||
      rawArtifactCache[selectedArtifactKey] ||
      rawArtifactError[selectedArtifactKey]
    ) {
      return;
    }

    let isMounted = true;
    setLoadingArtifactKey(selectedArtifactKey);

    void fetchProjectRawArtifact(projectId, selectedArtifactKey)
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setRawArtifactCache((current) => ({
          ...current,
          [selectedArtifactKey]: response,
        }));
        setLoadingArtifactKey((current) =>
          current === selectedArtifactKey ? null : current,
        );
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setRawArtifactError((current) => ({
          ...current,
          [selectedArtifactKey]:
            error instanceof Error ? error.message : "Failed to load artifact.",
        }));
        setLoadingArtifactKey((current) =>
          current === selectedArtifactKey ? null : current,
        );
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, projectId, rawArtifactCache, rawArtifactError, selectedArtifactKey]);

  const activeArtifact =
    selectedArtifactKey && rawArtifactCache[selectedArtifactKey]
      ? rawArtifactCache[selectedArtifactKey]
      : null;
  const activeArtifactDescriptor =
    selectedArtifactKey
      ? visibleArtifacts.find((artifact) => artifact.key === selectedArtifactKey) ?? null
      : null;
  const summaryTaskBoard = summary?.taskBoard ?? [];
  const summaryEvidenceBoard = summary?.evidenceBoard ?? {
    benchmarkProtocolStatus: null,
    benchmarkProtocolLocked: false,
    statisticalEvidenceStatus: null,
    statisticalEvidenceClaimStrength: null,
    venueCompetitionStatus: null,
    venueCompetitionGraphContextStatus: null,
    ablationEvidenceStatus: null,
    ablationEvidenceSufficiency: null,
    mechanismEvidenceStatus: null,
    mechanismEvidenceGraphContextStatus: null,
    reproducibilityPackStatus: null,
    reproducibilityEnvironmentStatus: null,
    cameraReadyEvidenceStatus: null,
    cameraReadyFiguresStatus: null,
    cameraReadyTablesStatus: null,
    cameraReadyCaptionsStatus: null,
    topTierVerdict: null,
    evidenceCloseoutStatus: null,
  };
  const writingSupportCards =
    summary
      ? [
          {
            label: "Paper story",
            value: formatEvidenceLine(
              summary.paperStoryStatus,
              summary.paperStoryClaimSupportStatus
                ? [
                    summary.paperStoryClaimSupportStatus,
                    summary.paperStorySupportedClaimCount !== null
                      ? `${summary.paperStorySupportedClaimCount} supported`
                      : null,
                    summary.paperStoryUnsupportedClaimCount !== null
                      ? `${summary.paperStoryUnsupportedClaimCount} unsupported`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" / ")
                : null,
            ),
          },
          {
            label: "Results storyline",
            value: formatEvidenceLine(
              summary.resultsStorylineStatus,
              summary.resultsStorylineQuestionCount !== null
                ? `${summary.resultsStorylineQuestionCount} questions`
                : null,
            ),
          },
          {
            label: "Innovation synthesis",
            value: formatEvidenceLine(
              summary.innovationSynthesisStatus,
              [
                summary.innovationSynthesisIntegrationPattern,
                summary.innovationSynthesisPointCount !== null
                  ? `${summary.innovationSynthesisPointCount} points`
                  : null,
              ]
                .filter(Boolean)
                .join(" / "),
            ),
          },
          {
            label: "Title / Abstract / Intro",
            value: formatEvidenceLine(
              summary.titleAbstractIntroStatus,
              summary.titleAbstractIntroAlignmentStatus,
            ),
          },
          {
            label: "Review pressure",
            value: summary.reviewPressureStatus ?? "Unknown",
          },
          {
            label: "Citation integrity",
            value: formatEvidenceLine(
              summary.citationIntegrityStatus,
              [
                summary.suspiciousCitationCount !== null
                  ? `${summary.suspiciousCitationCount} suspicious`
                  : null,
                summary.hallucinatedCitationCount !== null
                  ? `${summary.hallucinatedCitationCount} hallucinated`
                  : null,
              ]
                .filter(Boolean)
                .join(" / "),
            ),
          },
          {
            label: "Figure / Table pack",
            value: summary.figureTableArtifactSummary ?? "Unknown",
          },
          {
            label: "Survey authoring pack",
            value: summary.surveyAuthoringArtifactSummary ?? "n/a",
          },
        ]
      : [];

  return (
    <AppShell
      eyebrow="Project Detail"
      title={summary?.title ?? projectId}
      description="Read-only summary and artifact drill-down for one workflow project."
    >
      {summaryStatus === "loading" ? (
        <section className="status-panel">
          <p>Loading project summary...</p>
        </section>
      ) : null}

      {summaryStatus === "error" ? (
        <section className="status-panel status-panel--error">
          <p>{summaryError}</p>
        </section>
      ) : null}

      {summary ? (
        <>
          <SummaryCards summary={summary} />
          <section className="detail-grid detail-grid--long">
            <BlockingReasonCard blockingReason={summary.blockingReason} />
            <NextActionCard
              nextAction={summary.nextAction}
              resumeAction={summary.resumeAction}
            />
          </section>
          <ArtifactTabs activeTab={activeTab} onTabChange={setActiveTab}>
            {activeTab === "summary" ? (
              <>
                <section className="detail-grid detail-grid--secondary">
                  {writingSupportCards.map((item) => (
                    <article className="detail-card" key={item.label}>
                      <p className="detail-card__label">{item.label}</p>
                      <p className="detail-card__value">{item.value}</p>
                    </article>
                  ))}
                </section>
                <section className="detail-grid detail-grid--secondary">
                  <article className="detail-card">
                    <p className="detail-card__label">PaperNexus phase</p>
                    <p className="detail-card__value">
                      {summary.papernexusPhase ?? "Unknown"}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">PaperNexus progress</p>
                    <p className="detail-card__value">
                      {summary.papernexusProgressSummary ?? "No progress summary"}
                    </p>
                  </article>
                </section>
                {summary.workflowLine === "survey" ||
                summary.surveyStatus ||
                summary.paperMode === "survey" ? (
                  <section className="detail-grid detail-grid--secondary">
                    <article className="detail-card">
                      <p className="detail-card__label">Survey topic</p>
                      <p className="detail-card__value">
                        {summary.surveyTopic ?? "No survey topic"}
                      </p>
                    </article>
                    <article className="detail-card">
                      <p className="detail-card__label">Survey status</p>
                      <p className="detail-card__value">
                        {summary.surveyStatus ?? "Unknown"}
                      </p>
                    </article>
                    <article className="detail-card">
                      <p className="detail-card__label">Survey progress</p>
                      <p className="detail-card__value">
                        {summary.surveyProgressSummary ?? "No survey progress summary"}
                      </p>
                    </article>
                  </section>
                ) : null}
                <section className="detail-grid detail-grid--secondary">
                  <article className="detail-card">
                    <p className="detail-card__label">Team round</p>
                    <p className="detail-card__value">
                      {summary.teamRoundLead
                        ? `${summary.teamRoundLead} · ${summary.teamRoundActiveSessions ?? 0} active`
                        : "No active round"}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Task graph health</p>
                    <p className="detail-card__value">
                      {summary.teamTaskGraphTaskCount !== null
                        ? `${summary.teamTaskGraphClaimableCount ?? 0} claimable · ${summary.teamTaskGraphBlockedCount ?? 0} blocked · ${summary.teamTaskGraphClaimedCount ?? 0} claimed`
                        : "No task graph"}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Last claimed task</p>
                    <p className="detail-card__value">
                      {summary.teamRoundLastClaimedTaskId ?? "None"}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Last completed task</p>
                    <p className="detail-card__value">
                      {summary.teamRoundLastCompletedTaskId ?? "None"}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Handoff recovery</p>
                    <p className="detail-card__value">
                      {`${summary.pendingHandoffCount} pending · ${summary.unackedHandoffCount} unacked · ${summary.failedHandoffCount} failed`}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Repair queue</p>
                    <p className="detail-card__value">
                      {`${summary.repairQueueCount} repairs · ${summary.staleClaimCount} stale claims`}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Runtime safety</p>
                    <p className="detail-card__value">
                      {`${summary.capabilityWarnings} capability warnings · ${summary.activeWriteScopeCount} write locks`}
                    </p>
                  </article>
                </section>
                <section className="detail-grid detail-grid--secondary">
                  <article className="detail-card">
                    <p className="detail-card__label">Benchmark protocol</p>
                    <p className="detail-card__value">
                      {formatEvidenceLine(
                        summaryEvidenceBoard.benchmarkProtocolStatus,
                        summaryEvidenceBoard.benchmarkProtocolLocked ? "locked" : "unlocked",
                      )}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Statistical evidence</p>
                    <p className="detail-card__value">
                      {formatEvidenceLine(
                        summaryEvidenceBoard.statisticalEvidenceStatus,
                        summaryEvidenceBoard.statisticalEvidenceClaimStrength,
                      )}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Venue competition</p>
                    <p className="detail-card__value">
                      {formatEvidenceLine(
                        summaryEvidenceBoard.venueCompetitionStatus,
                        summaryEvidenceBoard.venueCompetitionGraphContextStatus,
                      )}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Ablation evidence</p>
                    <p className="detail-card__value">
                      {formatEvidenceLine(
                        summaryEvidenceBoard.ablationEvidenceStatus,
                        summaryEvidenceBoard.ablationEvidenceSufficiency,
                      )}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Mechanism evidence</p>
                    <p className="detail-card__value">
                      {formatEvidenceLine(
                        summaryEvidenceBoard.mechanismEvidenceStatus,
                        summaryEvidenceBoard.mechanismEvidenceGraphContextStatus,
                      )}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Reproducibility pack</p>
                    <p className="detail-card__value">
                      {formatEvidenceLine(
                        summaryEvidenceBoard.reproducibilityPackStatus,
                        summaryEvidenceBoard.reproducibilityEnvironmentStatus,
                      )}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Camera-ready evidence</p>
                    <p className="detail-card__value">
                      {formatEvidenceLine(
                        summaryEvidenceBoard.cameraReadyEvidenceStatus,
                        [
                          summaryEvidenceBoard.cameraReadyFiguresStatus,
                          summaryEvidenceBoard.cameraReadyTablesStatus,
                          summaryEvidenceBoard.cameraReadyCaptionsStatus,
                        ]
                          .filter(Boolean)
                          .join(" / "),
                      )}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="detail-card__label">Evidence closeout</p>
                    <p className="detail-card__value">
                      {formatEvidenceLine(
                        summaryEvidenceBoard.evidenceCloseoutStatus,
                        summaryEvidenceBoard.topTierVerdict,
                      )}
                    </p>
                  </article>
                </section>
                {summaryTaskBoard.length > 0 ? (
                  <section className="detail-card">
                    <p className="detail-card__label">Task board</p>
                    <div className="artifact-panel">
                      {summaryTaskBoard.map((task) => (
                        <article className="detail-card" key={task.taskId}>
                          <p className="detail-card__label">{task.taskId}</p>
                          <p className="detail-card__value">{task.title}</p>
                          <p className="detail-card__meta">
                            {[
                              task.owner ? `owner: ${task.owner}` : null,
                              `status: ${task.status}`,
                              task.claimant ? `claimant: ${task.claimant}` : null,
                              task.dependsOn.length > 0
                                ? `depends: ${task.dependsOn.join(", ")}`
                                : null,
                              `verify: ${task.verificationStatus}`,
                              task.latestEvent ? `event: ${task.latestEvent}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            ) : (
              <section className="artifact-panel">
                {artifactsStatus === "loading" ? (
                  <p>Loading artifacts...</p>
                ) : null}
                {artifactsStatus === "error" ? (
                  <p className="raw-viewer__note raw-viewer__note--error">
                    {artifactsError}
                  </p>
                ) : null}
                {artifactsStatus === "ready" ? (
                  <>
                    <div className="artifact-selector">
                      {visibleArtifacts.length > 0 ? (
                        visibleArtifacts.map((artifact) => (
                          <button
                            className="artifact-selector__button"
                            data-active={String(selectedArtifactKey === artifact.key)}
                            key={artifact.key}
                            onClick={() => setSelectedArtifactKey(artifact.key)}
                            type="button"
                          >
                            <span>{artifact.label}</span>
                            <span className="artifact-selector__meta">
                              {artifact.exists ? artifact.kind : "missing"}
                            </span>
                          </button>
                        ))
                      ) : (
                        <p>No artifacts available for this tab.</p>
                      )}
                    </div>
                    <RawFileViewer
                      artifact={activeArtifact}
                      errorMessage={
                        selectedArtifactKey ? rawArtifactError[selectedArtifactKey] ?? null : null
                      }
                      isLoading={
                        selectedArtifactKey !== null && loadingArtifactKey === selectedArtifactKey
                      }
                      title={activeArtifactDescriptor?.label ?? "Artifact viewer"}
                    />
                  </>
                ) : null}
              </section>
            )}
          </ArtifactTabs>
        </>
      ) : null}
    </AppShell>
  );
}

function formatEvidenceLine(primary: string | null, secondary: string | null): string {
  if (primary && secondary) {
    return `${primary} · ${secondary}`;
  }
  return primary ?? secondary ?? "Unknown";
}

function filterArtifactsForTab(
  tab: ArtifactTabId,
  artifacts: ArtifactDescriptor[],
): ArtifactDescriptor[] {
  if (tab === "manifest") {
    return artifacts.filter((artifact) => artifact.key === "manifest");
  }

  if (tab === "graph") {
    return artifacts.filter((artifact) => artifact.key.startsWith("graph_"));
  }

  if (tab === "outputs") {
    return artifacts.filter((artifact) => artifact.group === "outputs");
  }

  if (tab === "runtime") {
    return artifacts.filter((artifact) => artifact.group === "runtime");
  }

  if (tab === "raw") {
    return artifacts;
  }

  return [];
}
