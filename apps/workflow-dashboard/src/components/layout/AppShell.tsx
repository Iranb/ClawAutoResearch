import type { ReactNode } from "react";

type AppShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function AppShell(props: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__hero">
        <p className="app-shell__eyebrow">{props.eyebrow}</p>
        <h1>{props.title}</h1>
        <p className="app-shell__description">{props.description}</p>
      </header>
      <main className="app-shell__content">{props.children}</main>
    </div>
  );
}
