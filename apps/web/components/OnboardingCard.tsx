"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Readiness = { business_details: boolean; product_active: boolean; agent_published: boolean; channel_configured: boolean; inbound_verified: boolean; ai_enabled: boolean };

const steps = [
  ["business_details", "Tell Pulse about your business", "/agent"],
  ["product_active", "Add an active product", "/catalog"],
  ["agent_published", "Test and publish your agent", "/agent"],
  ["channel_configured", "Connect a Meta sandbox channel", "/integrations"],
  ["inbound_verified", "Verify an inbound test message", "/inbox"],
] as const;

export default function OnboardingCard({ tenantId }: { tenantId: string }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  useEffect(() => { api<Readiness>(`/tenants/${tenantId}/onboarding`).then(setReadiness).catch(() => {}); }, [tenantId]);
  if (!readiness) return null;
  const done = steps.filter(([key]) => readiness[key]).length;
  return <section className="onboarding-card"><div><span className="eyebrow">YOUR PULSE SETUP</span><h2>{done} of {steps.length} steps complete</h2><p>Finish the sandbox checklist before enabling customer replies.</p></div><div className="onboarding-steps">{steps.map(([key, label, href]) => <Link href={href} key={key}><span className={readiness[key] ? "step-done" : ""}>{readiness[key] ? "✓" : "○"}</span>{label}<span>→</span></Link>)}</div></section>;
}
