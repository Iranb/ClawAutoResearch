# Lobster Quickstart

This integration uses Lobster as a deterministic handoff wrapper around the
existing `openclaw-research` workflow. The research logic still lives in the
current agents and skills; Lobster only forces the stage-closeout sequence:

1. run `research_workflow.auto_iterator_tick`
2. determine the next stage owner
3. dispatch work to the next agent when ownership changed
4. keep stage broadcast on the project channel

## What This Solves

Use this when the current owner finishes a stage but the next agent does not
reliably continue work.

The Lobster workflow does **not** replace:

- `research-pipeline`
- `plan-phase`
- `implement-experiment`
- `analyze-results`
- `paper-phase`

It only makes the **handoff** deterministic.

## Files

- Workflow: `lobster/workflows/research-stage-handoff.lobster`
- Auto-dispatch workflow: `lobster/workflows/workflow-agent-dispatch.lobster`
- Handoff runner: `lobster/scripts/research-stage-handoff.mjs`
- Auto-dispatch runner: `lobster/scripts/workflow-task-dispatch.mjs`
- Tool bridge: `lobster/scripts/openclaw-tool.mjs`

## Prerequisites

1. Install the Lobster CLI on the same host as the OpenClaw Gateway.
2. Ensure `lobster` is on `PATH`.
3. Ensure the OpenClaw Gateway is running.
4. Ensure the current agent session is allowed to use:
   - `lobster`
   - `research_workflow`

Recommended OpenClaw config snippet:

```json
{
  "tools": {
    "alsoAllow": ["lobster"]
  },
  "agents": {
    "list": [
      {
        "id": "researcher",
        "tools": {
          "alsoAllow": ["lobster", "research_workflow"]
        }
      },
      {
        "id": "orchestrator",
        "tools": {
          "alsoAllow": ["lobster", "research_workflow"]
        }
      },
      {
        "id": "reviewer",
        "tools": {
          "alsoAllow": ["lobster", "research_workflow"]
        }
      }
    ]
  }
}
```

## Environment

Export these on the gateway host:

```bash
export OPENCLAW_RESEARCH_PLUGIN_ROOT="$HOME/.openclaw/plugins/openclaw-research"
export OPENCLAW_GATEWAY_HTTP_URL="http://127.0.0.1:18789"
export OPENCLAW_GATEWAY_TOKEN="<your-gateway-token>"
```

If your gateway auth mode is `none`, omit `OPENCLAW_GATEWAY_TOKEN`.

## Fastest Way To Try It

Run it from a terminal on the gateway host after a stage owner finishes work:

```bash
export OPENCLAW_SESSION_KEY="agent:researcher:discord:group:<channel-peer>"
export OPENCLAW_MESSAGE_CHANNEL="discord"

lobster run --mode tool \
  "$OPENCLAW_RESEARCH_PLUGIN_ROOT/lobster/workflows/research-stage-handoff.lobster"
```

What happens:

- the workflow ticks the current project state
- if the owner changed, it dispatches the next owner via `research_workflow.dispatch_task`
- the existing stage broadcast logic still posts the update back to the project channel

## Running It From OpenClaw

If you already enabled the `lobster` tool, you can run the workflow through a
tool call. The workflow file expects the current session key and message channel
in `argsJson`.

```json
{
  "action": "run",
  "pipeline": "/Users/iranb/.openclaw/plugins/openclaw-research/lobster/workflows/research-stage-handoff.lobster",
  "argsJson": "{\"sessionKey\":\"agent:researcher:discord:group:<channel-peer>\",\"messageChannel\":\"discord\"}",
  "timeoutMs": 30000
}
```

## Recommended Operational Pattern

## Optional Auto Mode Backend

`openclaw-research` can now use Lobster as an optional handoff backend during
Auto mode. In this setup, the plugin still computes workflow state locally, but
it routes inter-agent dispatch through the Lobster tool so automatic owner
handoffs can be made deterministic without replacing the existing workflow
kernel.

Recommended plugin config:

```json
{
  "plugins": {
    "entries": {
      "openclaw-research": {
        "config": {
          "autoMode": "conservative",
          "lobsterHandoff": {
            "enabled": true,
            "autoModeOnly": true,
            "gatewayUrl": "http://127.0.0.1:18789",
            "timeoutMs": 30000,
            "maxStdoutBytes": 512000,
            "fallbackToNative": true
          }
        }
      }
    }
  },
  "tools": {
    "alsoAllow": ["lobster"]
  }
}
```

Behavior:

- when Auto mode is active, the plugin tries the Lobster workflow first for
  agent-to-agent handoff
- if Lobster is unavailable, denied, or misconfigured, the plugin falls back to
  the built-in native dispatch path
- stage state, gates, mailbox logic, and broadcasts still come from
  `openclaw-research`; Lobster only owns the dispatch hop

## Recommended Operational Pattern

Use the Lobster handoff workflow at the end of any owner-complete stage, for
example:

- Researcher finishes `graph_build`, `frontier_mapping`, or `idea`
- Orchestrator finishes `plan`
- Coder finishes `code`
- Analyzer finishes `analyze`
- Reviewer finishes `review`
- Writer finishes `write`

Do **not** use forward handoff when the current decision is to revise in place or roll back, for example:

- Writer receives another revision pass
- Coder still owes bounded implementation fixes
- Reviewer asks for more experiments
- Researcher decides to re-open ideation or experiment loops

In practice, the current owner should:

1. write the durable artifact for the stage
2. call the Lobster handoff workflow
3. let Lobster tick state and dispatch the next owner

## Notes

- This workflow is intentionally **owner-handoff only**.
- It does not mutate research content directly.
- It reuses the existing `auto_iterator_tick`, `dispatch_task`, and stage
  broadcast logic already present in `openclaw-research`.
- If you want approvals before dispatching the next owner, add a second
  Lobster workflow variant with `approval: required`.
