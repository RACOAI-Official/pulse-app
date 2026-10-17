"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api, ChannelConnection } from "@/lib/api";

const providers = [
  ["Facebook Messenger", "messenger", "Meta Page direct messages"],
  ["Instagram", "instagram", "Professional account direct messages"],
  ["WhatsApp", "whatsapp", "Cloud API business number"],
] as const;
const later = ["Shopify", "WooCommerce", "Custom Store", "Google Sheets", "Steadfast", "Pathao", "Nuport", "Website Chatbot"];

function IntegrationsContent({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<ChannelConnection[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { api<ChannelConnection[]>(`/tenants/${tenantId}/channels`).then(setRows).catch(caught => setError(caught.message)); }, [tenantId]);
  return <main className="commerce-page"><header className="commerce-heading"><div><span className="eyebrow">CONNECTED SYSTEMS</span><h1>Integrations</h1><p>Meta sandbox channels are managed through the Pulse operator until self-serve authorization is available.</p></div></header>
    {error && <p className="form-notice" role="alert">{error}</p>}
    <div className="integration-grid">{providers.map(([name, key, description]) => { const row = rows.find(item => item.channel === key); return <section className="commerce-card" key={key}><span className="eyebrow">META CHANNEL</span><h2>{name}</h2><p>{description}</p><span className={`commerce-state ${row?.status === "connected" ? "completed" : "draft"}`}>{row?.status === "connected" ? "Connected" : "Not connected"}</span>{row && <p>Asset: {row.display_name}</p>}<p className="settings-note">The operator must configure your app, webhook subscription, asset ID, and token. Connection is verified only after a test message round trip.</p></section>; })}</div>
    <section className="commerce-card"><span className="eyebrow">FUTURE CONNECTORS</span><h2>Additional systems</h2><p>These integrations need their own provider accounts and synchronization rules.</p><div className="future-tags">{later.map(name => <span key={name}>{name}</span>)}</div><Link href="/settings" className="text-button">View workspace settings →</Link></section>
  </main>;
}

export default function IntegrationsPage() {
  return <WorkspaceShell>{workspace => <IntegrationsContent key={workspace.tenantId} tenantId={workspace.tenantId} />}</WorkspaceShell>;
}
