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

test("papernexus_remote_stage uploads local files over ssh and rewrites a remote manifest", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pn-stage-"));
  const binDir = path.join(root, "bin");
  const remoteRoot = path.join(root, "remote-root");
  const sourcePath = path.join(root, "2501.00031.pdf");
  const manifestPath = path.join(root, "batch-import.json");
  const rewrittenManifestPath = path.join(root, "batch-import.remote.json");
  const previousPath = process.env.PATH;

  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.writeFile(sourcePath, "%PDF-1.4\nfake\n", "utf8");
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        papers: [
          {
            paper_id: "arxiv:2501.00031",
            source_path: sourcePath,
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeExecutable(
    path.join(binDir, "ssh"),
    `#!/bin/sh
target="$1"
shift
cmd="$1"
root="$OPENCLAW_FAKE_REMOTE_ROOT"
clean="$(printf "%s" "$cmd" | tr -d "'\\"")"
case "$clean" in
  mkdir\\ -p\\ *)
    dir="\${clean#mkdir -p }"
    mkdir -p "$root$dir"
    exit 0
    ;;
  cat\\ \\>\\ *)
    file="\${clean#cat > }"
    mkdir -p "$(dirname "$root$file")"
    cat > "$root$file"
    exit 0
    ;;
esac
echo "unsupported ssh command: $cmd" >&2
exit 1
`
  );

  const { stdout } = await execFileAsync(
    "python3",
    [
      "scripts/papernexus_remote_stage.py",
      "--ssh-target",
      "fake@remote",
      "--remote-base-dir",
      "/srv/papernexus-stage",
      "--project-id",
      "demo-project",
      "--manifest",
      manifestPath,
      "--rewrite-manifest-out",
      rewrittenManifestPath,
    ],
    {
      cwd: "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research",
      env: {
        ...process.env,
        OPENCLAW_FAKE_REMOTE_ROOT: remoteRoot,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    }
  );

  const payload = JSON.parse(stdout);
  assert.equal(payload.uploads[0].status, "uploaded");
  const remotePath = payload.uploads[0].remote_path;
  assert.match(remotePath, /\/srv\/papernexus-stage\/demo-project\/pdf\/2501\.00031\.pdf$/);

  const remoteFile = await fs.readFile(path.join(remoteRoot, remotePath), "utf8");
  assert.match(remoteFile, /%PDF-1\.4/);

  const rewrittenManifest = JSON.parse(await fs.readFile(rewrittenManifestPath, "utf8"));
  assert.equal(
    rewrittenManifest.papers[0].server_file_path,
    "/srv/papernexus-stage/demo-project/pdf/2501.00031.pdf"
  );
});
