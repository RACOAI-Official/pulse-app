"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Preferences = { email: string; whatsapp: string; email_enabled: boolean; whatsapp_enabled: boolean; language: "bangla" | "english"; email_verified_at?: string; whatsapp_verified_at?: string; whatsapp_consent_at?: string; consent?: boolean };
type Delivery = { id: string; channel: string; status: string; error?: string; created_at: string; summary: { order_id: string } };
type Response = { settings: Preferences; sender: { email: string; whatsapp: string; available: boolean } };

export default function NotificationSettings({ tenantId }: { tenantId: string }) {
  const base = `/tenants/${tenantId}/notifications`;
  const [data, setData] = useState<Response | null>(null);
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [history, setHistory] = useState<Delivery[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [verificationUrl, setVerificationUrl] = useState("");
  const [retry, setRetry] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [value, deliveries] = await Promise.all([api<Response>(base), api<Delivery[]>(`${base}/deliveries`)]);
    setData(value); setDraft({ ...value.settings, consent: !!value.settings.whatsapp_consent_at }); setHistory(deliveries);
  }, [base]);
  useEffect(() => { load().catch(error => setNotice(error.message)); }, [load]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setNotice("");
    try { await work(); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Notification request failed"); }
    finally { setBusy(false); }
  }
  async function verify(channel: string) {
    await act(async () => {
      const result = await api<{ url?: string }>(`${base}/verify`, { method: "POST", body: JSON.stringify({ channel }) });
      setVerificationUrl(result.url || "");
      setNotice(channel === "email" ? "Check your email. After verification, refresh this panel and enable email." : "Open WhatsApp and send the connection code, then refresh this panel and enable WhatsApp.");
    });
  }
  if (!draft || !data) return <section className="settings-section"><h2>Order notifications</h2><p role="status">{notice || "Loading notification settings…"}</p></section>;
  const dirty = draft.email !== data.settings.email || draft.whatsapp !== data.settings.whatsapp || draft.language !== data.settings.language || draft.email_enabled !== data.settings.email_enabled || draft.whatsapp_enabled !== data.settings.whatsapp_enabled || draft.consent !== !!data.settings.whatsapp_consent_at;
  return <section className="settings-section"><h2>Order notifications</h2><p>Pulse sends a summary when an order is first confirmed. Confirmation does not mean payment was received.</p>
    <p className="settings-note">From: {data.sender.email || "Email not configured"} · {data.sender.whatsapp || "WhatsApp not configured"}{!data.sender.available && " · Sending paused by Pulse"}</p>
    <form className="commerce-form-grid" onSubmit={event => { event.preventDefault(); void act(async () => { await api(base, { method: "PUT", body: JSON.stringify(draft) }); setVerificationUrl(""); setNotice("Saved. Verify new destinations before enabling them."); }); }}>
      <label>Notification email<input type="email" maxLength={254} value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value, email_enabled: false })} /></label>
      <label>WhatsApp number<input type="tel" placeholder="+8801712345678" value={draft.whatsapp} onChange={e => setDraft({ ...draft, whatsapp: e.target.value, whatsapp_enabled: false })} /></label>
      <label>Language<select value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value as Preferences["language"] })}><option value="bangla">বাংলা</option><option value="english">English</option></select></label>
      <label><input type="checkbox" checked={!!draft.consent} onChange={e => setDraft({ ...draft, consent: e.target.checked, whatsapp_enabled: e.target.checked && draft.whatsapp_enabled })} /> I agree to receive order notifications from Pulse on this WhatsApp number. Send STOP to opt out.</label>
      <label><input type="checkbox" disabled={!data.settings.email_verified_at || draft.email !== data.settings.email} checked={draft.email_enabled} onChange={e => setDraft({ ...draft, email_enabled: e.target.checked })} /> Email enabled {data.settings.email_verified_at ? "(verified)" : "(verification required)"}</label>
      <label><input type="checkbox" disabled={!data.settings.whatsapp_verified_at || !draft.consent || draft.whatsapp !== data.settings.whatsapp} checked={draft.whatsapp_enabled} onChange={e => setDraft({ ...draft, whatsapp_enabled: e.target.checked })} /> WhatsApp enabled {data.settings.whatsapp_verified_at ? "(verified)" : "(verification required)"}</label>
      <button className="button primary" disabled={busy || !dirty}>Save settings</button>
    </form>
    <div className="commerce-inline">
      <button className="button" disabled={busy || dirty || !draft.email} onClick={() => verify("email")}>Verify email</button>
      <button className="button" disabled={busy || dirty || !draft.whatsapp || !draft.consent} onClick={() => verify("whatsapp")}>Connect WhatsApp</button>
      {(["email", "whatsapp"] as const).map(channel => <button className="button" key={channel} disabled={busy || dirty || !draft[`${channel}_enabled`]} onClick={() => act(async () => { await api(`${base}/test`, { method: "POST", body: JSON.stringify({ channel }) }); setNotice("Test notification queued."); })}>Send {channel} test</button>)}
      <button className="button" disabled={busy} onClick={() => act(load)}>Refresh status</button>
    </div>
    {verificationUrl && <p><a href={verificationUrl} target="_blank" rel="noreferrer">Open WhatsApp to send your verification code</a></p>}
    {notice && <p className="form-notice" role="status">{notice}</p>}
    <h3>Recent deliveries</h3><p className="settings-note">Email “accepted” means the mail server accepted it; inbox delivery is not confirmed.</p>
    {!history.length && <p>No notifications yet.</p>}
    {history.map(item => <div className="health-row" key={item.id}><span>{item.summary.order_id.slice(0, 8)} · {item.channel} · {item.status}{item.error && ` — ${item.error}`}</span>{["failed", "uncertain"].includes(item.status) && <button className="button" disabled={busy} onClick={() => item.status === "uncertain" ? setRetry(item.id) : act(async () => { await api(`${base}/deliveries/${item.id}/retry`, { method: "POST", body: "{}" }); })}>Retry</button>}</div>)}
    {retry && <div role="alert"><p>This notification may already have arrived. Sending again could create a duplicate.</p><button className="button" onClick={() => setRetry(null)}>Cancel</button><button className="button" disabled={busy} onClick={() => act(async () => { await api(`${base}/deliveries/${retry}/retry`, { method: "POST", body: JSON.stringify({ acknowledge_uncertain: true }) }); setRetry(null); })}>Send again</button></div>}
  </section>;
}
