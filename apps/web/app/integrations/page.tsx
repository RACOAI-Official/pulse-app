"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api, ChannelConnection } from "@/lib/api";

const providers = [
  ["Facebook Messenger", "messenger", "Meta Page direct messages"],
  ["Instagram", "instagram", "Professional account direct messages"],
  ["WhatsApp", "whatsapp", "Cloud API business number"],
] as const;
const later = ["Shopify", "WooCommerce", "Custom Store", "Google Sheets", "Nuport", "Website Chatbot"];
type MerchantConnection = { provider: "pathao"; environment?: string; status: string; updated_at?: string };
const credentialFields = ["client_id", "client_secret", "username", "password"] as const;

function IntegrationsContent({ tenantId, role }: { tenantId: string; role: string }) {
  const [rows, setRows] = useState<ChannelConnection[]>([]);
  const [merchants, setMerchants] = useState<MerchantConnection[]>([]);
  const [environment, setEnvironment] = useState("sandbox");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => { api<ChannelConnection[]>(`/tenants/${tenantId}/channels`).then(setRows).catch(caught => setError(caught.message)); }, [tenantId]);
  useEffect(() => { api<MerchantConnection[]>(`/tenants/${tenantId}/integrations`).then(setMerchants).catch(caught => setError(caught.message)); }, [tenantId]);
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      await api(`/tenants/${tenantId}/integrations/pathao`, { method: "PUT", body: JSON.stringify({ environment, credentials }) });
      setMerchants(await api<MerchantConnection[]>(`/tenants/${tenantId}/integrations`));
      setCredentials({});
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save connection"); }
  }
  return <main className="commerce-page"><header className="commerce-heading"><div><h1>Integrations</h1><p>Meta sandbox channels are managed through the Pulse operator until self-serve authorization is available.</p></div></header>
    {error && <p className="form-notice" role="alert">{error}</p>}
    <div className="integration-grid">{providers.map(([name, key, description]) => { const row = rows.find(item => item.channel === key); return <section className="commerce-card" key={key}><h2>{name}</h2><p>{description}</p><span className={`commerce-state ${row?.status === "connected" ? "completed" : "draft"}`}>{row?.status === "connected" ? "Connected" : "Not connected"}</span>{row && <p>Asset: {row.display_name}</p>}<p className="settings-note">The operator must configure your app, webhook subscription, asset ID, and token. Connection is verified only after a test message round trip.</p></section>; })}</div>
    <div className="integration-grid">{merchants.map(item => <section className="commerce-card" key={item.provider}><h2>Pathao Courier</h2><p>Optional. Orders can be handed to Pathao or any other courier manually from the order page without connecting. Connecting prepares for automatic booking, coming later.</p><span className={`commerce-state ${item.status === "verified" ? "completed" : "draft"}`}>{item.status.replaceAll("_", " ")}</span><p className="settings-note">{item.status === "verified" ? "Merchant connection verified." : "Not required. Manual courier handoff works without a connection."}</p></section>)}</div>
    {role === "owner" && <section className="commerce-card"><h2>Pathao credentials</h2><p>Credentials are encrypted on the server. Saving marks a connection unverified until provider testing is completed.</p><form onSubmit={save} className="commerce-form-grid"><label>Environment<select value={environment} onChange={event => setEnvironment(event.target.value)}><option value="sandbox">Sandbox</option><option value="live">Live</option></select></label>{credentialFields.map(field => <label key={field}>{field.replaceAll("_", " ")}<input required type={field.includes("secret") || field.includes("pass") ? "password" : "text"} autoComplete="off" value={credentials[field] || ""} onChange={event => setCredentials({ ...credentials, [field]: event.target.value })} /></label>)}<div className="wide"><button type="submit" className="button primary">Save unverified connection</button></div></form></section>}
    <section className="commerce-card"><h2>Additional systems</h2><p>These integrations need their own provider accounts and synchronization rules.</p><div className="future-tags">{later.map(name => <span key={name}>{name}</span>)}</div><Link href="/settings" className="text-button">View workspace settings</Link></section>
  </main>;
}

export default function IntegrationsPage() {
  return <WorkspaceShell>{workspace => <IntegrationsContent key={workspace.tenantId} tenantId={workspace.tenantId} role={workspace.current?.role || "staff"} />}</WorkspaceShell>;
}
