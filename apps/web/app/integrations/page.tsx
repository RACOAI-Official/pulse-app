"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ChannelConnect, { PathaoConnect } from "@/components/ChannelConnect";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api } from "@/lib/api";
import { SectionSkeleton } from "@/components/LoadingFeedback";

const later = ["Shopify", "WooCommerce", "Custom Store", "Google Sheets", "Nuport", "Website Chatbot"];

function IntegrationsContent({ tenantId, role }: { tenantId: string; role: string }) {
  const [paid, setPaid] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ paid: boolean }>(`/tenants/${tenantId}/onboarding/flow`).then(flow => setPaid(flow.paid)).catch(() => setPaid(false));
  }, [tenantId]);
  const isOwner = role === "owner";
  if (paid === null) return <main className="commerce-page"><header className="commerce-heading"><h1>Integrations</h1></header><SectionSkeleton /></main>;
  return <main className="commerce-page"><header className="commerce-heading"><div><h1>Integrations</h1><p>Connect your Meta channels so Pulse can answer customers and fill your Inbox.</p></div>
    {paid === false && isOwner && <Link href="/plan" className="button primary">Upgrade to Pro</Link>}</header>
    {paid !== null && <ChannelConnect tenantId={tenantId} isOwner={isOwner} paid={paid} returnTo="integrations" />}
    {paid !== null && <PathaoConnect tenantId={tenantId} isOwner={isOwner} paid={paid} />}
    <section className="commerce-card"><h2>Additional systems</h2><p>These integrations need their own provider accounts and synchronization rules.</p><div className="future-tags">{later.map(name => <span key={name}>{name}</span>)}</div><Link href="/settings" className="text-button">View workspace settings</Link></section>
  </main>;
}

export default function IntegrationsPage() {
  return <WorkspaceShell>{workspace => <IntegrationsContent key={workspace.tenantId} tenantId={workspace.tenantId} role={workspace.current?.role || "staff"} />}</WorkspaceShell>;
}
