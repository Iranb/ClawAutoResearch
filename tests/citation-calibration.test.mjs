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

async function writeFakeResearch30Script(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `#!/usr/bin/env python3
import json
import os
from types import SimpleNamespace

RESPONSES = {}
payload_path = os.environ.get("OPENCLAW_RESEARCH30_FAKE_RESPONSES")
if payload_path:
    with open(payload_path, "r", encoding="utf-8") as handle:
        RESPONSES = json.load(handle)

class OpenAlexItem(dict):
    pass

class Report:
    def __init__(self, topic, from_date, to_date, mode):
        self.topic = topic
        self.range_from = from_date
        self.range_to = to_date
        self.generated_at = "2026-04-12T00:00:00Z"
        self.mode = mode
        self.openalex = []
        self.semanticscholar = []
        self.pubmed = []
        self.biorxiv = []
        self.medrxiv = []
        self.arxiv = []
        self.huggingface = []
        self.openalex_error = None
        self.semanticscholar_error = None
        self.pubmed_error = None
        self.biorxiv_error = None
        self.medrxiv_error = None
        self.arxiv_error = None
        self.huggingface_error = None

    def to_dict(self):
        return {
            "topic": self.topic,
            "range": {"from": self.range_from, "to": self.range_to},
            "generated_at": self.generated_at,
            "mode": self.mode,
            "openalex": [dict(item) for item in self.openalex],
            "semanticscholar": [dict(item) for item in self.semanticscholar],
            "pubmed": [dict(item) for item in self.pubmed],
            "biorxiv": [dict(item) for item in self.biorxiv],
            "medrxiv": [dict(item) for item in self.medrxiv],
            "arxiv": [dict(item) for item in self.arxiv],
            "huggingface": [dict(item) for item in self.huggingface],
        }

def create_report(topic, from_date, to_date, mode):
    return Report(topic, from_date, to_date, mode)

class Normalize:
    @staticmethod
    def normalize_openalex_items(items, *_args):
        return [OpenAlexItem(item) for item in items]

    @staticmethod
    def normalize_semanticscholar_items(items, *_args):
        return []

    @staticmethod
    def normalize_biorxiv_items(items, *_args):
        return []

    @staticmethod
    def normalize_arxiv_items(items, *_args):
        return []

    @staticmethod
    def normalize_pubmed_items(items, *_args):
        return []

    @staticmethod
    def normalize_huggingface_items(items, *_args):
        return []

    @staticmethod
    def filter_by_date_range(items, *_args):
        return items

class Score:
    @staticmethod
    def score_openalex_items(items):
        return items

    @staticmethod
    def score_semanticscholar_items(items):
        return items

    @staticmethod
    def score_biorxiv_items(items):
        return items

    @staticmethod
    def score_arxiv_items(items):
        return items

    @staticmethod
    def score_pubmed_items(items):
        return items

    @staticmethod
    def score_huggingface_items(items):
        return items

    @staticmethod
    def sort_items(items):
        return sorted(items, key=lambda item: -int(item.get("score", 0)))

class Dedupe:
    @staticmethod
    def dedupe_within_source(items):
        return items

    @staticmethod
    def dedupe_cross_source(items):
        return items

dates = SimpleNamespace(get_date_range=lambda days: ("2016-01-01", "2026-04-12"))
env = SimpleNamespace(get_config=lambda: {})
normalize = Normalize()
score = Score()
dedupe = Dedupe()
schema = SimpleNamespace(create_report=create_report)

def determine_sources(requested):
    return {requested}

def run_research(topic, sources_set, config, from_date, to_date, depth="default", mock=False, progress=None):
    return {
        "openalex": (RESPONSES.get(topic, []), None),
        "semanticscholar": ([], None),
        "pubmed": ([], None),
        "biorxiv": ([], None),
        "medrxiv": ([], None),
        "arxiv": ([], None),
        "huggingface": ([], None),
    }
`,
    "utf8"
  );
}

