import http from "node:http";

import { resolveProjectsRoot } from "./config/projects-root.js";

function readCliProjectsRoot(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--projectsRoot") {
      return argv[index + 1];
    }

    if (value.startsWith("--projectsRoot=")) {
      return value.slice("--projectsRoot=".length);
    }
  }

  return undefined;
}

const projectsRoot = resolveProjectsRoot({
  cliProjectsRoot: readCliProjectsRoot(process.argv.slice(2)),
});

const port = Number(process.env.PORT ?? "4317");

const server = http.createServer((request, response) => {
  if (request.url === "/api/config") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ projectsRoot, readOnly: true }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, () => {
  console.log(`workflow-dashboard server listening on http://localhost:${port}`);
  console.log(`workflow-dashboard projectsRoot=${projectsRoot}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
