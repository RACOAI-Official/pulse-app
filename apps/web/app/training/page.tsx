"use client";

import Link from "next/link";
import WorkspaceShell from "@/components/WorkspaceShell";

export default function TrainingPage() {
  return <WorkspaceShell>{() => <main className="commerce-page"><header className="commerce-heading"><div><span className="eyebrow">AI TRAINING / CONTENT</span><h1>Train Content</h1><p>Keep business facts current in your private draft before testing and publishing.</p></div><Link href="/agent" className="button primary">Open Agent Studio</Link></header><section className="commerce-card"><h2>Business knowledge</h2><p>Agent Studio provides editable policies, FAQs, business details, language, and addressing. Test replies privately before publishing a new version.</p><p className="settings-note">Importing Facebook or Instagram Page posts requires connected sandbox assets and explicit content permissions.</p></section></main>}</WorkspaceShell>;
}
