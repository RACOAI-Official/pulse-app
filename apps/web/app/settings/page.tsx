"use client";

import { FormEvent, useEffect, useState } from "react";
import { Camera, Mail, MessageCircle, ShieldCheck, Users, Send, Activity } from "@/components/icons";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api, ChannelConnection } from "@/lib/api";

function SettingsContent({ tenantId, role }: { tenantId: string; role: "owner" | "manager" | "staff" }) {
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [operations, setOperations] = useState<{ failed_inbound: { id: string; channel: string; last_error: string | null }[]; problem_sends: { id: string; delivery_state: string }[] }>({ failed_inbound: [], problem_sends: [] });
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ChannelConnection[]>(`/tenants/${tenantId}/channels`).then(setChannels)
      .catch(error => setNotice(error instanceof Error ? error.message : "Could not load channels"));
    api<typeof operations>(`/tenants/${tenantId}/operations`).then(setOperations)
      .catch(() => {});
    api<Record<string, number>>(`/tenants/${tenantId}/usage`).then(setUsage).catch(() => {});
  }, [tenantId]);

  async function invite(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      await api(`/tenants/${tenantId}/invites`, { method: "POST", body: JSON.stringify({ email }) });
      setNotice(`Invitation sent to ${email}`); setEmail("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Invitation failed"); }
    finally { setBusy(false); }
  }

  const channelInfo = [
    { key: "messenger", label: "Messenger", icon: MessageCircle, caption: "Facebook Page messaging" },
    { key: "instagram", label: "Instagram", icon: Camera, caption: "Instagram Professional direct messages" },
    { key: "whatsapp", label: "WhatsApp", icon: Send, caption: "WhatsApp Cloud API test number" },
  ] as const;

  return <main className="settings-page"><div className="settings-intro"><span className="eyebrow">WORKSPACE CONFIGURATION</span><h1>Keep your team connected.</h1><p>Channel credentials are managed by your Pulse operator. Owners can invite staff into this shared inbox.</p></div>
    <section className="settings-section"><div className="settings-section-heading"><div><span className="eyebrow">01 / INTEGRATIONS</span><h2>Connected channels</h2></div><ShieldCheck size={20} /></div>
      <div className="channel-grid">{channelInfo.map(info => { const row = channels.find(item => item.channel === info.key); const Icon = info.icon; return <div className="channel-tile" key={info.key}><div className={`channel-icon ${info.key}`}><Icon size={23} /></div><div><strong>{info.label}</strong><p>{row?.display_name || info.caption}</p></div><span className={row?.status === "connected" ? "status connected" : "status"}>{row?.status === "connected" ? "Connected" : "Not connected"}</span></div>; })}</div>
      <p className="settings-note">Connect or rotate credentials with the operator CLI. Tokens are encrypted and never sent to the browser.</p>
    </section>
    <section className="settings-section team-section"><div className="settings-section-heading"><div><span className="eyebrow">02 / ACCESS</span><h2>Team invitations</h2></div><Users size={20} /></div>
      {role === "owner" ? <form className="invite-form" onSubmit={invite}><label>Staff email address<div className="input-shell"><Mail size={18} /><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@company.com" /></div></label><button type="submit" className="button primary" disabled={busy}>{busy ? "Sending…" : "Send invitation"}<Send size={16} /></button></form> : <p className="settings-note">Only workspace owners can invite staff.</p>}
      {notice && <div className="form-notice" role="status">{notice}</div>}
    </section>
    <section className="settings-section"><div className="settings-section-heading"><div><span className="eyebrow">03 / HEALTH</span><h2>Delivery activity</h2></div><Activity size={20} /></div>
      <div className="health-row"><span>Failed inbound events</span><strong>{operations.failed_inbound.length}</strong></div>
      <div className="health-row"><span>Failed or uncertain replies</span><strong>{operations.problem_sends.length}</strong></div>
      {operations.failed_inbound.slice(0, 5).map(item => <p className="settings-note" key={item.id}>{item.channel}: {item.last_error || "Processing failed"}</p>)}
      <p className="settings-note">Uncertain replies should be checked in the Meta channel before another message is sent.</p>
    </section>
    <section className="settings-section"><div className="settings-section-heading"><div><span className="eyebrow">04 / USAGE</span><h2>Last 30 days</h2></div><Activity size={20} /></div>{(["inbound_message", "ai_reply", "human_reply", "confirmed_order"] as const).map(kind => <div className="health-row" key={kind}><span>{kind.replaceAll("_", " ")}</span><strong>{usage[kind] || 0}</strong></div>)}<p className="settings-note">These are internal activity counts, not a bill. Model token and cost metering are not yet available.</p></section>
  </main>;
}

export default function SettingsPage() {
  return <WorkspaceShell>{workspace => <SettingsContent key={workspace.tenantId} tenantId={workspace.tenantId} role={workspace.current?.role || "staff"} />}</WorkspaceShell>;
}
