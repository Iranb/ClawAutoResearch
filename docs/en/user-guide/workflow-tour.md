# Workflow Tour

This page is for first-time users who want a visual explanation of how the system progresses.

It does not go deep into implementation details. Instead, it shows:

- what each major step is doing
- how experiment and survey projects move differently
- how the system turns a topic into a recoverable workflow

## 1. The overall picture

At a high level, the system turns a research topic into a staged workflow:

```mermaid
flowchart LR
    A["Topic / problem"] --> B["Project bootstrap"]
    B --> C["Knowledge preparation"]
    C --> D["Research progression"]
    D --> E["Evidence organization"]
    E --> F["Writing and closeout"]
```

## 2. The experiment project line

Experiment projects follow a “direction -> experiment -> writing” path:

```mermaid
flowchart TD
    A["Topic"] --> B["Create project"]
    B --> C["graph_build"]
    C --> D["frontier / idea"]
    D --> E["plan"]
    E --> F["code + experiment"]
    F --> G["analyze"]
    G --> H["write"]
    H --> I["submit"]
```

What the major steps mean:

- `Create project`
  Build the project skeleton and bind the session.
- `graph_build`
  Make sure the important papers exist in the shared graph.
- `frontier / idea`
  Compress frontier signals into possible research directions.
- `plan`
  Turn candidate directions into an execution program.
- `code + experiment`
  Implement and run the actual experiment work.
- `analyze`
  Convert results into claim-evidence form.
- `write`
  Turn that evidence into a draft.

## 3. The inner experiment loop

Experiments are not a one-shot step. They contain their own inner loop:

```mermaid
flowchart TD
    A["Run experiment"] --> B["Observe results / runtime"]
    B --> C{"Usable result?"}
    C -- "No" --> D["Diagnose the issue"]
    D --> E["Adjust implementation / config / search scope"]
    E --> A
    C -- "Yes" --> F["Move to analysis"]
```

This is why the system can appear to loop inside the experiment stage. It is often doing the right thing: narrowing the problem and trying again.

## 4. Storyline progression for writing

Writing does not begin from a blank page. It begins from an organized story surface:

```mermaid
flowchart TD
    A["Experiment / analysis results"] --> B["claim-evidence"]
    B --> C["storyline organization"]
    C --> D["writing constraints / section plan"]
    D --> E["draft"]
    E --> F["QC and closeout"]
```

The core point is:

- first identify what the paper wants to claim
- then identify what evidence supports those claims
- only then shape the manuscript

## 5. The survey project line

Survey projects use a separate workflow line:

```mermaid
flowchart TD
    A["Topic"] --> B["Create survey project"]
    B --> C["literature retrieval"]
    C --> D["screening / coverage"]
    D --> E["synthesis and gaps"]
    E --> F["survey writing"]
    F --> G["submit"]
```

The biggest difference from the experiment line is:

- it does not focus on idea / code / experiment
- it focuses on retrieval, screening, coverage, and synthesis
- its writing input is a survey packet rather than experiment results

## 6. What “blocked” usually means

When the system appears stuck, it is often waiting for a real prerequisite:

```mermaid
flowchart TD
    A["Current stage"] --> B{"Prerequisites satisfied?"}
    B -- "No" --> C["Stay in the current stage / report blocking reason"]
    B -- "Yes" --> D["Advance to the next stage"]
```

That means:

- missing graph readiness keeps the system in `graph_build`
- missing survey packet artifacts keep the system in `survey_review`
- missing evidence or story preparation can delay `write`

## 7. What to read next

If this page gives you the mental model, continue with:

1. [Installation](./installation.md)
2. [Usage](./usage.md)
3. [Slash Commands](./slash-commands.md)