test("citation calibration uses reffix and research30 validation when available", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-citation-calibrate-"));
  const binDir = path.join(root, "bin");
  const fakeResearch30 = path.join(root, "research30", "scripts", "research30.py");
  const fakeResponses = path.join(root, "research30-responses.json");
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
  await writeFakeResearch30Script(fakeResearch30);
  await fs.writeFile(
    fakeResponses,
    JSON.stringify(
      {
        "Demo Paper doe": [
          {
            title: "Demo Paper",
            authors: "Doe, Jane and Smith, John",
            abstract: "Demo abstract",
            doi: "10.1000/demo2024",
            url: "https://openalex.org/W123",
            source_name: "CVPR",
            date: "2024-06-18",
            score: 97,
            why_relevant: "Exact title match",
          },
        ],
      },
      null,
      2
    ),
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
        OPENCLAW_RESEARCH30_SCRIPT: fakeResearch30,
        OPENCLAW_RESEARCH30_FAKE_RESPONSES: fakeResponses,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    }
  );

  const report = JSON.parse(stdout);
  assert.equal(report.summary.suspicious, 0);
  assert.equal(report.summary.hallucinated, 0);
  const calibrated = await fs.readFile(outPath, "utf8");
  assert.match(calibrated, /Doe, Jane/);
  assert.match(calibrated, /10\.1000\/demo2024/);
  assert.match(calibrated, /openalex\.org\/W123/);
  const markdown = await fs.readFile(mdPath, "utf8");
  assert.match(markdown, /Citation Calibration Report/);
  assert.match(markdown, /research30_bridge\.py/);
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
  const fakeResearch30 = path.join(root, "research30", "scripts", "research30.py");
  const fakeResponses = path.join(root, "research30-responses.json");
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
  await writeFakeResearch30Script(fakeResearch30);
  await fs.writeFile(
    fakeResponses,
    JSON.stringify(
      {
        "Demo Paper doe": [
          {
            title: "Demo Paper",
            authors: "Doe, Jane and Smith, John",
            abstract: "Demo abstract",
            doi: "10.1000/demo2024",
            url: "https://openalex.org/W123",
            source_name: "CVPR",
            date: "2024-06-18",
            score: 97,
            why_relevant: "Exact title match",
          },
        ],
      },
      null,
      2
    ),
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
        OPENCLAW_RESEARCH30_SCRIPT: fakeResearch30,
        OPENCLAW_RESEARCH30_FAKE_RESPONSES: fakeResponses,
        PATH: "/usr/bin:/bin",
      },
    }
  );

  const report = JSON.parse(stdout);
  assert.equal(report.summary.suspicious, 0);
  assert.equal(report.summary.hallucinated, 0);
  const toolRuns = report.tool_runs
    .map((run) => (Array.isArray(run.command) ? run.command.join(" ") : ""))
    .filter(Boolean);
  assert.ok(toolRuns.some((command) => command.includes("/Library/Python/3.9/bin/reffix")));
  assert.ok(toolRuns.some((command) => command.includes("research30_bridge.py")));
});

test("citation calibration times out stalled research30 validation instead of hanging forever", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-citation-calibrate-"));
  const binDir = path.join(root, "bin");
  const fakeResearch30 = path.join(root, "research30", "scripts", "research30.py");
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
  await fs.mkdir(path.dirname(fakeResearch30), { recursive: true });
  await fs.writeFile(
    fakeResearch30,
    `#!/usr/bin/env python3
import time
from types import SimpleNamespace

class Report:
    def __init__(self, topic, from_date, to_date, mode):
        self.topic = topic
        self.range_from = from_date
        self.range_to = to_date
        self.generated_at = "2026-04-12T00:00:00Z"
        self.mode = mode
        self.openalex = []
        self.semanticscholar = []
        self.pubmed = []
        self.biorxiv = []
        self.medrxiv = []
        self.arxiv = []
        self.huggingface = []

    def to_dict(self):
        return {
            "topic": self.topic,
            "range": {"from": self.range_from, "to": self.range_to},
            "generated_at": self.generated_at,
            "mode": self.mode,
            "openalex": [],
            "semanticscholar": [],
            "pubmed": [],
            "biorxiv": [],
            "medrxiv": [],
            "arxiv": [],
            "huggingface": [],
        }

def create_report(topic, from_date, to_date, mode):
    return Report(topic, from_date, to_date, mode)

class Normalize:
    @staticmethod
    def normalize_openalex_items(items, *_args):
        return []
    normalize_semanticscholar_items = normalize_openalex_items
    normalize_biorxiv_items = normalize_openalex_items
    normalize_arxiv_items = normalize_openalex_items
    normalize_pubmed_items = normalize_openalex_items
    normalize_huggingface_items = normalize_openalex_items
    @staticmethod
    def filter_by_date_range(items, *_args):
        return items

class Score:
    @staticmethod
    def score_openalex_items(items):
        return items
    score_semanticscholar_items = score_openalex_items
    score_biorxiv_items = score_openalex_items
    score_arxiv_items = score_openalex_items
    score_pubmed_items = score_openalex_items
    score_huggingface_items = score_openalex_items
    @staticmethod
    def sort_items(items):
        return items

class Dedupe:
    @staticmethod
    def dedupe_within_source(items):
        return items
    @staticmethod
    def dedupe_cross_source(items):
        return items

dates = SimpleNamespace(get_date_range=lambda days: ("2016-01-01", "2026-04-12"))
env = SimpleNamespace(get_config=lambda: {})
normalize = Normalize()
score = Score()
dedupe = Dedupe()
schema = SimpleNamespace(create_report=create_report)

def determine_sources(requested):
    return {requested}

def run_research(topic, sources_set, config, from_date, to_date, depth="default", mock=False, progress=None):
    time.sleep(2)
    return {"openalex": ([], None), "semanticscholar": ([], None), "pubmed": ([], None), "biorxiv": ([], None), "medrxiv": ([], None), "arxiv": ([], None), "huggingface": ([], None)}
`,
    "utf8"
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
        OPENCLAW_RESEARCH30_SCRIPT: fakeResearch30,
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
