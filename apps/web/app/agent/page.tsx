"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Bot, Check, CirclePause, CirclePlay, FlaskConical, Plus, Send, Trash2 } from "@/components/icons";
import WorkspaceShell from "@/components/WorkspaceShell";
import styles from "../studio.module.css";
import { api } from "@/lib/api";

type Fact = { topic: string; content: string };
type Faq = { question: string; answer: string };
type Draft = {
  business_name: string; business_description: string; behavior: string;
  language_v2?: boolean; media_reply_bangla?: string; media_reply_english?: string;
  language: "auto" | "bangla" | "english";
  addressing: "neutral" | "customer_preference";
  policies: Fact[]; faqs: Faq[]; media_reply: string;
};
type AgentConfig = { draft: Draft; published: Draft | null; published_version: number;
  draft_revision: number; tested_revision: number; enabled: boolean };
type Turn = { role: "user" | "assistant"; content: string };

function AgentContent({ tenantId, role }: { tenantId: string; role: "owner" | "manager" | "staff" }) {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const previewState = useRef<Record<string, unknown> | null>(null);
  const [diagnostics, setDiagnostics] = useState("");
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const publishDialog = useRef<HTMLDialogElement>(null);
  const [loading, setLoading] = useState(true);
  const base = `/tenants/${tenantId}/agent`;
  const dirty = useMemo(() => draft ? JSON.stringify(draft) !== saved : false, [draft, saved]);
  const canPublish = !!config && !dirty && config.draft_revision > 0 && config.tested_revision === config.draft_revision;

  useEffect(() => {
    let active = true;
    api<AgentConfig>(base).then(value => {
      if (!active) return;
      setConfig(value); setDraft(value.draft); setSaved(JSON.stringify(value.draft)); setLoading(false);
    }).catch(error => { if (active) { setNotice(error instanceof Error ? error.message : "Could not load agent"); setLoading(false); } });
    return () => { active = false; };
  }, [base]);

  useEffect(() => {
    const dialog = publishDialog.current;
    if (!dialog) return;
    if (confirmPublish && !dialog.open) dialog.showModal();
    if (!confirmPublish && dialog.open) dialog.close();
  }, [confirmPublish]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setNotice("");
    try { await work(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  }

  function edit<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!draft) return;
    await act(async () => {
      const result = await api<{ draft_revision: number }>(`${base}/draft`, {
        method: "PUT", body: JSON.stringify(draft),
      });
      setSaved(JSON.stringify(draft)); setTurns([]); previewState.current = null; setDiagnostics("");
      setConfig(current => current ? { ...current, draft_revision: result.draft_revision,
        tested_revision: 0, draft } : current);
      setNotice("Draft saved. Test it before publishing.");
    });
  }

  async function test(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || dirty || !config || !draft?.business_name.trim()) return;
    const question = prompt.trim();
    await act(async () => {
      const result = await api<{ response: string; tested_revision: number | null; preview_state?: Record<string, unknown>; diagnostics?: { language: string; intent: string; handoff: boolean } }>(`${base}/test`, {
        method: "POST", body: JSON.stringify({ prompt: question, history: turns.slice(-8), preview_state: previewState.current }),
      });
      setTurns(current => [...current, { role: "user", content: question },
        { role: "assistant", content: result.response }]);
      previewState.current = result.preview_state ?? null;
      setDiagnostics(result.diagnostics ? `${result.diagnostics.language}, ${result.diagnostics.intent}${result.diagnostics.handoff ? ", human handoff" : ""}` : "");
      setPrompt("");
      if (result.tested_revision !== null) {
        setConfig(current => current ? { ...current, tested_revision: result.tested_revision! } : current);
      } else setNotice("The draft changed while testing. Test the latest saved version.");
    });
  }

  async function publish() {
    if (!canPublish) return;
    await act(async () => {
      const result = await api<{ published_version: number; enabled: boolean }>(`${base}/publish`, { method: "POST" });
      setConfig(current => current ? { ...current, published_version: result.published_version,
        published: current.draft, enabled: result.enabled } : current);
      setConfirmPublish(false);
      setNotice(`Version ${result.published_version} published.`);
    });
  }

  async function toggleLive() {
    if (!config) return;
    await act(async () => {
      const result = await api<{ enabled: boolean }>(`${base}/enabled`, {
        method: "POST", body: JSON.stringify({ enabled: !config.enabled }),
      });
      setConfig(current => current ? { ...current, enabled: result.enabled } : current);
      setNotice(result.enabled ? "Live AI replies enabled." : "Live AI replies paused.");
    });
  }

  if (loading) return <main className="agent-page"><p>Opening agent studio…</p></main>;
  if (!draft || !config) return <main className="agent-page"><p role="alert">{notice || "Agent configuration unavailable"}</p></main>;
  return <main className={`${styles.studio} agent-page`}>
    <header className="agent-heading"><div><h1>Your assistant</h1><p>The draft stays private until you publish it. Customer replies always use current catalog data.</p></div><div className="agent-state"><span className={config.enabled ? "live-dot" : "paused-dot"} />{config.enabled ? "Live replies on" : "Live replies off"}<small>Published v{config.published_version || "—"}</small></div></header>
    {notice && <div className="form-notice" role="status">{notice}</div>}
    <div className="agent-grid"><div className="agent-editor">
      <section className="agent-card"><div className="agent-card-head"><BookOpen size={19} /><div><h2>Business and voice</h2></div></div>
        <div className="agent-fields"><label>Business name<input disabled={role !== "owner"} value={draft.business_name} maxLength={120} onChange={e => edit("business_name", e.target.value)} placeholder="Your store name" /></label>
          <label>What your business does<textarea disabled={role !== "owner"} value={draft.business_description} maxLength={3000} onChange={e => edit("business_description", e.target.value)} placeholder="What you sell, who you serve, and useful context" /></label>
          <label>How the assistant should behave<textarea disabled={role !== "owner"} value={draft.behavior} maxLength={1500} onChange={e => edit("behavior", e.target.value)} placeholder="Be warm, concise, and ask when details are missing" /></label>
          <label><input type="checkbox" disabled={role !== "owner"} checked={draft.language_v2 ?? false} onChange={e => edit("language_v2", e.target.checked)} /> Enable Bangla and Banglish reply handling</label><p className="agent-help">Banglish receives বাংলা-script replies. Test before publishing.</p><div className="agent-pair"><label>Reply language<select disabled={role !== "owner"} value={draft.language} onChange={e => edit("language", e.target.value as Draft["language"])}><option value="auto">Match customer</option><option value="bangla">Bangla</option><option value="english">English</option></select></label><label>Addressing<select disabled={role !== "owner"} value={draft.addressing} onChange={e => edit("addressing", e.target.value as Draft["addressing"])}><option value="neutral">Neutral</option><option value="customer_preference">Use stated preference</option></select></label></div>
        </div></section>
      <section className="agent-card"><div className="agent-card-head"><BookOpen size={19} /><div><h2>Policies and facts</h2></div></div><p className="agent-help">Store delivery, payment, return, and support facts here. Prices and stock come from the live catalog.</p>
        {draft.policies.map((fact, index) => <div className="agent-entry" key={index}><input disabled={role !== "owner"} aria-label={`Policy ${index + 1} topic`} placeholder="Topic, e.g. Delivery" value={fact.topic} onChange={e => edit("policies", draft.policies.map((item, i) => i === index ? { ...item, topic: e.target.value } : item))} /><textarea disabled={role !== "owner"} aria-label={`Policy ${index + 1} content`} placeholder="What should customers know?" value={fact.content} onChange={e => edit("policies", draft.policies.map((item, i) => i === index ? { ...item, content: e.target.value } : item))} /><button disabled={role !== "owner"} aria-label={`Remove policy ${index + 1}`} onClick={() => edit("policies", draft.policies.filter((_, i) => i !== index))}><Trash2 size={15} /></button></div>)}
        {role === "owner" && <button className="button subtle" disabled={draft.policies.length >= 30} onClick={() => edit("policies", [...draft.policies, { topic: "", content: "" }])}><Plus size={14} /> Add policy</button>}
      </section>
      <section className="agent-card"><div className="agent-card-head"><BookOpen size={19} /><div><h2>Frequently asked questions</h2></div></div>
        {draft.faqs.map((faq, index) => <div className="agent-entry" key={index}><input disabled={role !== "owner"} aria-label={`FAQ ${index + 1} question`} placeholder="Customer question" value={faq.question} onChange={e => edit("faqs", draft.faqs.map((item, i) => i === index ? { ...item, question: e.target.value } : item))} /><textarea disabled={role !== "owner"} aria-label={`FAQ ${index + 1} answer`} placeholder="Approved answer" value={faq.answer} onChange={e => edit("faqs", draft.faqs.map((item, i) => i === index ? { ...item, answer: e.target.value } : item))} /><button disabled={role !== "owner"} aria-label={`Remove FAQ ${index + 1}`} onClick={() => edit("faqs", draft.faqs.filter((_, i) => i !== index))}><Trash2 size={15} /></button></div>)}
        {role === "owner" && <button className="button subtle" disabled={draft.faqs.length >= 100} onClick={() => edit("faqs", [...draft.faqs, { question: "", answer: "" }])}><Plus size={14} /> Add FAQ</button>}
      </section>
      <section className="agent-card"><div className="agent-card-head"><Bot size={19} /><div><h2>When a human is needed</h2></div></div><label className="agent-single">Reply for photos, voice notes, or unavailable AI<textarea disabled={role !== "owner"} maxLength={500} value={draft.media_reply} onChange={e => edit("media_reply", e.target.value)} /></label><label className="agent-single">Bangla handoff reply (blank uses default)<textarea disabled={role !== "owner"} maxLength={500} value={draft.media_reply_bangla ?? ""} onChange={e => edit("media_reply_bangla", e.target.value)} /></label><label className="agent-single">English handoff reply (blank uses default)<textarea disabled={role !== "owner"} maxLength={500} value={draft.media_reply_english ?? ""} onChange={e => edit("media_reply_english", e.target.value)} /></label></section>
      {role === "owner" && <div className="agent-publish"><button className="button primary" disabled={busy || !dirty} onClick={save}><Check size={16} /> Save draft</button><span>{dirty ? "Unsaved changes" : config.tested_revision === config.draft_revision && config.draft_revision > 0 ? "Draft tested" : "Test the saved draft"}</span><button className="button" disabled={busy || !canPublish} onClick={() => setConfirmPublish(true)}>Publish version</button><button className="button subtle" disabled={busy || !config.published} onClick={toggleLive}>{config.enabled ? <><CirclePause size={16} /> Pause AI</> : <><CirclePlay size={16} /> Enable AI</>}</button></div>}
      <dialog ref={publishDialog} className="agent-confirm" aria-labelledby="publish-title" onCancel={() => setConfirmPublish(false)}><span className="eyebrow">PUBLISH AGENT</span><h2 id="publish-title">Publish this tested draft?</h2><p>{config.enabled ? "This version will answer live customer conversations immediately." : "This version will be available for customer conversations once you enable AI."}</p><div className="agent-confirm-actions"><button type="button" className="button subtle" disabled={busy} onClick={() => setConfirmPublish(false)}>Cancel</button><button type="button" className="button primary" disabled={busy} onClick={publish}>{busy ? "Publishing…" : "Confirm publish"}</button></div></dialog>
    </div><aside className="agent-preview"><div className="preview-head"><FlaskConical size={18} /><div><strong>Private test phone</strong><span>Draft preview. No message is sent.</span></div><button className="text-button" onClick={() => { setTurns([]); previewState.current = null; setDiagnostics(""); }}>Clear</button></div><div className="preview-thread">{turns.length ? turns.map((turn, index) => <div key={index} className={`preview-bubble ${turn.role}`}>{turn.content}</div>) : <div className="preview-empty"><Bot size={32} /><strong>Start as a customer.</strong><p>Ask about products, delivery, or a tricky situation. Test in Bangla, Banglish, and English.</p></div>}</div><form onSubmit={test} className="preview-composer"><textarea aria-label="Test message" value={prompt} maxLength={1000} onChange={e => setPrompt(e.target.value)} placeholder={dirty ? "Save your draft to test it" : "Ask your assistant…"} disabled={busy || dirty || !draft.business_name.trim()} /><button className="button primary" disabled={busy || dirty || !prompt.trim() || !draft.business_name.trim()}><Send size={16} /> {busy ? "Thinking…" : "Test reply"}</button></form><p className="preview-foot">{diagnostics}</p><p className="preview-foot">AI can make mistakes. Check facts and tone before publishing.</p></aside></div>
  </main>;
}

export default function AgentPage() {
  return <WorkspaceShell>{workspace => <AgentContent key={workspace.tenantId} tenantId={workspace.tenantId} role={workspace.current?.role || "staff"} />}</WorkspaceShell>;
}
