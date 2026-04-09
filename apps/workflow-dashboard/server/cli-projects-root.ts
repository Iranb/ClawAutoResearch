export function readCliProjectsRoot(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--projectsRoot") {
      const nextValue = argv[index + 1];

      if (nextValue === undefined) {
        throw new Error("--projectsRoot requires a path value.");
      }

      if (nextValue.startsWith("-")) {
        throw new Error(
          `--projectsRoot requires a path value, but received another flag: ${nextValue}`,
        );
      }

      return nextValue;
    }

    if (value.startsWith("--projectsRoot=")) {
      const explicitValue = value.slice("--projectsRoot=".length);

      if (!explicitValue) {
        throw new Error("--projectsRoot requires a path value.");
      }

      return explicitValue;
    }
  }

  return undefined;
}
