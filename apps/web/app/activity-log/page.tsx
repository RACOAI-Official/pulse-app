"use client";

import { useEffect, useState } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api } from "@/lib/api";

type Activity = { id: string; action: string; subject_type: string; subject_id: string | null; actor_user_id: string | null; created_at: string };

function ActivityContent({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<Activity[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { api<Activity[]>(`/tenants/${tenantId}/activity`).then(setRows).catch(caught => setError(caught.message)); }, [tenantId]);
  return <main className="commerce-page"><header className="commerce-heading"><div><span className="eyebrow">INSIGHTS / ACCOUNTABILITY</span><h1>Activity Log</h1><p>Changes to products, orders, agent settings, and tickets in this workspace.</p></div></header>{error && <p className="form-notice" role="alert">{error}</p>}<section className="commerce-card"><h2>Recent activity</h2>{rows.length ? rows.map(row => <div className="insights-list-row" key={row.id}><strong>{row.subject_type.replaceAll("_", " ")} · {row.action}</strong><span>{new Date(row.created_at).toLocaleString()} · {row.actor_user_id ? `Member ${row.actor_user_id.slice(0, 8)}` : "System"}</span></div>) : <p className="insights-empty">No recorded changes yet. New changes will appear here.</p>}</section></main>;
}

export default function ActivityPage() {
  return <WorkspaceShell>{workspace => <ActivityContent key={workspace.tenantId} tenantId={workspace.tenantId} />}</WorkspaceShell>;
}
