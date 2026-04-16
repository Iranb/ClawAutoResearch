  ---
       1. OVERALL ARCHITECTURE

       The system is a multi-layered, multi-agent automated research pipeline built on OpenClaw (an agent framework) with the following core components:

       Primary Systems:

       1. openclaw-research - Main workflow orchestration plugin (TypeScript)
       2. PaperNexus - Knowledge graph + literature management system
       3. EvoScientist - Python-based evolutionary AI researcher with persistent memory
       4. EvoSkills - Skill library for EvoScientist
       5. ClawAutoResearch - Alternative research automation implementation
       6. SciCanvas - Research presentation/visualization system
       7. any-auto-register - Configuration/registration system
       8. openclaw - Core agent framework (main OpenClaw repository)

       ---
       2. RESEARCH PIPELINE (End-to-End)

       The system implements a deterministic state machine with these stages:

       setup → graph_build → frontier_mapping → idea → plan → code → experiment → analyze → review → write → submit → done

       Key Pipeline Characteristics:

       - Revision loops preserved: workflow can regress backward if review fails
       - Stage gates enforced: hard preconditions block forward progress
       - State-driven: not chat-history dependent; driven by JSON manifests
       - Mailbox-based: durable inter-agent communication with mention sanitization
       - Auto-iterator: deterministic auto_iterator_tick mechanism for autonomous progression

       Core State Files:

       - PROJECT_MANIFEST.json - coarse stage, micro-stage, budget, gate state
       - TRACK_REGISTRY.json - candidate/active/parked/killed hypothesis tracks
       - CLAIM_POLICY.md - claim support labels (SUPPORTED/PARTIAL/UNSUPPORTED)
       - EXPERIMENT_LEDGER.json - structured experiment memory (queued/running/done/failed/synced)
       - GATE_STATE.json - gate progression tracking
       - .openclaw-research/workflow-mailbox.json - durable mailbox

       ---
       3. ML/AI CAPABILITIES

       Training & Experiment Management:

       - EXPERIMENT_LEDGER.json: Tracks queued, running, completed, failed experiments
       - Experiment memory: Persistent hyperparameter and data-handling tactics
       - Remote experiment launches: REMOTE_RUN.json per experiment bundle
       - Parallel experiments: Batched launch and resource orchestration
       - Monitoring: monitor-experiment skill for run tracking and result collection
       - Dry-run support: scientific-visualization for sanity-checking

       Evaluation & Analysis:

       - Result interpretation: claim-evidence extraction and structuring
       - Scientific figures: metrics, visualization, figure asset organization
       - Theory/proof packets: structured evidence bundles
       - Ablation analysis: systematic claim support grading
       - Statistical analysis: evidence quality verification

       Model Integration:

       - Claude API (Anthropic) - primary LLM backbone
       - Multi-provider support capability: OpenAI, Google, etc.
       - Local MCP servers for extended capabilities
       - PaperNexus-backed graph reasoning

       ---
       4. PAPER WRITING/GENERATION CAPABILITIES

       Writing Contract System:

       - Template-driven: mandatory templates enforceable in workflow state
       - Proof-aware writing: supports lemma_result_only main text with proof appendix
       - Section order enforcement: durable contract binding section sequence
       - Citation integrity: verifiable bibliography against DBLP/CrossRef/DataCite
       - Knowledge graph storyline: optional KG_STORYLINE_PACKET.md for structured narrative

       Writing Workflow:

       1. paper-plan: outline generation, template mapping, venue constraints
       2. paper-write: section-by-section drafting with paragraph logic auditing
       3. paper-compile: compilation and output validation
       4. citation-management: Zotero integration, bibliography queue, refs.bib prep
       5. citation-preflight: writer-side verification before submission
       6. ai-research-prompt: structured AI research writing assistance

       Writing Signals (Non-Blocking):

       - Theory signal: mechanic/theoretic support confidence (green/red)
       - Storyline signal: thesis clarity and evidence spine coherence
       - Paragraph logic signal: section-to-section flow coherence

       ---
       5. LITERATURE REVIEW & KNOWLEDGE GRAPH

       PaperNexus Integration:

       - Local-first knowledge graph: Markdown/PDF ingestion with multilayer graph construction
       - Full-text acquisition priority:
         a. papers-cool (guaranteed baseline)
         b. pasa-paper-search (optional secondary source)
         c. hugging-face-paper-pages (Markdown)
         d. arxiv2md-api (direct arXiv Markdown)
         e. arxiv2md (legacy Markdown)
         f. PDF fallback only
       - Canonical identity: papers merged by identity, source tracked in PAPER_SOURCE_INDEX.json
       - Graph presence hard gate: blocks novelty-sensitive work if graph presence not ready

       Literature Skills:

       - research-lit: continuous literature maintenance and brainstorm scaffold
       - literature-review: structured inclusion/exclusion, SoTA matrix, baseline coverage, gap synthesis
       - graph-build: PaperNexus Python wrappers for automatic catch-up
       - frontier-mapping: graph-grounded frontier report generation
       - zotero-project-library: local Zotero integration via MCP server
       - novelty-check: graph-based novelty and adjacent work verification

       Graph Reasoning:

       - papernexus-agentic-reasoning: trace, synthesis, brainstorm via graph
       - papernexus-batch-import: stable multi-paper import with queuing
       - papernexus-research-chains: typed multi-hop chains with evidence bundles
       - graph refresh cycle: automatic reconciliation with shared global graph

       ---
       6. EXPERIMENT DESIGN & EXECUTION

       Experiment Planning:

       - plan-research: research plan, risk register, resource allocation, TODO organization
       - proposal decomposition: breaks down research proposal into testable components
       - CLAIM_TO_EXPERIMENT_MAP.md: links claims directly to experiment design

       Experiment Implementation:

       - implement-experiment: baseline + proposed code, respects decomposition
       - run-experiment: launch, parameter management, screen/server/path management
       - scientific-visualization: Coder-side baseline/proposed sanity-check plots
       - github-download: external code/asset retrieval

       Experiment Tracking:

       - coder/EXPERIMENT_INDEX.md - unified experiment catalog
       - coder/experiments/<track-id>/<exp-id>__<slug>/EXPERIMENT_MANIFEST.json - self-describing bundles
       - REMOTE_RUN.json - remote launch records
       - Flat experiment dumping forbidden; structured organization required

       ---
       7. EVALUATION & ANALYSIS

       Analysis Workflow:

       1. analyze-results: metrics/figures/claim-evidence structuring
       2. Materialize: converts raw results into durable paper_story_state
       3. Scientific figures: visualization asset organization
       4. PaperNexus reflection: graph-grounded result interpretation

       Claim Grading:

       - evidence-grading: support strength scoring (SUPPORTED/PARTIAL/UNSUPPORTED)
       - claim matrix: systematic claim vs. evidence mapping
       - unsupported-claim audit: blocks weak claims from publication
       - Reverse outline: validates paragraph-to-claim mapping

       ---
       8. CONFIGURATION & DOCUMENTATION

       Configuration Files:

       - openclaw.plugin.json: main plugin manifest
       - openclaw.RECOMMENDED.json: recommended plugin config template
       - CONFIG.md: path variables and configuration cheat sheet
       - WORKFLOW.md: master control document, stage definitions, gate rules
       - WORKSPACE.md: directory structure and ownership rules
       - AGENTS.md (per agent): role definitions, workflow, communication rules

       Documentation Structure:

       - DOC/README.md: Entry point with navigation by task
       - DOC/overview.md (English) + overview_zh.md (Chinese)
       - DOC/beginner_zh.md: Quick start guide
       - DOC/concepts/: Architecture, workflow control, PaperNexus integration
       - DOC/reference/: Skills, agents, plugin tools, state files, slash commands
       - DOC/guides/: Installation, configuration, operations, testing
       - web/workflow-handbook.html: Interactive bilingual workflow handbook

       Key Reference Docs:

       - reference/skills.md - Complete skill inventory (38+ skills)
       - reference/agents.md - Agent roles and permissions matrix
       - reference/plugin-tools.md - research_memory and research_workflow APIs
       - reference/state-files.md - All project state file schemas
       - reference/slash-commands.md - Command registry

       ---
       9. EXTERNAL SERVICES & API INTEGRATIONS

       Integrated Services:

       - papers-cool: Paper search and download (guaranteed baseline)
       - pasa-paper-search: Secondary paper search source
       - hugging-face-paper-pages: Markdown paper content
       - arxiv2md-api: Direct arXiv to Markdown conversion
       - crawl4ai: General web search and supplementary information retrieval
       - Zotero: Bibliography management (optional local MCP server)
       - PaperNexus Web/API: Remote endpoint option for graph access
       - MinerU: Optional remote PDF materialization
       - DBLP/CrossRef/DataCite/Semantic Scholar/arXiv: Citation verification

       Model Providers:

       - Anthropic Claude (primary)
       - OpenAI
       - Google Gemini
       - MiniMax
       - NVIDIA
       - Multi-provider CLI routing

       ---
       10. AGENT ROLES & MULTI-AGENT SYSTEM

       Seven Core Agents:

       ┌─────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┐
       │      Agent      │                                        Responsibilities                                         │
       ├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
       │ researcher      │ Literature, graph, ideation, experiment coordination, state stewardship, IDEA-CATALYST pipeline │
       ├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
       │ orchestrator    │ Research planning, experiment scheduling, risk/budget management                                │
       ├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
       │ coder           │ Implementation, code generation, baseline/proposed experiments, reproducibility                 │
       ├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
       │ analyzer        │ Results interpretation, figures, claim-evidence mapping, PaperNexus reflection                  │
       ├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
       │ academic_writer │ Paper planning, template mapping, section drafting, compilation, Zotero integration             │
       ├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
       │ reviewer        │ Self-review, novelty attacks, unsupported claim audits, evidence grading                        │
       ├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
       │ cross-reviewer  │ External perspective review (no project write permissions)                                      │
       └─────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────┘

       Communication System:

       - Mailbox-based handoff: durable per-project message queue
       - Mention sanitization: raw Discord @mentions cleaned in normal messages
       - Completion handoff template: standardized stage completion protocol
       - Agent-to-agent dispatch: active wake-up of next owner
       - Cooldown prevention: avoids repeated spam to same target
       - One-mention rule: at most one raw @agent per handoff

       Permission Matrix:

       - researcher: can contact/spawn all, writes to manifest, registry, memory, graph
       - orchestrator: contacts researcher, writes to orchestrator/
       - coder: contacts researcher, reads from orchestrator/researcher
       - analyzer: contacts researcher, writes analysis results
       - academic_writer: contacts researcher/cross-reviewer, writes paper/
       - reviewer: contacts researcher, writes review/
       - cross-reviewer: no contacts, no project write permissions

       ---
       11. AUTO MODE & AUTONOMOUS OPERATION

       Two Automation Levels:

       - conservative: keeps workflow moving, better for initial deployment
       - aggressive: more active stage continuation, remediation, gate handling

       Risk Management:

       - Detect risk → Multi-agent discussion → Bounded remediation → Graceful downgrade
       - Discussions visible in /workflow-status
       - Automatic action item and blocker aggregation
       - Risk reasons and mitigation rounds tracked in manifest

       Auto Iterator:

       - auto_iterator_tick - deterministic scheduler with heartbeat mode
       - Handles: stage checking, missing signal identification, owner routing, mailbox handoff, state sync
       - Automatic graph presence checks before novelty-sensitive stages
       - Idle research background tasks with configurable topic/cooldown

       /workflow-status Command:

       Shows real-time visibility into:
       - Configured vs. effective auto mode
       - Risk analysis and mitigation history
       - Auto discussion state with per-agent summaries
       - Action items, blockers, and response excerpts
       - Gate review state

       ---
       12. IDEA GENERATION & BRAINSTORMING

       IDEA-CATALYST Pipeline:

       A five-stage cross-domain ideation system:
       1. idea-catalyst-decompose: Break target-domain problem into durable decomposition
       2. idea-catalyst-translate: Domain-agnostic mechanism abstraction
       3. idea-catalyst-scout: Graph-first cross-domain scouting with domain-distance filtering
       4. idea-catalyst-gatekeeper: Sufficiency gate deciding continuation vs. investigation requisition
       5. idea-catalyst-integrator: Synthesis of target challenge + source-domain takeaways

       Data Starvation Handling: If local KG insufficient, outputs investigation requisition specifying exact domain/topic/keywords needed rather than hallucinating ideas.

       General Ideation Skills:

       - research-ideation: Graph-first method, novelty tree, challenge-insight tree, well-established check, cross-domain transfer
       - idea-generator: Candidate idea divergence
       - idea-tournament: Tree expansion, propose→review→refine, Elo-style ranking, top-3 summary
       - scientific-brainstorming: Graph-grounded divergence with hypothesis inversion
       - research-reflect: Process-level reflection and synthesis

       Brainstorm Artifacts:

       - RESEARCH_BRAINSTORM.md (during research-lit): mechanism hypotheses, part decomposition, contradictions
       - INNOVATION_REFLECTION.md: experiment-grounded reflection with "do-not-repeat" constraints
       - novelty tree: structured novelty assessment
       - challenge-insight tree: problem decomposition
       - tournament scoreboard: competitive idea ranking

       ---
       13. SKILL INVENTORY (39+ Skills)

       Researcher Skills (27):

       research-pipeline, graph-build, frontier-mapping, idea-phase, research-ideation, idea-catalyst-, idea-generator, idea-tournament, novelty-check, experiment-phase, monitor-experiment, parallel-experiments,
       resume-pipeline, research-reflect, innovation-reflection, research-lit, literature-review, zotero-project-library, scientific-brainstorming, idle-research, papers-cool, pasa-paper-search,
       hugging-face-paper-pages, arxiv2md-api, markxiv, arxiv2md, papernexus, crawl4ai-search, research-queue

       Orchestrator Skills (2):

       plan-research, resume-pipeline

       Coder Skills (5):

       implement-experiment, scientific-visualization, run-experiment, github-download, resume-pipeline

       Analyzer Skills (5):

       analyze-results, scientific-figures, papernexus-reflection, theory-phase, resume-pipeline

       Writer Skills (12):

       paper-plan, paper-write, paper-compile, paper-phase, citation-management, citation-preflight, venue-templates, ai-research-prompt, research-paper-writing, kg-storyline-contract, resume-pipeline

       Reviewer Skills (16):

       review-phase, paper-review, idea-catalyst-judge, scientific-critical-thinking, scholar-evaluation, peer-review, evidence-grading, citation-integrity-gate, review-response, paperreview-submit,
       resume-pipeline

       Cross-Reviewer Skills (1):

       resume-pipeline

       ---
       14. OBVIOUS GAPS & LIMITATIONS

       Status note (2026-04-05):
       - Several items below were accurate when first written but are now partially or fully addressed.
       - Experiment-stage items remain delegated to the experiment subsystem and are not treated as workflow-writing regressions.
       - PaperNexus-side graph intelligence items remain open unless that repository provides the underlying capability.

       Architecture Gaps:

       1. No experiment cost tracking: Budget constraints exist in state but no automatic spend monitoring/alerts
       2. Limited failure analysis: EXPERIMENT_LEDGER tracks failures but doesn't analyze failure patterns systematically
       3. No multi-project dependency: Partially fixed. The workflow now materializes portfolio-level cycle memory across sibling projects, but there is still no true multi-project scheduler or shared inter-project dependency graph
       4. Weak ablation framework: Can plan ablations but no systematic ablation orchestration

       Capability Gaps:

       1. No real-time collaboration: Still open. Durable mailbox / workflow-status coordination exists, but there is no shared live editing layer
       2. Limited dataset management: Coder can read but not modify shared datasets; no versioning
       3. No meta-learning: Partially fixed. Cross-cycle memory and portfolio memory now accumulate recurring idea, evidence, and rebuttal patterns, but skills still do not self-rewrite
       4. Paper routing: Fixed at the workflow-support layer. The system now materializes `academic_writer/VENUE_ROUTING_PLAN.md` and uses it during planning/writing, though it still does not talk to external venue APIs
       5. Missing figure regeneration: No automatic replot on data changes
       6. Limited reproducibility validation: No automatic reproduce-on-commit workflows

       Operational Gaps:

       1. Paper submission integration: Intentionally still open. The workflow stops at the human GATE-5 decision and does not auto-submit to venues
       2. Reviewer response generation: Fixed at the workflow layer. The system can now auto-materialize a rebuttal draft from `external_review_state`, then let `review-response` refine it
       3. Dataset benchmark registration: No integration with major benchmarks (ImageNet, GLUE, etc.)
       4. Hardware-aware scheduling: No GPU/CPU resource estimation for experiment plans
       5. Cloud integration: Designed for local/Discord; limited cloud experiment support

       Knowledge Graph Gaps:

       1. No semantic querying: Still open on the PaperNexus side
       2. Limited cross-paper linking: Still primarily a PaperNexus-side concern
       3. No trend detection: Still primarily a PaperNexus-side concern
       4. Graph versioning: Still primarily a PaperNexus-side concern

       ML-Specific Gaps:

       1. No hyperparameter search: Experiments are manual; no automatic grid/Bayesian search
       2. No cross-validation: Single train/test split assumption
       3. No feature importance analysis: Can analyze results but not systematically rank feature importance
       4. Limited statistical testing: Evidence grading is qualitative, not statistical

       ---
       15. TECH STACK SUMMARY

       Frontend/CLI:

       - TypeScript (main plugin, 100+ .ts files)
       - Node.js 18+
       - OpenClaw framework (TypeScript-based agent orchestration)

       Backend:

       - Python 3.11-3.13 (EvoScientist, PaperNexus)
       - FastAPI (API services)
       - SQLite/KuzuDB (PaperNexus knowledge graph)

       External Tools:

       - Docling/Marker (PDF parsing)
       - LLM APIs (Anthropic, OpenAI, etc.)
       - Zotero (Bibliography management)
       - Discord (Agent communication)
       - MCP (Model Context Protocol) for tool extensions

       Build/Deployment:

       - npm/pnpm (TypeScript/Node package management)
       - Docker (containerization)
       - bash scripts (installation and configuration)

       ---
       16. PROJECT DIRECTORY STRUCTURE

       /Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/

       ├── openclaw/                          # Core OpenClaw framework
       │   ├── apps/                          # Applications (CLI, SDK, etc.)
       │   ├── dist/                          # Compiled distribution
       │   └── [91 directories + docs]

       ├── openclaw-research/                 # Main automated research plugin
       │   ├── agents/                        # 7 agent role directories
       │   ├── skills/                        # 38+ skills by role
       │   ├── tools/                         # 100+ .ts files for workflow control
       │   │   ├── workflow-guard*/           # Core workflow enforcement
       │   │   ├── idea-catalyst/             # IDEA-CATALYST implementation
       │   │   ├── literature-discovery/      # Paper search integration
       │   │   ├── papernexus-packets/        # Knowledge graph integration
       │   │   ├── research-writing/          # Writing contract system
       │   │   └── workflow-commands/         # CLI commands
       │   ├── DOC/                           # Comprehensive documentation
       │   ├── WORKFLOW.md                    # Master control document
       │   ├── WORKSPACE.md                   # Directory ownership rules
       │   ├── CONFIG.md                      # Path and config reference
       │   ├── templates/                     # Project templates
       │   └── lobster/                       # Optional deterministic handoff

       ├── PaperNexus/                        # Knowledge graph + lit management
       │   ├── src/                           # TypeScript source
       │   ├── SKILL/                         # Skills for Claude Code
       │   ├── docs/                          # Architecture, CLI, configuration
       │   ├── examples/                      # Sample papers
       │   └── web/                           # Browser UI

       ├── EvoScientist/                      # Python evolutionary researcher
       │   ├── EvoScientist/                  # Main Python package
       │   │   ├── channels/                  # Discord, Telegram, CLI
       │   │   ├── cli/                       # TUI interface
       │   │   ├── commands/                  # Skills/research commands
       │   │   ├── tools/                     # External tool integrations
       │   │   └── skills/                    # Persistent memory skills
       │   ├── tests/                         # Comprehensive test suite
       │   └── README.md                      # Feature overview

       ├── EvoSkills/                         # Installable skill library
       │   └── skills/                        # research-ideation, idea-tournament, paper-planning, etc.

       ├── ClawAutoResearch/                  # Alternative research automation
       │   ├── DOC/                           # Documentation hub
       │   ├── SKILL/                         # Integrated skills
       │   ├── src/                           # TypeScript implementation
       │   └── test/                          # Test suite

       ├── SciCanvas/                         # Research visualization
       │   ├── src/                           # Frontend/backend sources
       │   ├── server/                        # API server
       │   ├── TIKZ/                          # LaTeX/TikZ generation
       │   └── frontend/                      # Web UI

       ├── any-auto-register/                 # Configuration registry system
       │   ├── modules/                       # Pluggable modules
       │   ├── examples/                      # Configuration examples
       │   └── skills/                        # Associated skills

       └── Vibe-Research-Slide/               # Presentation generation

       ---
       CONCLUSION

       This is a production-grade multi-agent research automation system with:
       - Deterministic workflow control preventing agent chaos
       - Durable project state enabling session recovery and Discord routing
       - Knowledge graph grounding via PaperNexus for informed ideation
       - Structured experiment tracking with ledger-based memory
       - Proof-aware writing with template enforcement and citation verification
       - Autonomous operation with risk discussion and bounded remediation
       - Comprehensive skill library covering ideation → writing → submission

       Key Innovation: The system doesn't just coordinate agents; it enforces contracts (writing templates, claim policies, gate preconditions) and makes state changes durable and auditable, enabling safe
       long-running research projects that survive restarts and agent switches.
  ⎿  Done (44 tool uses · 79.2k tokens · 13m 48s)
