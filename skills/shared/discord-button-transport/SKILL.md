---
name: discord-button-transport
description: "Shared protocol for AutoResearch agents that need to present Discord-native buttons, dropdown choices, or query-answer lists to users without bypassing OpenClaw command routing. Use when an agent wants the user to choose an option, click a workflow action, or test Discord components."
allowed-tools:
  - Read
  - Skill
  - research_workflow
  - message
---

# Discord Button Transport

Use this skill only for user-facing Discord controls. It does not grant raw Discord bot permissions; route actions through OpenClaw-native commands or `research_workflow`.

## Golden Path

1. For a user choice with multiple options, prefer `research_workflow.build_query_answer_list`.
2. For a persistent channel panel, use a Gateway/plugin command that returns `channelData.discord.components` as a Discord-serializable component array and registers the `occomp` callback entries as `reusable: true`.
3. For a button callback, use a short slash command such as `/workflow-status`, `/resume-pipeline`, `/graph-build`, `/handoff-status`, or `/show-commands`.
4. Do not use ad hoc CLI-sent Discord components for durable panels. If Discord says a component expired, regenerate the panel through a native command handled by Gateway.
5. Do not encode long prompts, raw JSON, secrets, tokens, or destructive actions directly in button callback data.
6. Treat every start/resume/build button as idempotent. If the same project already has a queued or running workflow action, return `/workflow-status`-style progress and next action instead of dispatching a duplicate run.

## Query Answer Lists

Use query-answer-list when the agent needs the user to select among papers, projects, tracks, hypotheses, repair strategies, or more than five choices.

Call:

```json
{
  "action": "build_query_answer_list",
  "queryAnswerList": {
    "question": "Which direction should AutoResearch pursue next?",
    "context": "Choose one option so the workflow can continue with explicit user preference.",
    "placeholder": "Pick a direction",
    "responsePrefix": "answer:",
    "options": [
      {
        "label": "Graph-grounded survey",
        "value": "survey",
        "description": "Prioritize literature structure and evidence maps."
      },
      {
        "label": "Experiment-first paper",
        "value": "experiment",
        "description": "Prioritize implementation and benchmark evidence."
      }
    ]
  }
}
```

After the tool returns, send `message.text` as the visible message and `message.presentation` as the OpenClaw presentation payload. Selections return the option `value` as inbound text.

## Button Panel Rules

Use buttons only for high-frequency actions that are safe to retry:

- `Status` -> `/workflow-status`
- `Resume` -> `/resume-pipeline`
- `Graph` -> `/graph-build`
- `Handoff` -> `/handoff-status`
- `Commands` -> `/show-commands`

Keep at most five buttons in one row. If the action needs a project id, paper id, track id, or confirmation, ask with query-answer-list first.
For start-like actions such as `Resume` and `Graph`, inspect workflow state first. If work is already `queued`, `running`, or waiting on a live owner/session, answer with the current stage, owner, blocker, and next expected action rather than starting another background run.

Use `/autoresearch-buttons-test` only for smoke testing. Its buttons must remain no-op test callbacks and must not advance workflow state.

## Persistent Components

When implementing or reviewing AutoResearch native slash command code, do not put a Discord component spec object under `channelData.discord.components`. The native interaction reply path expects `components` to be an array of serializable Discord components, for example a classic action row whose `serialize()` returns Discord API button payloads:

```ts
return {
  text,
  channelData: {
    discord: {
      components: [
        {
          isV2: false,
          serialize: () => ({
            type: 1,
            components: [
              { type: 2, style: 1, label: "Status", custom_id: "occomp:cid=panel_status" },
              { type: 2, style: 2, label: "Resume", custom_id: "occomp:cid=panel_resume" }
            ]
          })
        }
      ],
      reusable: true
    }
  }
};
```

The command that sends this panel must run inside OpenClaw Gateway and register matching component entries with callback data such as `/workflow-status` and `/resume-pipeline`. Use `presentation` for message-tool sends; use the serializable `channelData.discord.components` array for native slash command replies.

## Safety Boundaries

- Use `secondary` style for normal workflow actions, `primary` for the single most likely next step, and `danger` only for actions that already have a confirmation step.
- Never put destructive or state-reset actions behind a one-click button.
- If the channel is not bound to a project, use `/bind-project` instructions or a query-answer-list project chooser before sending project-specific buttons.
- If the user is unauthorized or a command is not available, report the exact command that failed and ask the channel owner to check native command permissions.
