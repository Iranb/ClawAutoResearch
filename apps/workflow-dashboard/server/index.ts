import { createApp } from "./app.js";
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

const port = Number.parseInt(process.env.PORT ?? "4317", 10);
const app = createApp({ projectsRoot });
const server = app.listen(port, () => {
  console.log(
    `workflow-dashboard server listening on http://localhost:${port} projectsRoot=${projectsRoot}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
