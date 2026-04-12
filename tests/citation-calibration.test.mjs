import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function writeExecutable(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

test("citation calibration uses reffix and update_from_dblp when available", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-citation-calibrate-"));
  const binDir = path.join(root, "bin");
  const bibPath = path.join(root, "refs.bib");
  const outPath = path.join(root, "refs.calibrated.bib");
  const jsonPath = path.join(root, "report.json");
  const mdPath = path.join(root, "report.md");

  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.writeFile(
    bibPath,
    `@inproceedings{demo2024,\n  title={Demo Paper},\n  author={Unknown},\n  booktitle={CVPR},\n  year={2024}\n}\n`,
    "utf8"
  );
  await writeExecutable(
    path.join(binDir, "reffix"),
    `#!/bin/sh
in="$1"
shift
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
  else
    shift
  fi
done
cat "$in" | sed 's/author={[Uu]nknown}/author={Doe, Jane and Smith, John}/' > "$out"
`
  );
  await writeExecutable(
    path.join(binDir, "update_from_dblp"),
    `#!/bin/sh
in="$1"
shift
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--out" ]; then
    out="$2"
    shift 2
  else
    shift
  fi
done
cat "$in" > "$out"
printf '\\n  biburl={https://dblp.org/rec/conf/cvpr/demo2024.bib},\\n' >> "$out"
`
  );

  const { stdout } = await execFileAsync(
    "python3",
    [
      "scripts/citation_calibrate.py",
      "--bib",
      bibPath,
      "--out",
      outPath,
      "--report-json",
      jsonPath,
      "--report-md",
      mdPath,
    ],
    {
      cwd: "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    }
  );

  const report = JSON.parse(stdout);
  assert.equal(report.summary.suspicious, 0);
  assert.equal(report.summary.hallucinated, 0);
  const calibrated = await fs.readFile(outPath, "utf8");
  assert.match(calibrated, /Doe, Jane/);
  assert.match(calibrated, /dblp\.org/);
  const markdown = await fs.readFile(mdPath, "utf8");
  assert.match(markdown, /Citation Calibration Report/);
});

test("citation calibration reports suspicious entries when tools are unavailable", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-citation-calibrate-"));
  const bibPath = path.join(root, "refs.bib");
  const outPath = path.join(root, "refs.calibrated.bib");
  const isolatedHome = path.join(root, "home");

  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.writeFile(
    bibPath,
    `@inproceedings{demo2024,\n  title={Demo Paper},\n  author={Unknown},\n  booktitle={CVPR},\n  year={2024}\n}\n`,
    "utf8"
  );

  await assert.rejects(
    () =>
      execFileAsync(
        "python3",
        [
          "scripts/citation_calibrate.py",
          "--bib",
          bibPath,
          "--out",
          outPath,
        ],
        {
          cwd: "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research",
          env: {
            ...process.env,
            HOME: isolatedHome,
            PATH: "/usr/bin:/bin",
          },
        }
      ),
    (error) => {
      assert.equal(error.code, 1);
      return true;
    }
  );
});

test("citation calibration discovers user-level Python bin tools outside PATH", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-citation-calibrate-"));
  const homeDir = path.join(root, "home");
  const userBinDir = path.join(homeDir, "Library", "Python", "3.9", "bin");
  const bibPath = path.join(root, "refs.bib");
  const outPath = path.join(root, "refs.calibrated.bib");
  const jsonPath = path.join(root, "report.json");

  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.writeFile(
    bibPath,
    `@inproceedings{demo2024,\n  title={Demo Paper},\n  author={Unknown},\n  booktitle={CVPR},\n  year={2024}\n}\n`,
    "utf8"
  );
  await writeExecutable(
    path.join(userBinDir, "reffix"),
    `#!/bin/sh
in="$1"
shift
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
  else
    shift
  fi
done
cat "$in" | sed 's/author={[Uu]nknown}/author={Doe, Jane and Smith, John}/' > "$out"
`
  );
  await writeExecutable(
    path.join(userBinDir, "update_from_dblp"),
    `#!/bin/sh
in="$1"
shift
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--out" ]; then
    out="$2"
    shift 2
  else
    shift
  fi
done
cat "$in" > "$out"
printf '\\n  biburl={https://dblp.org/rec/conf/cvpr/demo2024.bib},\\n' >> "$out"
`
  );

  const { stdout } = await execFileAsync(
    "python3",
    [
      "scripts/citation_calibrate.py",
      "--bib",
      bibPath,
      "--out",
      outPath,
      "--report-json",
      jsonPath,
    ],
    {
      cwd: "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research",
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: "/usr/bin:/bin",
      },
    }
  );

  const report = JSON.parse(stdout);
  assert.equal(report.summary.suspicious, 0);
  assert.equal(report.summary.hallucinated, 0);
  const toolRuns = report.tool_runs.map((run) => run.command[0]);
  assert.ok(toolRuns.some((command) => command.includes("/Library/Python/3.9/bin/reffix")));
  assert.ok(
    toolRuns.some((command) => command.includes("/Library/Python/3.9/bin/update_from_dblp"))
  );
});

test("citation calibration times out stalled external tools instead of hanging forever", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-citation-calibrate-"));
  const binDir = path.join(root, "bin");
  const bibPath = path.join(root, "refs.bib");
  const outPath = path.join(root, "refs.calibrated.bib");

  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.writeFile(
    bibPath,
    `@inproceedings{demo2024,\n  title={Demo Paper},\n  author={Doe, Jane and Smith, John},\n  booktitle={CVPR},\n  year={2024}\n}\n`,
    "utf8"
  );
  await writeExecutable(
    path.join(binDir, "reffix"),
    `#!/bin/sh
in="$1"
shift
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
  else
    shift
  fi
done
cat "$in" > "$out"
`
  );
  await writeExecutable(
    path.join(binDir, "update_from_dblp"),
    `#!/bin/sh
sleep 2
exit 0
`
  );

  const { stdout } = await execFileAsync(
    "python3",
    [
      "scripts/citation_calibrate.py",
      "--bib",
      bibPath,
      "--out",
      outPath,
      "--tool-timeout-seconds",
      "1",
    ],
    {
      cwd: "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    }
  );

  const report = JSON.parse(stdout);
  assert.equal(report.summary.suspicious, 0);
  assert.equal(report.summary.hallucinated, 0);
  assert.equal(report.summary.needs_review, 1);
  assert.equal(report.tool_runs[1].returncode, 124);
  assert.equal(report.tool_runs[1].timed_out, true);
});
