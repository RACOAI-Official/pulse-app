"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import PulseMark from "@/components/PulseMark";
import { SectionSkeleton } from "@/components/LoadingFeedback";

type Overview = { tenants: number; connected_channels: number; failed_webhooks: number; problem_sends: number; businesses: { id: string; name: string; channels: number; conversations: number; orders: number }[] };

export default function OpsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Overview>("/ops/overview").then(setData).catch(caught => setError(caught.message)); }, []);
  return <main className="ops-page"><header className="ops-head"><Link href="/dashboard" className="rail-brand" aria-label="Pulse dashboard"><span className="rail-brand-mark"><PulseMark /></span></Link><div><h1>Operations</h1><p>Platform health across authorized tenants.</p></div></header>{error && <section className="commerce-card" role="alert">{error}</section>}{!data && !error && <SectionSkeleton variant="dashboard" />}{data && <><div className="metric-grid"><div className="metric-card"><span>Tenants</span><strong>{data.tenants}</strong></div><div className="metric-card"><span>Connected channels</span><strong>{data.connected_channels}</strong></div><div className="metric-card"><span>Failed webhooks</span><strong>{data.failed_webhooks}</strong></div><div className="metric-card"><span>Problem sends</span><strong>{data.problem_sends}</strong></div></div><section className="commerce-card"><h2>Businesses</h2>{data.businesses.map(row => <div className="insights-list-row" key={row.id}><strong>{row.name}</strong><span>{row.channels} channels / {row.conversations} conversations / {row.orders} orders</span></div>)}</section></>}</main>;
}
