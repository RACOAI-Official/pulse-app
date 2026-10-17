"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Bot, Inbox, MessageSquare, ShoppingBag, Users } from "lucide-react";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api, ChannelConnection } from "@/lib/api";
import OnboardingCard from "@/components/OnboardingCard";

type Daily = { day: string; received: number; ai_replies: number; human_replies: number; orders: number; sales_minor: number };
type Analytics = {
  days: number; timezone: string; currency: string; totals: Omit<Daily, "day"> & { automation_percent: number };
  today: Omit<Daily, "day">; daily: Daily[]; active_conversations: number; pending_orders: number;
  channels: { channel: string; received: number }[];
  top_products: { title: string; units: number }[];
  top_customers: { name: string; orders: number; sales_minor: number }[];
};

const money = (minor: number, currency: string) => new Intl.NumberFormat("en-BD", { style: "currency", currency }).format(minor / 100);

function AnalyticsContent({ tenantId, dashboard }: { tenantId: string; dashboard: boolean }) {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [data, setData] = useState<Analytics | null>(null);
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [report, connected] = await Promise.all([
        api<Analytics>(`/tenants/${tenantId}/analytics?days=${days}`),
        api<ChannelConnection[]>(`/tenants/${tenantId}/channels`),
      ]);
      setData(report); setChannels(connected);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Analytics unavailable"); }
    finally { setLoading(false); }
  }, [tenantId, days]);
  useEffect(() => { refresh(); }, [refresh]);

  const maxReceived = Math.max(1, ...(data?.daily.map(day => day.received) || []));
  return <main className="insights-page">
    <header className="insights-heading"><div><span className="eyebrow">{dashboard ? "OPERATIONS / AT A GLANCE" : "INSIGHTS / HISTORICAL"}</span><h1>{dashboard ? "Your business, in view." : "Analytics"}</h1><p>Actual activity recorded by Pulse · Asia/Dhaka · confirmed, non-cancelled orders</p></div><div className="insights-controls"><label>Period <select value={days} onChange={event => setDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label><button className="button subtle" onClick={refresh}>Refresh</button></div></header>
    {dashboard && <OnboardingCard tenantId={tenantId} />}
    {error && <div className="form-notice" role="alert">{error}</div>}
    {loading && !data ? <div className="commerce-card">Loading live metrics…</div> : data && <>
      <div className="metric-grid">
        <Metric label="Received messages" value={data.totals.received} icon={<MessageSquare size={18} />} hint={`${data.active_conversations} active conversations`} />
        <Metric label="AI replies" value={data.totals.ai_replies} icon={<Bot size={18} />} hint={`${data.totals.automation_percent}% of replies`} />
        <Metric label="Team replies" value={data.totals.human_replies} icon={<Inbox size={18} />} hint="Human responses" />
        <Metric label="Confirmed orders" value={data.totals.orders} icon={<ShoppingBag size={18} />} hint={`${data.pending_orders} pending or draft`} />
        <Metric label="Order sales" value={money(data.totals.sales_minor, data.currency)} icon={<ArrowUpRight size={18} />} hint="Confirmed order value" />
        <Metric label="Today" value={data.today.received} icon={<Users size={18} />} hint="Messages received today" />
      </div>
      <div className="insights-columns">
        <section className="insights-card wide"><div className="insights-card-head"><div><span className="eyebrow">MESSAGE ACTIVITY</span><h2>When customers reached out</h2></div><span>{data.days} days</span></div><div className="activity-chart" role="img" aria-label="Daily received messages">{data.daily.map(day => <div className="activity-day" key={day.day} title={`${day.day}: ${day.received} received, ${day.ai_replies} AI replies, ${day.human_replies} team replies`}><div className="activity-bar-wrap"><span className="activity-bar" style={{ height: `${Math.max(day.received ? 4 : 0, 100 * day.received / maxReceived)}%` }} /></div><small>{new Date(day.day + "T12:00:00").toLocaleDateString("en-BD", { month: "short", day: "numeric" })}</small></div>)}</div><div className="chart-legend"><span><i /> Received</span><span>{data.totals.ai_replies} AI replies</span><span>{data.totals.human_replies} team replies</span></div></section>
        <section className="insights-card"><span className="eyebrow">CHANNELS</span><h2>Connected channels</h2>{(["messenger", "instagram", "whatsapp"] as const).map(channel => { const connection = channels.find(item => item.channel === channel); const count = data.channels.find(item => item.channel === channel)?.received || 0; return <div className="insights-list-row" key={channel}><strong>{channel === "messenger" ? "Facebook Messenger" : channel === "instagram" ? "Instagram" : "WhatsApp"}</strong><span>{connection?.status === "connected" ? `${count} received` : "Not connected"}</span></div>; })}<Link href="/integrations" className="text-button">Manage integrations →</Link></section>
        <section className="insights-card"><span className="eyebrow">COMMERCE</span><h2>Top products</h2>{data.top_products.length ? data.top_products.map(item => <div className="insights-list-row" key={item.title}><strong>{item.title}</strong><span>{item.units} units</span></div>) : <p className="insights-empty">No confirmed product sales in this period.</p>}</section>
        <section className="insights-card"><span className="eyebrow">CUSTOMERS</span><h2>Top order customers</h2>{data.top_customers.length ? data.top_customers.map((item, index) => <div className="insights-list-row" key={index}><strong>{item.name}</strong><span>{money(item.sales_minor, data.currency)}</span></div>) : <p className="insights-empty">No confirmed customer orders in this period.</p>}</section>
        <section className="insights-card"><span className="eyebrow">SALES TREND</span><h2>Daily orders and sales</h2>{data.daily.slice(-7).map(day => <div className="insights-list-row" key={day.day}><strong>{day.day}</strong><span>{day.orders} orders · {money(day.sales_minor, data.currency)}</span></div>)}</section>
      </div>
      <p className="insights-note">Customer counts across different channels are not merged without a verified shared identity. Sales reflect confirmed orders, not payments received.</p>
    </>}
  </main>;
}

function Metric({ label, value, icon, hint }: { label: string; value: number | string; icon: React.ReactNode; hint: string }) {
  return <section className="metric-card"><div className="metric-card-top"><span>{label}</span>{icon}</div><strong>{value}</strong><small>{hint}</small></section>;
}

export default function AnalyticsView({ dashboard = false }: { dashboard?: boolean }) {
  return <WorkspaceShell>{workspace => <AnalyticsContent key={workspace.tenantId} tenantId={workspace.tenantId} dashboard={dashboard} />}</WorkspaceShell>;
}
