"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api, Conversation } from "@/lib/api";
import { SectionSkeleton } from "@/components/LoadingFeedback";

type Customer = { id: string; display_name: string; phone: string; conversations: { id: string; channel: string; customer_name: string | null }[] };
type Timeline = { customer: Customer; conversations: Customer["conversations"]; messages: { id: string; channel: string; direction: string; sender_type: string; body: string | null; created_at: string }[]; orders: { id: string; state: string; total_minor: number; currency_code: string; created_at: string }[] };

function CustomersContent({ tenantId }: { tenantId: string }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [linkId, setLinkId] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [profiles, threads] = await Promise.all([
        api<Customer[]>(`/tenants/${tenantId}/customers`),
        api<Conversation[]>(`/tenants/${tenantId}/conversations`),
      ]);
      setCustomers(profiles); setConversations(threads);
      setSelectedId(current => current || profiles[0]?.id || "");
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Could not load customers"); }
    finally { setLoaded(true); }
  }, [tenantId]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!selectedId) { setTimeline(null); return; }
    api<Timeline>(`/tenants/${tenantId}/customers/${selectedId}/timeline`).then(row => {
      setTimeline(row); setName(row.customer.display_name); setPhone(row.customer.phone);
    }).catch(caught => setNotice(caught.message));
  }, [tenantId, selectedId, customers]);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/tenants/${tenantId}/customers/${selectedId}`, { method: "PUT", body: JSON.stringify({ display_name: name, phone }) });
      setNotice("Customer updated."); await refresh();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Could not update customer"); }
  }
  async function link(event: FormEvent) {
    event.preventDefault();
    if (!linkId || !window.confirm("Link this conversation to the selected customer? Its messages will appear in this customer's timeline.")) return;
    try {
      await api(`/tenants/${tenantId}/customers/${selectedId}/conversations`, { method: "POST", body: JSON.stringify({ conversation_id: linkId }) });
      setLinkId(""); setNotice("Conversation linked."); await refresh();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Could not link conversation"); }
  }
  const shown = customers.filter(item => (item.display_name + " " + item.phone).toLowerCase().includes(query.toLowerCase()));
  if (!loaded) return <main className="commerce-page"><header className="commerce-heading"><h1>Customers</h1></header><SectionSkeleton /></main>;
  return <main className="commerce-page"><header className="commerce-heading"><div><h1>Customers</h1><p>Link identities across channels only when you know they belong to the same customer.</p></div></header>{notice && <p className="form-notice" role="status">{notice}</p>}<div className="orders-layout"><section className="commerce-card order-list"><div className="commerce-section-head"><h2>Customer profiles</h2></div><input className="crm-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or phone" aria-label="Search customers" />{shown.map(item => <button key={item.id} className={`order-list-item ${selectedId === item.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}><span><strong>{item.display_name || "Customer"}</strong><small>{item.conversations.length} conversations / {item.phone || "No phone recorded"}</small></span></button>)}{!shown.length && <p className="commerce-empty">No customer profiles yet.</p>}</section><section className="commerce-card order-detail">{timeline ? <><h2>{timeline.customer.display_name}</h2><form className="crm-profile" onSubmit={save}><label>Name<input value={name} onChange={event => setName(event.target.value)} required maxLength={160} /></label><label>Phone<input value={phone} onChange={event => setPhone(event.target.value)} maxLength={40} /></label><button className="button subtle">Save details</button></form><h3>Connected conversations</h3>{timeline.conversations.map(row => <div className="insights-list-row" key={row.id}><strong>{row.channel}</strong><span>{row.customer_name || row.id.slice(0, 8)}</span></div>)}<form className="crm-link" onSubmit={link}><select aria-label="Conversation to link" value={linkId} onChange={event => setLinkId(event.target.value)}><option value="">Choose a conversation</option>{conversations.filter(row => !timeline.conversations.some(item => item.id === row.id)).map(row => <option value={row.id} key={row.id}>{row.channel}: {row.customer_name || row.external_thread_id}</option>)}</select><button className="button subtle" disabled={!linkId}>Link conversation</button></form><h3>Orders</h3>{timeline.orders.map(order => <div className="insights-list-row" key={order.id}><strong>{order.state.replaceAll("_", " ")}</strong><span>{new Intl.NumberFormat("en-BD", { style: "currency", currency: order.currency_code }).format(order.total_minor / 100)}</span></div>)}{!timeline.orders.length && <p className="insights-empty">No linked orders.</p>}<h3>Recent timeline</h3>{timeline.messages.map(row => <div className="crm-message" key={row.id}><span>{row.channel} / {row.sender_type} / {new Date(row.created_at).toLocaleString()}</span><p>{row.body || "Attachment"}</p></div>)}{!timeline.messages.length && <p className="insights-empty">No messages yet.</p>}</> : <p className="commerce-empty">Select a customer profile.</p>}</section></div></main>;
}

export default function CustomersPage() {
  return <WorkspaceShell>{workspace => <CustomersContent key={workspace.tenantId} tenantId={workspace.tenantId} />}</WorkspaceShell>;
}
