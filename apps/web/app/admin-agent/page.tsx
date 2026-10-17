"use client";

import { FormEvent, useEffect, useState } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api } from "@/lib/api";

type Proposal = { id: string; action: string; prompt: string; before_state: Record<string, unknown>; after_state: Record<string, unknown>; status: "pending" | "applied" | "rejected"; expires_at: string; created_at: string };

function AdminContent({ tenantId, role }: { tenantId: string; role: string }) {
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [history, setHistory] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { if (role !== "staff") api<Proposal[]>(`/tenants/${tenantId}/admin-agent`).then(setHistory).catch(caught => setNotice(caught.message)); }, [tenantId, role]);
  async function propose(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const next = await api<Proposal>(`/tenants/${tenantId}/admin-agent/propose`, { method: "POST", body: JSON.stringify({ prompt }) });
      setProposal(next);
      setPrompt("");
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Could not prepare action"); }
    finally { setBusy(false); }
  }
  async function decide(confirm: boolean) {
    if (!proposal) return;
    setBusy(true); setNotice("");
    try {
      const result = await api<Proposal>(`/tenants/${tenantId}/admin-agent/${proposal.id}/decide`, { method: "POST", body: JSON.stringify({ confirm }) });
      setNotice(result.status === "applied" ? "Change applied and audited." : "Proposal dismissed.");
      setHistory(current => [result, ...current]);
      setProposal(null);
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Could not complete proposal"); }
    finally { setBusy(false); }
  }
  return <main className="commerce-page"><header className="commerce-heading"><div><span className="eyebrow">AI TRAINING / BUSINESS OPERATIONS</span><h1>Admin Agent</h1><p>Describe a catalog or knowledge change. Every write requires a preview and your confirmation.</p></div></header>
    {role === "staff" ? <section className="commerce-card"><h2>Access required</h2><p>Owners and managers can use the write-capable Admin Agent. Staff can use the inbox.</p></section> : <>
      <section className="commerce-card"><h2>Ask Pulse to prepare a change</h2><p>Supported: adjust stock by SKU, set a SKU price, create a product draft, or add an FAQ. Product drafts need an image before activation.</p><form className="admin-prompt" onSubmit={propose}><textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={1000} placeholder="Add 5 units to SKU BLUE-SHIRT-M, because new stock arrived." aria-label="Admin request" /><button className="button primary" disabled={busy || !prompt.trim()}>{busy ? "Preparing…" : "Preview change"}</button></form></section>
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {proposal && <section className="commerce-card admin-proposal"><span className="eyebrow">REVIEW REQUIRED · EXPIRES {new Date(proposal.expires_at).toLocaleTimeString()}</span><h2>{proposal.action.replaceAll("_", " ")}</h2><p>{proposal.prompt}</p><div className="admin-diff"><div><h3>Before</h3><pre>{JSON.stringify(proposal.before_state, null, 2)}</pre></div><div><h3>Proposed</h3><pre>{JSON.stringify(proposal.after_state, null, 2)}</pre></div></div><div className="commerce-actions"><button className="button primary" disabled={busy} onClick={() => decide(true)}>Confirm change</button><button className="button subtle" disabled={busy} onClick={() => decide(false)}>Dismiss</button></div></section>}
      <section className="commerce-card"><h2>My recent proposals</h2>{history.length ? history.map(item => <div className="insights-list-row" key={item.id}><strong>{item.action.replaceAll("_", " ")} · {item.status}</strong><span>{new Date(item.created_at).toLocaleString()}</span></div>) : <p className="insights-empty">No proposals yet.</p>}</section>
    </>}
  </main>;
}

export default function AdminAgentPage() {
  return <WorkspaceShell>{workspace => <AdminContent key={workspace.tenantId} tenantId={workspace.tenantId} role={workspace.current?.role || "staff"} />}</WorkspaceShell>;
}
