# Installation

This page is only about getting `ClawAutoResearch` installed and confirming that the environment is actually usable.

## 1. Prepare the repository

Run from the repository root:

```bash
npm install
bash install.sh
```

## 2. Preview the docs locally

If you want to confirm the docs site first:

```bash
npm run docs:dev
```

If you only want to validate that the docs build:

```bash
npm run docs:build
```

## 3. Before using it in OpenClaw / Discord

Make sure:

- the plugin is actually loaded
- the current session is workflow-enabled
- the current surface can access workflow tools

## 4. How to tell the install worked

At minimum:

- dependency installation completed without blocking errors
- docs or plugin-related commands can run
- later calls to `/auto-research` or `/auto-review` do not fail immediately because the plugin is missing

## 5. Next step

After installation, continue with [Usage](./usage.md).
