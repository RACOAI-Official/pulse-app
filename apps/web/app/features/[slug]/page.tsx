"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import WorkspaceShell from "@/components/WorkspaceShell";

const features: Record<string, { title: string; category: string; description: string; dependency: string }> = {
  "ai-calls": { title: "AI Calls", category: "Calls", description: "Inbound and outbound voice conversations.", dependency: "Telephony service, recording consent, and voice-agent evaluation are required." },
  recordings: { title: "Recordings", category: "Calls", description: "Voice call history and recordings.", dependency: "Call integration and a retention policy are required." },
  adsflow: { title: "AdsFlow", category: "Marketing", description: "Campaign spend and attributed conversations and orders.", dependency: "Meta Ads permissions and an attribution model are required." },
  "creative-studio": { title: "Creative Studio", category: "Marketing", description: "Create and review campaign assets.", dependency: "Asset-generation and approval workflows are not configured." },
  "ad-launcher": { title: "Ad Launcher", category: "Marketing", description: "Publish approved campaigns.", dependency: "An Ads account connection and spending controls are required." },
  broadcast: { title: "Broadcast", category: "Marketing", description: "Send opted-in campaign messages.", dependency: "Audience consent, approved templates, and per-channel sending limits are required." },
  "chat-summary": { title: "Chat Summary", category: "Insights", description: "A concise catch-up for each customer conversation.", dependency: "Summarization and quality checks will follow the conversation and ticket workflows." },
  tutorials: { title: "Tutorials", category: "Help", description: "Guides for connecting channels and training Pulse.", dependency: "Step-by-step product tutorials will be published after sandbox verification." },
  support: { title: "Support", category: "Help", description: "Get help with your workspace.", dependency: "A dedicated support channel is not configured. Ask your Pulse operator for help." },
};

export default function FeaturePage() {
  const { slug } = useParams<{ slug: string }>();
  if (slug === "parcels") {
    return <WorkspaceShell>{() => <main className="commerce-page"><header className="commerce-heading"><div><h1>Parcels</h1><p>Prepare a Pathao shipment from a confirmed BDT order.</p></div></header><section className="commerce-card"><h2>Courier workflow</h2><p>Open the order, review the cash-on-delivery balance, and record the consignment and tracking codes from the Pathao merchant panel. Automatic courier booking is waiting for merchant API verification.</p><Link href="/orders" className="button primary">Open orders</Link></section></main>}</WorkspaceShell>;
  }
  const feature = features[slug];
  return <WorkspaceShell>{() => <main className="commerce-page"><div className="commerce-heading"><div><h1>{feature?.title || "Feature unavailable"}</h1><p>{feature?.description || "This page does not exist."}</p></div></div><section className="commerce-card"><h2>{feature?.dependency || "Choose an item from the sidebar."}</h2><p>This area has no sample data or simulated actions.</p><Link href="/dashboard" className="button subtle">Back to dashboard</Link></section></main>}</WorkspaceShell>;
}
