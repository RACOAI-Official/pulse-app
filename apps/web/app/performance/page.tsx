"use client";

import { useEffect, useState } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api } from "@/lib/api";

type Performance = { user_id: string; replies: number; chats_handled: number; avg_response_minutes: number | null };

function PerformanceContent({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<Performance[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { api<Performance[]>(`/tenants/${tenantId}/performance?days=${days}`).then(setRows).catch(caught => setError(caught.message)); }, [tenantId, days]);
  return <main className="commerce-page"><header className="commerce-heading"><div><span className="eyebrow">INSIGHTS / TEAM</span><h1>Performance</h1><p>Human replies, conversations handled, and time since the last inbound message.</p></div><select className="insights-period" aria-label="Period" value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></header>{error && <p className="form-notice" role="alert">{error}</p>}<section className="commerce-card"><h2>Team members</h2>{rows.length ? rows.map(row => <div className="insights-list-row" key={row.user_id}><strong>Member {row.user_id.slice(0, 8)}</strong><span>{row.replies} replies · {row.chats_handled} chats · {row.avg_response_minutes === null ? "—" : row.avg_response_minutes + " min"} average</span></div>) : <p className="insights-empty">No human replies in this period.</p>}<p className="settings-note">Response time measures the gap from the most recent inbound message to a human reply. It does not include conversation waiting time after a previous human reply.</p></section></main>;
}

export default function PerformancePage() {
  return <WorkspaceShell>{workspace => <PerformanceContent key={workspace.tenantId} tenantId={workspace.tenantId} />}</WorkspaceShell>;
}
