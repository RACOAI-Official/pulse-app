"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, CheckCheck, CircleAlert, Image as ImageIcon, LoaderCircle, MessageSquare, RefreshCw, Search, Send, SlidersHorizontal } from "@/components/icons";
import WorkspaceShell from "@/components/WorkspaceShell";
import ChannelIcon from "@/components/ChannelIcon";
import Link from "next/link";
import { CommentsInbox, OrdersInbox, TicketsInbox, UnrepliedInbox } from "@/components/InboxExtraViews";
import { api, Conversation, InboxMedia, Message, websocketBase } from "@/lib/api";
import { SectionSkeleton } from "@/components/LoadingFeedback";

const channels = ["all", "messenger", "instagram", "whatsapp"] as const;
const labels = { messenger: "Messenger", instagram: "Instagram", whatsapp: "WhatsApp" };

function clock(date: string) {
  return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function shortDate(date: string) {
  const value = new Date(date);
  return value.toDateString() === new Date().toDateString() ? clock(date) : value.toLocaleDateString([], { month: "short", day: "numeric" });
}
function initials(name: string) {
  const [first = name, second] = name.match(/\p{L}+/gu) || [];
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}
function CustomerAvatar({ conversation }: { conversation: Conversation }) {
  const name = customerLabel(conversation);
  const tint = [...name].reduce((total, char) => total + char.charCodeAt(0), 0) % 5;
  return <span className={`avatar-initials tint-${tint}`} aria-hidden="true">{initials(name)}<span className="avatar-badge"><ChannelIcon channel={conversation.channel} size={15} /></span></span>;
}
function customerLabel(conversation: Conversation) {
  return conversation.customer_name?.trim() || `Customer / ${conversation.external_thread_id.slice(-4)}`;
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

function InboxContent({ tenantId, focusId }: { tenantId: string; focusId: string }) {
  const [channel, setChannel] = useState<(typeof channels)[number]>("all");
  const [state, setState] = useState<"all" | "open" | "resolved">("all");
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState(focusId);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(focusId));
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const conversationRequest = useRef(0);
  const messageRequest = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const renderedThread = useRef("");
  const scrollOnUpdate = useRef(true);
  const selected = useMemo(() => conversations.find(item => item.id === selectedId), [conversations, selectedId]);
  const filtered = Boolean(query.trim()) || channel !== "all" || state !== "all";

  const loadConversations = useCallback(async () => {
    const request = ++conversationRequest.current;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (channel !== "all") params.set("channel", channel);
    if (state !== "all") params.set("state", state);
    try {
      let rows = await api<Conversation[]>(`/tenants/${tenantId}/conversations?${params}`);
      // A deep-linked chat (e.g. from an order) may be older than the latest 100; load it directly.
      if (focusId && !params.toString() && !rows.some(item => item.id === focusId)) {
        const focused = await api<Conversation>(`/tenants/${tenantId}/conversations/${focusId}`).catch(() => null);
        if (focused) rows = [focused, ...rows];
      }
      if (request !== conversationRequest.current) return;
      setConversations(rows);
      setSelectedId(current => rows.some(item => item.id === current) ? current : rows[0]?.id || "");
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load inbox"); }
    finally { setLoading(false); }
  }, [tenantId, focusId, query, channel, state]);

  const loadMessages = useCallback(async () => {
    const request = ++messageRequest.current;
    if (!selectedId) { setMessages([]); return; }
    try {
      const rows = await api<Message[]>(`/tenants/${tenantId}/conversations/${selectedId}/messages`);
      if (request !== messageRequest.current) return;
      const timeline = timelineRef.current;
      scrollOnUpdate.current = renderedThread.current !== selectedId || !timeline || timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 120;
      renderedThread.current = selectedId;
      setMessages(rows);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load messages"); }
  }, [tenantId, selectedId]);

  useEffect(() => { const timer = setTimeout(loadConversations, 180); return () => clearTimeout(timer); }, [loadConversations]);
  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => {
    if (scrollOnUpdate.current && timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [messages]);
  useLayoutEffect(() => {
    const reply = replyRef.current;
    if (!reply) return;
    reply.style.height = "auto";
    reply.style.height = `${Math.min(reply.scrollHeight, 84)}px`;
    reply.style.overflowY = reply.scrollHeight > 84 ? "auto" : "hidden";
  }, [draft]);
  useEffect(() => {
    if (mobileThreadOpen && timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [mobileThreadOpen, selectedId]);
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

  async function toggleResponder() {
    if (!selected) return;
    try {
      await api(`/tenants/${tenantId}/conversations/${selected.id}/responder`, {
        method: "POST", body: JSON.stringify({ responder: selected.responder === "ai" ? "human" : "ai" }),
      });
      await loadConversations();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not change responder"); }
  }

  async function retry(messageId: string) {
    try {
      await api(`/tenants/${tenantId}/messages/${messageId}/retry`, { method: "POST" });
      await loadMessages();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Retry failed"); }
  }

  async function createTicket() {
    if (!selected) return;
    const subject = window.prompt("Ticket subject", `Follow up with ${selected.customer_name || "customer"}`);
    if (!subject?.trim()) return;
    try {
      await api(`/tenants/${tenantId}/tickets`, { method: "POST", body: JSON.stringify({ conversation_id: selected.id, subject: subject.trim() }) });
      setError("Ticket created for this conversation.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create ticket"); }
  }

  if (loading && !conversations.length) return <SectionSkeleton variant="inbox" />;

  return <div className={`inbox-layout ${mobileThreadOpen ? "mobile-thread-open" : ""}`}>
    <section className="conversation-panel">
      <div className="conversation-heading"><div><h1>Conversations <span className="count-pill">{conversations.length}</span></h1></div><button className="icon-button" title="Refresh" onClick={loadConversations}><RefreshCw size={18} /></button></div>
      <div className="conversation-controls">
        <div className="search-field"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></div>
        <div className="filter-row"><SlidersHorizontal size={16} /><select aria-label="Conversation state" value={state} onChange={e => setState(e.target.value as typeof state)}><option value="all">All states</option><option value="open">Open</option><option value="resolved">Resolved</option></select></div>
      </div>
      <div className="channel-tabs" role="group" aria-label="Channel filter">{channels.map(item => <button key={item} className={`channel-pill ${channel === item ? "selected" : ""}`} aria-pressed={channel === item} onClick={() => setChannel(item)}>{item !== "all" && <ChannelIcon channel={item} size={16} />}{item === "all" ? "All" : labels[item]}</button>)}</div>
      <div className="conversation-list">{loading ? <div className="list-empty">Loading conversations…</div> : conversations.length === 0 ? <div className="list-empty"><MessageSquare size={28} /><strong>{filtered ? "No matching conversations" : "No conversations yet"}</strong><span>{filtered ? "Try another search or clear your filters." : "Messages from connected channels will appear here."}</span></div> : conversations.map(item => <button key={item.id} className={`conversation-card ${item.id === selectedId ? "selected" : ""}`} onClick={() => { setSelectedId(item.id); setMobileThreadOpen(true); }}>
        <CustomerAvatar conversation={item} />
        <span className="conversation-summary"><span className="conversation-card-top"><strong title={item.external_thread_id}>{customerLabel(item)}</strong><small>{shortDate(item.last_message_at)}</small></span><span className="conversation-card-bottom"><span className="channel-line"><ChannelIcon channel={item.channel} size={13} />{labels[item.channel]} / {item.state === "resolved" ? "Resolved" : "Open"}</span>{item.unread_count > 0 && <b>{item.unread_count}</b>}</span></span>
      </button>)}</div>
      <div className="panel-foot"><span className="live-dot" /> Live inbox <span>·</span> Human replies</div>
    </section>
    <section className="thread-panel">{selected ? <>
      <header className="thread-header"><button className="icon-button thread-back" aria-label="Back to conversations" onClick={() => setMobileThreadOpen(false)}><ArrowLeft size={18} /></button><div className="thread-identity"><CustomerAvatar conversation={selected} /><div><strong title={selected.external_thread_id}>{customerLabel(selected)}<ChannelIcon channel={selected.channel} size={17} className="thread-channel-icon" title /></strong><span>{labels[selected.channel]} / {selected.responder === "human" ? "Human takeover" : "AI available"}</span></div></div><div className="thread-actions"><Link className="button subtle" href={`/orders?conversation_id=${selected.id}`}>Create order</Link><button className="button subtle" onClick={createTicket}>Create ticket</button><button className="button subtle" onClick={toggleResponder}>{selected.responder === "ai" ? "Take over" : "Return to AI"}</button><button className="button subtle" onClick={toggleState}>{selected.state === "open" ? <><Check size={16} /> Resolve</> : <><ArrowUpRight size={16} /> Reopen</>}</button></div></header>
      <div className="thread-timeline" ref={timelineRef}><div className="thread-start"><span>CONVERSATION STARTED</span><i /></div>{messages.map(message => <article key={message.id} className={`bubble-row ${message.direction === "outbound" ? "outbound" : "inbound"}`}><div className="message-bubble">
        {message.body && <p>{message.body}</p>}
        {message.media.map((item, index) => <MediaView key={index} tenantId={tenantId} messageId={message.id} index={index} item={item} />)}
        <div className="bubble-meta"><span>{message.sender_type === "human" ? "Team" : message.sender_type === "ai" ? "Pulse AI" : message.sender_type === "system" ? "Pulse" : "Customer"} / {clock(message.created_at)}</span>{message.delivery_state === "sent" ? <CheckCheck size={14} /> : message.delivery_state === "queued" || message.delivery_state === "sending" ? <LoaderCircle size={13} /> : null}</div>
        {(message.delivery_state === "failed" || message.delivery_state === "uncertain") && <div className="delivery-error"><CircleAlert size={14} /><span>{message.delivery_state === "uncertain" ? "Delivery uncertain — check the channel before another reply." : message.failure_reason || "Send failed"}</span>{message.delivery_state === "failed" && <button onClick={() => retry(message.id)}>Retry</button>}</div>}
      </div></article>)}</div>
      <div className="composer-wrap">{error && <div className="inbox-error" role="alert">{error}</div>}<form className="composer" onSubmit={send}><textarea ref={replyRef} rows={1} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write a reply to this customer…" aria-label="Reply" maxLength={1000} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><span className="composer-count" aria-live="off">{draft.length}/1000</span><button type="submit" className="button primary" disabled={busy || !draft.trim()}>{busy ? "Queuing…" : "Send reply"}<Send size={16} /></button></form></div>
    </> : <div className="thread-empty"><div className="empty-orbit"><MessageSquare size={29} /></div><h2>{filtered ? "No thread selected." : "Every reply starts here."}</h2><p>{filtered ? "Clear the search or filters to see your conversations." : "Select a conversation, or connect a channel and send a test message to begin."}</p></div>}</section>
  </div>;
}

function InboxWorkspace({ tenantId }: { tenantId: string }) {
  const [tab, setTab] = useState<"messages" | "orders" | "unreplied" | "tickets" | "comments">("messages");
  const [focusId, setFocusId] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("conversation_id");
    if (params.get("tenant_id") === tenantId && id && /^[0-9a-f-]{36}$/i.test(id)) setFocusId(id);
  }, [tenantId]);
  function openConversation(id: string) { setFocusId(id); setTab("messages"); }
  return <div className="inbox-page"><div className="inbox-primary-tabs" role="tablist" aria-label="Inbox sections">{(["messages", "orders", "unreplied", "tickets", "comments"] as const).map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "selected" : ""} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    {tab === "messages" ? <InboxContent key={tenantId + focusId} tenantId={tenantId} focusId={focusId} /> : tab === "orders" ? <OrdersInbox tenantId={tenantId} /> : tab === "unreplied" ? <UnrepliedInbox tenantId={tenantId} openConversation={openConversation} /> : tab === "tickets" ? <TicketsInbox tenantId={tenantId} openConversation={openConversation} /> : <CommentsInbox tenantId={tenantId} />}
  </div>;
}

export default function InboxPage() {
  return <WorkspaceShell>{workspace => <InboxWorkspace key={workspace.tenantId} tenantId={workspace.tenantId} />}</WorkspaceShell>;
}
