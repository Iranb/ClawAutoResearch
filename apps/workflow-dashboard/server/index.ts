import { createApp } from "./app.js";
import { readCliProjectsRoot } from "./cli-projects-root.js";
import { resolveProjectsRoot } from "./config/projects-root.js";

const projectsRoot = resolveProjectsRoot({
  cliProjectsRoot: readCliProjectsRoot(process.argv.slice(2)),
});

const port = Number.parseInt(process.env.PORT ?? "4317", 10);
const app = createApp({ projectsRoot });
const server = app.listen(port, () => {
  console.log(`workflow-dashboard api listening on http://localhost:${port}`);
  console.log(`workflow-dashboard mode=read-only projectsRoot=${projectsRoot}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
