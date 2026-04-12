import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildCrossDomainRequisitionIdempotencyKey,
  evaluateCrossDomainInspirationGate,
  getCrossDomainInspirationStateSummary,
  materializeCrossDomainInspirationRequisition,
  materializeCrossDomainBridgeArtifacts,
  normalizeCrossDomainInspirationState,
  setCrossDomainInspirationState,
} from "../tools/idea-catalyst/cross-domain-contract.ts";
import { queueLiteratureDiscoveryRequisition } from "../tools/literature-discovery/workflow-bridge.ts";

test("cross-domain contract defaults to neuroscience, cognitive science, and psychology", () => {
  const state = normalizeCrossDomainInspirationState({});
  assert.deepEqual(state.preferredSourceDomains, [
    "Neuroscience",
    "Cognitive Science",
    "Psychology",
  ]);
  assert.equal(state.maxRequisitionRounds, 2);
  assert.equal(state.minimumSourcesPerDomain, 2);
});

test("missing neuroscience evidence blocks headline story readiness", () => {
  const state = normalizeCrossDomainInspirationState({
    status: "configured",
    satisfied_domains: ["Psychology"],
  });
  const gate = evaluateCrossDomainInspirationGate({
    state,
    workflowLine: "experiment",
    headlineClaim: true,
  });
  assert.equal(gate.ready, false);
  assert.match(gate.blockers[0], /Neuroscience/);
});

test("partial evidence can enrich survey taxonomy but not experiment headline claims", () => {
  const state = normalizeCrossDomainInspirationState({
    status: "partial",
    allow_survey_taxonomy_enrichment_with_evidence_debt: true,
    allow_partial_story_usage: false,
  });
  assert.equal(
    evaluateCrossDomainInspirationGate({
      state,
      workflowLine: "survey",
    }).ready,
    true
  );
  assert.equal(
    evaluateCrossDomainInspirationGate({
      state,
      workflowLine: "experiment",
      headlineClaim: true,
    }).ready,
    false
  );
});

test("cross-domain state persists through manifest updates with bounded requisition data", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cross-domain-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo", current_stage: "idea" }, null, 2)}\n`,
    "utf8"
  );

  const updated = await setCrossDomainInspirationState({
    projectRoot,
    patch: {
      status: "searching",
      target_problem: "avoid pseudo-label confirmation bias",
      missing_domains: ["Neuroscience"],
      requisition_round: 1,
    },
  });
  assert.equal(updated.state.status, "searching");
  assert.equal(updated.state.requisitionRound, 1);

  const summary = await getCrossDomainInspirationStateSummary({
    projectRoot,
    workflowLine: "experiment",
    headlineClaim: true,
  });
  assert.equal(summary.gate.ready, false);

  const key = buildCrossDomainRequisitionIdempotencyKey({
    projectId: "demo",
    targetProblem: summary.state.targetProblem,
    missingDomains: summary.state.missingDomains,
    requisitionRound: summary.state.requisitionRound,
  });
  assert.match(key, /^cross_domain_evidence_missing:demo:/);
});

test("missing neuroscience evidence materializes actionable PaperNexus requisition", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cross-domain-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo",
        current_stage: "idea",
        cross_domain_inspiration: {
          enabled: true,
          status: "configured",
          target_domain: "GCD",
          target_problem: "avoid pseudo-label confirmation bias",
          missing_domains: ["Neuroscience"],
          satisfied_domains: [],
          max_requisition_rounds: 2,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const materialized = await materializeCrossDomainInspirationRequisition({
    projectRoot,
    projectId: "demo",
    workflowLine: "experiment",
  });
  assert.equal(materialized.created, true);
  assert.equal(materialized.state.status, "searching");
  assert.equal(materialized.state.requisitionRound, 1);

  const requisitionPath = path.join(
    projectRoot,
    "researcher",
    "idea-catalyst",
    "INVESTIGATION_REQUISITION.json"
  );
  const requisition = JSON.parse(await fs.readFile(requisitionPath, "utf8"));
  assert.deepEqual(requisition.missing_domains, ["Neuroscience"]);
  assert.match(JSON.stringify(requisition.search_queries), /dual-process|cognitive control/i);

  const queued = await queueLiteratureDiscoveryRequisition({
    projectRoot,
    packetPath: "researcher/idea-catalyst/INVESTIGATION_REQUISITION.json",
    triggerKind: "cross_domain_literature_discovery",
    originStage: "idea",
    requestIdPrefix: "cross-domain",
  });
  assert.equal(queued.created, true);
  assert.equal(queued.request.triggerKind, "cross_domain_literature_discovery");
});

test("cross-domain bridge materializer writes bridge evidence, concept map, and recontextualization", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cross-domain-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo",
        current_stage: "idea",
        cross_domain_inspiration: {
          enabled: true,
          status: "evidence_ready",
          target_domain: "GCD",
          target_problem: "avoid pseudo-label confirmation bias",
          preferred_source_domains: ["Neuroscience", "Cognitive Science"],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await materializeCrossDomainBridgeArtifacts({
    projectRoot,
    evidenceItems: [
      {
        bridgeId: "bridge-1",
        sourceDomain: "Neuroscience",
        sourceConcept: "cognitive control",
        transferableMechanism: "gate fast decisions with confidence",
        recontextualizedMechanism: "verify uncertain pseudo-labels with slow graph checks",
      },
    ],
  });

  assert.equal(result.state.status, "recontextualized");
  assert.equal(
    await fs.readFile(
      path.join(projectRoot, "researcher", "ideation", "NEURO_COGNITIVE_CONCEPT_MAP.md"),
      "utf8"
    ).then((text) => /cognitive control/i.test(text)),
    true
  );
  assert.equal(
    await fs.readFile(
      path.join(projectRoot, "researcher", "ideation", "CROSS_DOMAIN_RECONTEXTUALIZATION.md"),
      "utf8"
    ).then((text) => /pseudo-labels/i.test(text)),
    true
  );
});
