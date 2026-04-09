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

  if (tab === "runtime") {
    return artifacts.filter((artifact) => artifact.key.startsWith("runtime_"));
  }

  if (tab === "raw") {
    return artifacts;
  }

  return [];
}
