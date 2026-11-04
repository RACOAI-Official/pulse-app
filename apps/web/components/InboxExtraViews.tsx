"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { MessageSquare, RefreshCw, Ticket, ShoppingBag } from "@/components/icons";
import { api, Conversation } from "@/lib/api";
import { CommerceOrder, money } from "@/lib/commerce";

export type TicketRow = { id: string; conversation_id: string; subject: string; source: string; status: "active" | "resolved"; created_at: string };
export type CommentRow = { id: string; channel: "messenger" | "instagram"; post_id: string; author_name: string; body: string; created_at: string; reply_body: string | null; reply_status: string | null; failure_reason: string | null };

export function OrdersInbox({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<CommerceOrder[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { api<CommerceOrder[]>(`/tenants/${tenantId}/commerce/orders`).then(setRows).catch(caught => setError(caught.message)); }, [tenantId]);
  return <section className="inbox-section-view"><div className="inbox-section-head"><div><h1>Orders</h1><p>Draft and confirmed orders in this workspace.</p></div><Link className="button primary" href="/orders">Manage orders</Link></div>{error && <p className="form-notice" role="alert">{error}</p>}{rows.length ? rows.map(row => <Link className="inbox-data-row" href="/orders" key={row.id}><ShoppingBag size={18} /><span><strong>{row.customer_name || "Unnamed draft"}</strong><small>{row.state.replaceAll("_", " ")} / {new Date(row.created_at).toLocaleDateString()}</small></span><b>{money(row.total_minor, row.currency_code)}</b></Link>) : <Empty icon={<ShoppingBag />} title="No orders yet" detail="Orders created from the commerce workspace will appear here." />}</section>;
}

export function UnrepliedInbox({ tenantId, openConversation }: { tenantId: string; openConversation: (id: string) => void }) {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(() => api<Conversation[]>(`/tenants/${tenantId}/unreplied-conversations`).then(setRows).catch(caught => setError(caught.message)), [tenantId]);
  useEffect(() => { refresh(); }, [refresh]);
  return <section className="inbox-section-view"><div className="inbox-section-head"><div><h1>Unreplied</h1><p>Customer messages with no later sent or queued reply.</p></div><button className="button subtle" onClick={refresh}><RefreshCw size={15} /> Refresh</button></div>{error && <p className="form-notice" role="alert">{error}</p>}{rows.length ? rows.map(row => <button className="inbox-data-row" key={row.id} onClick={() => openConversation(row.id)}><MessageSquare size={18} /><span><strong>{row.customer_name || row.external_thread_id}</strong><small>{row.channel} / Last message {new Date(row.last_message_at).toLocaleString()}</small></span><b>Open</b></button>) : <Empty icon={<MessageSquare />} title="All caught up" detail="Unanswered customer messages will appear here." />}</section>;
}

export function TicketsInbox({ tenantId, openConversation }: { tenantId: string; openConversation: (id: string) => void }) {
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [filter, setFilter] = useState<"active" | "resolved">("active");
  const [error, setError] = useState("");
  const refresh = useCallback(() => api<TicketRow[]>(`/tenants/${tenantId}/tickets`).then(setRows).catch(caught => setError(caught.message)), [tenantId]);
  useEffect(() => { refresh(); }, [refresh]);
  async function change(row: TicketRow) {
    try {
      await api(`/tenants/${tenantId}/tickets/${row.id}/status`, { method: "POST", body: JSON.stringify({ status: row.status === "active" ? "resolved" : "active" }) });
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update ticket"); }
  }
  return <section className="inbox-section-view"><div className="inbox-section-head"><div><h1>Tickets</h1><p>Staff tickets and agent handoffs linked to conversations.</p></div><button className="button subtle" onClick={refresh}><RefreshCw size={15} /> Refresh</button></div><div className="section-filter"><button className={filter === "active" ? "selected" : ""} onClick={() => setFilter("active")}>Active ({rows.filter(row => row.status === "active").length})</button><button className={filter === "resolved" ? "selected" : ""} onClick={() => setFilter("resolved")}>Resolved ({rows.filter(row => row.status === "resolved").length})</button></div>{error && <p className="form-notice" role="alert">{error}</p>}{rows.filter(row => row.status === filter).length ? rows.filter(row => row.status === filter).map(row => <div className="inbox-data-row" key={row.id}><Ticket size={18} /><span><strong>{row.subject}</strong><small>{row.source === "agent_handoff" ? "AI handoff" : "Staff"} / {new Date(row.created_at).toLocaleString()}</small></span><button className="text-button" onClick={() => openConversation(row.conversation_id)}>Conversation</button><button className="button subtle" onClick={() => change(row)}>{row.status === "active" ? "Resolve" : "Reopen"}</button></div>) : <Empty icon={<Ticket />} title={filter === "active" ? "No active tickets" : "No resolved tickets"} detail="Create a ticket from a conversation or let an agent handoff create one." />}</section>;
}

export function CommentsInbox({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const refresh = useCallback(() => api<CommentRow[]>(`/tenants/${tenantId}/comments`).then(setRows).catch(caught => setError(caught.message)), [tenantId]);
  useEffect(() => { refresh(); }, [refresh]);
  async function reply(event: FormEvent, row: CommentRow) {
    event.preventDefault(); setBusy(row.id); setError("");
    try {
      await api(`/tenants/${tenantId}/comments/${row.id}/reply`, { method: "POST", body: JSON.stringify({ body: drafts[row.id]?.trim() }) });
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not queue public reply"); }
    finally { setBusy(""); }
  }
  return <section className="inbox-section-view"><div className="inbox-section-head"><div><h1>Comments</h1><p>Replies here are public on the original Facebook or Instagram post.</p></div><button className="button subtle" onClick={refresh}><RefreshCw size={15} /> Refresh</button></div>{error && <p className="form-notice" role="alert">{error}</p>}{rows.length ? rows.map(row => <article className="comment-card" key={row.id}><div className="comment-meta"><strong>{row.author_name || "Customer"}</strong><span>{row.channel === "messenger" ? "Facebook" : "Instagram"} / Post {row.post_id} / {new Date(row.created_at).toLocaleString()}</span></div><p>{row.body || "Comment without text"}</p>{row.reply_status ? <div className="comment-reply"><strong>Pulse public reply / {row.reply_status}</strong><p>{row.reply_body}</p>{row.failure_reason && <small className="error-text">{row.failure_reason}</small>}</div> : <form onSubmit={event => reply(event, row)}><textarea aria-label={`Public reply to ${row.author_name || "customer"}`} placeholder="Write a public reply…" value={drafts[row.id] || ""} maxLength={1000} onChange={event => setDrafts(current => ({ ...current, [row.id]: event.target.value }))} /><button className="button primary" disabled={busy === row.id || !drafts[row.id]?.trim()}>{busy === row.id ? "Queuing…" : "Post public reply"}</button></form>}</article>) : <Empty icon={<MessageSquare />} title="No comments yet" detail="Comments from connected Facebook and Instagram posts will appear here after the required subscriptions are configured." />}</section>;
}

function Empty({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="section-empty">{icon}<h2>{title}</h2><p>{detail}</p></div>;
}
