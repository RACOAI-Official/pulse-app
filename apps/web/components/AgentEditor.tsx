"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, BookOpen, Bot, Check, CirclePause, CirclePlay, FlaskConical, Plus, Send, Trash2 } from "@/components/icons";
import styles from "@/app/studio.module.css";
import { api } from "@/lib/api";
import { SectionSkeleton } from "@/components/LoadingFeedback";

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

type Props = {
  tenantId: string;
  role: "owner" | "manager" | "staff";
  /** "onboarding" hides publish/live controls and offers Continue once the draft is saved. */
  variant?: "page" | "onboarding";
  onContinue?: () => void;
};

export default function AgentEditor({ tenantId, role, variant = "page", onContinue }: Props) {
  const onboarding = variant === "onboarding";
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [testError, setTestError] = useState<{ prompt: string; message: string } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
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
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [turns, pending, testError]);

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
      setSaved(JSON.stringify(draft)); clearTest();
      setConfig(current => current ? { ...current, draft_revision: result.draft_revision,
        tested_revision: 0, draft } : current);
      setNotice(onboarding ? "Draft saved. Try it in the test phone, then continue." : "Draft saved. Test it before publishing.");
    });
  }

  function clearTest() { setTurns([]); setTestError(null); setPending(null); }

  async function sendTest(question: string) {
    if (!question || pending || dirty || !config || !draft?.business_name.trim()) return;
    setPending(question); setTestError(null); setPrompt("");
    try {
      const result = await api<{ response: string; tested_revision: number | null }>(`${base}/test`, {
        method: "POST", body: JSON.stringify({ prompt: question, history: turns.slice(-8) }),
      });
      setTurns(current => [...current, { role: "user", content: question }, { role: "assistant", content: result.response }]);
      if (result.tested_revision !== null) {
        setConfig(current => current ? { ...current, tested_revision: result.tested_revision! } : current);
      } else setNotice("The draft changed while testing. Test the latest saved version.");
    } catch (error) {
      setTestError({ prompt: question, message: error instanceof Error ? error.message : "Couldn't get a reply" });
    } finally {
      setPending(null);
    }
  }

  function test(event: FormEvent) {
    event.preventDefault();
    void sendTest(prompt.trim());
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

  if (loading) return <main className={`${styles.studio} agent-page`}><header className="agent-heading"><div><h1>Your assistant</h1></div></header><SectionSkeleton variant="agent" /></main>;
  if (!draft || !config) return <main className="agent-page"><p role="alert">{notice || "Agent configuration unavailable"}</p></main>;
  return <main className={`${styles.studio} agent-page`}>
    <header className="agent-heading"><div><h1>{onboarding ? "Teach your assistant" : "Your assistant"}</h1><p>{onboarding ? "Describe your business and voice, save, then chat with the test phone to see how it replies." : "The draft stays private until you publish it. Customer replies always use current catalog data."}</p></div>{!onboarding && <div className="agent-state"><span className={config.enabled ? "live-dot" : "paused-dot"} />{config.enabled ? "Live replies on" : "Live replies off"}<small>Published v{config.published_version || "—"}</small></div>}</header>
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
      {role === "owner" && <div className="agent-publish"><button className="button primary" disabled={busy || !dirty} onClick={save}><Check size={16} /> Save draft</button><span>{dirty ? "Unsaved changes" : onboarding ? (config.draft_revision > 0 ? "Saved" : "Save to continue") : config.tested_revision === config.draft_revision && config.draft_revision > 0 ? "Draft tested" : "Test the saved draft"}</span>{onboarding ? <button className="button primary" disabled={busy || dirty || config.draft_revision < 1 || !draft.business_name.trim()} onClick={onContinue}>Continue <ArrowRight size={16} /></button> : <><button className="button" disabled={busy || !canPublish} onClick={() => setConfirmPublish(true)}>Publish version</button><button className="button subtle" disabled={busy || !config.published} onClick={toggleLive}>{config.enabled ? <><CirclePause size={16} /> Pause AI</> : <><CirclePlay size={16} /> Enable AI</>}</button></>}</div>}
      {!onboarding && <dialog ref={publishDialog} className="agent-confirm" aria-labelledby="publish-title" onCancel={() => setConfirmPublish(false)}><span className="eyebrow">PUBLISH AGENT</span><h2 id="publish-title">Publish this tested draft?</h2><p>{config.enabled ? "This version will answer live customer conversations immediately." : "This version will be available for customer conversations once you enable AI."}</p><div className="agent-confirm-actions"><button type="button" className="button subtle" disabled={busy} onClick={() => setConfirmPublish(false)}>Cancel</button><button type="button" className="button primary" disabled={busy} onClick={publish}>{busy ? "Publishing…" : "Confirm publish"}</button></div></dialog>}
    </div><aside className="test-phone" aria-label="Private test phone">
      <div className="test-phone-label"><FlaskConical size={16} /><strong>Private test phone</strong><span>Draft preview · nothing is sent</span></div>
      <div className="test-phone-device">
        <div className="test-phone-screen">
          <header className="test-phone-head"><span className="test-phone-avatar" aria-hidden="true">{(draft.business_name.trim() || "P").charAt(0).toUpperCase()}</span><div><strong>{draft.business_name.trim() || "Your business"}</strong><span>{pending ? "typing…" : dirty ? "Save your draft to test" : `Test mode · draft ${config.draft_revision || "—"}`}</span></div><button type="button" className="test-phone-clear" aria-label="Clear test chat" title="Clear chat" disabled={!turns.length && !testError} onClick={clearTest}><Trash2 size={16} /></button></header>
          <div className="test-phone-thread" ref={threadRef} aria-live="polite">
            {turns.length || pending || testError ? <>
              {turns.map((turn, index) => <div key={index} className={`test-bubble ${turn.role}`}>{turn.content}</div>)}
              {pending && <><div className="test-bubble user">{pending}</div><div className="test-bubble assistant typing" aria-label="Assistant is typing"><i /><i /><i /></div></>}
              {testError && <><div className="test-bubble user failed">{testError.prompt}</div><div className="test-bubble system" role="alert"><span>{testError.message}</span><button type="button" onClick={() => { const retry = testError.prompt; void sendTest(retry); }}>Retry</button></div></>}
            </> : <div className="test-phone-empty"><Bot size={28} /><strong>Chat as a customer</strong><p>Ask about products, prices or delivery. Try Bangla, Banglish and English.</p></div>}
          </div>
          <form onSubmit={test} className="test-phone-composer"><textarea rows={1} aria-label="Test message" value={prompt} maxLength={1000} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendTest(prompt.trim()); } }} placeholder={dirty ? "Save your draft to test it" : "Message…"} disabled={!!pending || dirty || !draft.business_name.trim()} /><button type="submit" aria-label="Send test message" disabled={!!pending || dirty || !prompt.trim() || !draft.business_name.trim()}><Send size={17} /></button></form>
        </div>
        <Image className="test-phone-frame" src="/phone-frame.svg" alt="" aria-hidden="true" width={752} height={1484} unoptimized />
      </div>
      <p className="test-phone-foot">AI can make mistakes. Check facts and tone before publishing.</p>
    </aside></div>
  </main>;
}
