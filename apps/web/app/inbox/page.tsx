"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, CheckCheck, CircleAlert, Image as ImageIcon, LoaderCircle, MessageSquare, RefreshCw, Search, Send, SlidersHorizontal } from "lucide-react";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api, Conversation, InboxMedia, Message, websocketBase } from "@/lib/api";

const channels = ["all", "messenger", "instagram", "whatsapp"] as const;
const labels = { messenger: "Messenger", instagram: "Instagram", whatsapp: "WhatsApp" };

function clock(date: string) {
  return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function shortDate(date: string) {
  const value = new Date(date);
  return value.toDateString() === new Date().toDateString() ? clock(date) : value.toLocaleDateString([], { month: "short", day: "numeric" });
}

function MediaView({ tenantId, messageId, index, item }: { tenantId: string; messageId: string; index: number; item: InboxMedia }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  if (item.unavailable) return <span className="media-unavailable">Attachment unavailable</span>;
  async function load() {
    try {
      const result = await api<{ url: string }>(`/tenants/${tenantId}/messages/${messageId}/media/${index}`);
      setUrl(result.url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open attachment"); }
  }
  return <div className="message-media">
    {url ? item.mime_type?.startsWith("image/") ? <img src={url} alt="Customer attachment" />
      : item.mime_type?.startsWith("video/") ? <video src={url} controls />
      : item.mime_type?.startsWith("audio/") ? <audio src={url} controls />
      : <a href={url} target="_blank" rel="noreferrer">Open attachment</a>
      : <button onClick={load}><ImageIcon size={16} /> View {item.type || "attachment"}</button>}
    {error && <small className="error-text">{error}</small>}
  </div>;
}

function InboxContent({ tenantId }: { tenantId: string }) {
  const [channel, setChannel] = useState<(typeof channels)[number]>("all");
  const [state, setState] = useState<"all" | "open" | "resolved">("all");
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const conversationRequest = useRef(0);
  const messageRequest = useRef(0);
  const selected = useMemo(() => conversations.find(item => item.id === selectedId), [conversations, selectedId]);

  const loadConversations = useCallback(async () => {
    const request = ++conversationRequest.current;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (channel !== "all") params.set("channel", channel);
    if (state !== "all") params.set("state", state);
    try {
      const rows = await api<Conversation[]>(`/tenants/${tenantId}/conversations?${params}`);
      if (request !== conversationRequest.current) return;
      setConversations(rows);
      setSelectedId(current => rows.some(item => item.id === current) ? current : rows[0]?.id || "");
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load inbox"); }
    finally { setLoading(false); }
  }, [tenantId, query, channel, state]);

  const loadMessages = useCallback(async () => {
    const request = ++messageRequest.current;
    if (!selectedId) { setMessages([]); return; }
    try {
      const rows = await api<Message[]>(`/tenants/${tenantId}/conversations/${selectedId}/messages`);
      if (request !== messageRequest.current) return;
      setMessages(rows);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load messages"); }
  }, [tenantId, selectedId]);

  useEffect(() => { const timer = setTimeout(loadConversations, 180); return () => clearTimeout(timer); }, [loadConversations]);
  useEffect(() => { loadMessages(); }, [loadMessages]);
  const refreshRef = useRef({ loadConversations, loadMessages });
  useEffect(() => { refreshRef.current = { loadConversations, loadMessages }; }, [loadConversations, loadMessages]);
  useEffect(() => {
    if (!selectedId) return;
    api(`/tenants/${tenantId}/conversations/${selectedId}`, { method: "PATCH", body: JSON.stringify({ mark_read: true }) })
      .then(() => setConversations(items => items.map(item => item.id === selectedId ? { ...item, unread_count: 0 } : item)))
      .catch(() => {});
  }, [tenantId, selectedId]);
  useEffect(() => {
    let socket: WebSocket | undefined;
    let closed = false;
    api<{ ticket: string }>(`/tenants/${tenantId}/ws-ticket`, { method: "POST" })
      .then(({ ticket }) => {
        if (closed) return;
        socket = new WebSocket(`${websocketBase()}/ws?ticket=${encodeURIComponent(ticket)}`);
        socket.onmessage = event => {
          try {
            if (JSON.parse(event.data).type === "refresh") {
              refreshRef.current.loadConversations();
              refreshRef.current.loadMessages();
            }
          } catch { /* Ignore malformed live notifications; polling remains active. */ }
        };
      }).catch(() => {});
    const interval = setInterval(() => {
      refreshRef.current.loadConversations();
      refreshRef.current.loadMessages();
    }, 15000);
    return () => {
      closed = true;
      if (socket) { socket.onmessage = null; socket.close(); }
      clearInterval(interval);
    };
  }, [tenantId]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !draft.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await api(`/tenants/${tenantId}/conversations/${selectedId}/reply`, {
        method: "POST", body: JSON.stringify({ body: draft.trim(), idempotency_key: crypto.randomUUID() }),
      });
      setDraft("");
      await Promise.all([loadMessages(), loadConversations()]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not send reply"); }
    finally { setBusy(false); }
  }

  async function toggleState() {
    if (!selected) return;
    const next = selected.state === "open" ? "resolved" : "open";
    try {
      await api(`/tenants/${tenantId}/conversations/${selected.id}`, {
        method: "PATCH", body: JSON.stringify({ state: next }),
      });
      await loadConversations();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update conversation"); }
  }

  async function retry(messageId: string) {
    try {
      await api(`/tenants/${tenantId}/messages/${messageId}/retry`, { method: "POST" });
      await loadMessages();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Retry failed"); }
  }

  return <div className="inbox-layout">
    <section className="conversation-panel">
      <div className="conversation-heading"><div><span className="eyebrow">SHARED WORKSPACE</span><h1>Conversations <span className="count-pill">{conversations.length}</span></h1></div><button className="icon-button" title="Refresh" onClick={loadConversations}><RefreshCw size={18} /></button></div>
      <div className="conversation-controls">
        <div className="search-field"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></div>
        <div className="filter-row"><SlidersHorizontal size={16} /><select aria-label="Conversation state" value={state} onChange={e => setState(e.target.value as typeof state)}><option value="all">All states</option><option value="open">Open</option><option value="resolved">Resolved</option></select></div>
      </div>
      <div className="channel-tabs" role="group" aria-label="Channel filter">{channels.map(item => <button key={item} className={channel === item ? "selected" : ""} onClick={() => setChannel(item)}>{item === "all" ? "All" : item === "whatsapp" ? "WhatsApp" : item === "instagram" ? "Instagram" : "Messenger"}</button>)}</div>
      <div className="conversation-list">{loading ? <div className="list-empty">Loading conversations…</div> : conversations.length === 0 ? <div className="list-empty"><MessageSquare size={28} /><strong>No conversations yet</strong><span>Messages from connected channels will appear here.</span></div> : conversations.map(item => <button key={item.id} className={`conversation-card ${item.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}>
        <span className={`channel-avatar ${item.channel}`}>{item.channel === "whatsapp" ? "W" : item.channel === "instagram" ? "I" : "M"}</span>
        <span className="conversation-summary"><span className="conversation-card-top"><strong>{item.customer_name || item.external_thread_id}</strong><small>{shortDate(item.last_message_at)}</small></span><span className="conversation-card-bottom"><span>{labels[item.channel]} · {item.state === "resolved" ? "Resolved" : "Open"}</span>{item.unread_count > 0 && <b>{item.unread_count}</b>}</span></span>
      </button>)}</div>
      <div className="panel-foot"><span className="live-dot" /> Live inbox <span>·</span> Human replies</div>
    </section>
    <section className="thread-panel">{selected ? <>
      <header className="thread-header"><div className="thread-identity"><span className={`channel-avatar ${selected.channel}`}>{selected.channel === "whatsapp" ? "W" : selected.channel === "instagram" ? "I" : "M"}</span><div><strong>{selected.customer_name || selected.external_thread_id}</strong><span>{labels[selected.channel]} conversation</span></div></div><button className="button subtle" onClick={toggleState}>{selected.state === "open" ? <><Check size={16} /> Resolve</> : <><ArrowUpRight size={16} /> Reopen</>}</button></header>
      <div className="thread-timeline"><div className="thread-start"><span>CONVERSATION STARTED</span><i /></div>{messages.map(message => <article key={message.id} className={`bubble-row ${message.direction === "outbound" ? "outbound" : "inbound"}`}><div className="message-bubble">
        {message.body && <p>{message.body}</p>}
        {message.media.map((item, index) => <MediaView key={index} tenantId={tenantId} messageId={message.id} index={index} item={item} />)}
        <div className="bubble-meta"><span>{message.sender_type === "human" ? "Team" : "Customer"} · {clock(message.created_at)}</span>{message.delivery_state === "sent" ? <CheckCheck size={14} /> : message.delivery_state === "queued" || message.delivery_state === "sending" ? <LoaderCircle size={13} /> : null}</div>
        {(message.delivery_state === "failed" || message.delivery_state === "uncertain") && <div className="delivery-error"><CircleAlert size={14} /><span>{message.delivery_state === "uncertain" ? "Delivery uncertain — check the channel before another reply." : message.failure_reason || "Send failed"}</span>{message.delivery_state === "failed" && <button onClick={() => retry(message.id)}>Retry</button>}</div>}
      </div></article>)}</div>
      <div className="composer-wrap">{error && <div className="inbox-error" role="alert">{error}</div>}<form className="composer" onSubmit={send}><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write a reply to this customer…" aria-label="Reply" maxLength={1000} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><div className="composer-bottom"><span><ArrowDownLeft size={14} /> Human reply · {draft.length}/1000</span><button type="submit" className="button primary" disabled={busy || !draft.trim()}>{busy ? "Queuing…" : "Send reply"}<Send size={16} /></button></div></form></div>
    </> : <div className="thread-empty"><div className="empty-orbit"><MessageSquare size={29} /></div><span className="eyebrow">YOUR INBOX IS READY</span><h2>Every reply starts here.</h2><p>Connect a Meta sandbox channel and send a test message to begin.</p></div>}</section>
  </div>;
}

export default function InboxPage() {
  return <WorkspaceShell>{workspace => <InboxContent key={workspace.tenantId} tenantId={workspace.tenantId} />}</WorkspaceShell>;
}
