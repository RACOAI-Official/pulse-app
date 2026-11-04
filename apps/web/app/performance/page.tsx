"use client";

import { useEffect, useState } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import styles from "../studio.module.css";
import { api } from "@/lib/api";

type Performance = { user_id: string; replies: number; chats_handled: number; avg_response_minutes: number | null };

function PerformanceContent({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<Performance[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { api<Performance[]>(`/tenants/${tenantId}/performance?days=${days}`).then(setRows).catch(caught => setError(caught.message)); }, [tenantId, days]);
  return <main className={`${styles.studio} ${styles.performance} commerce-page`}>
    <header className="commerce-heading"><div><h1>Team performance</h1><p>Human replies, conversations handled, and response time.</p></div><label className={styles.period}>Period<select className="insights-period" value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label></header>
    {error && <p className="form-notice" role="alert">{error}</p>}
    <section className="commerce-card"><div className={styles.tableHead}><h2>Team members</h2><span>{rows.length} members</span></div>
      {rows.length ? <div className={styles.memberList}>{rows.map(row => <div className={styles.memberRow} key={row.user_id}><strong>Member {row.user_id.slice(0, 8)}</strong><div><b>{row.replies}</b><span>Replies</span></div><div><b>{row.chats_handled}</b><span>Chats</span></div><div><b>{row.avg_response_minutes === null ? "—" : row.avg_response_minutes}</b><span>Avg. minutes</span></div></div>)}</div> : <p className="insights-empty">No human replies in this period.</p>}
    </section>
    <p className="settings-note">Response time measures the gap from the most recent inbound message to a human reply. It does not include conversation waiting time after a previous human reply.</p>
  </main>;
}

export default function PerformancePage() {
  return <WorkspaceShell>{workspace => <PerformanceContent key={workspace.tenantId} tenantId={workspace.tenantId} />}</WorkspaceShell>;
}
