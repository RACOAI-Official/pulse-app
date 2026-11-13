"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AgentEditor from "@/components/AgentEditor";
import ChannelConnect, { PathaoConnect } from "@/components/ChannelConnect";
import PlanPicker from "@/components/PlanPicker";
import BusinessStep from "@/components/onboarding/BusinessStep";
import DeliveryStep from "@/components/onboarding/DeliveryStep";
import InboxIntroStep from "@/components/onboarding/InboxIntroStep";
import { ArrowLeft, ArrowRight, Check, LogOut } from "@/components/icons";
import { api, ChannelConnection, OnboardingStep } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import PulseMark from "@/components/PulseMark";
import { BootLoading } from "@/components/LoadingFeedback";

type Step = Exclude<OnboardingStep, "done">;
type Flow = { step: OnboardingStep; completed: boolean; business_name: string; plan_state: string | null; plan_key: string | null; paid: boolean };

const rail: { key: Step; label: string; hint: string; proOnly?: boolean }[] = [
  { key: "business", label: "Business", hint: "Name your shop" },
  { key: "ai", label: "AI setup", hint: "Voice, policies, preview" },
  { key: "delivery", label: "Delivery", hint: "Fees and timing" },
  { key: "plan", label: "Plan", hint: "Free trial or Pro" },
  { key: "integrations", label: "Integrations", hint: "Connect channels", proOnly: true },
  { key: "inbox", label: "Inbox", hint: "How chats work", proOnly: true },
];
const order = rail.map(item => item.key);

export default function OnboardingPage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const { tenantId, current } = workspace;
  const refreshWorkspace = workspace.refresh;
  const [flow, setFlow] = useState<Flow | null>(null);
  const [step, setStep] = useState<Step>("business");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [moving, setMoving] = useState(false);
  const isOwner = current?.role === "owner";

  const loadFlow = useCallback(() => api<Flow>(`/tenants/${tenantId}/onboarding/flow`).then(next => { setFlow(next); return next; }), [tenantId]);

  useEffect(() => {
    if (!tenantId || !isOwner) return;
    let alive = true;
    const params = new URLSearchParams(window.location.search);
    const paymentReturn = params.get("return");
    const oauthReturn = params.get("pick") || params.get("connected") || params.get("oauth_error");
    if (paymentReturn) window.history.replaceState(null, "", "/onboarding");
    loadFlow().then(async next => {
      if (!alive) return;
      if (next.completed) { await refreshWorkspace(); router.replace("/dashboard"); return; }
      const saved = next.step as Step;
      setStep(oauthReturn && next.paid ? "integrations" : saved);
      if (paymentReturn === "cancel") { setStep("plan"); setNotice("Checkout was cancelled. No payment was taken."); }
    }).catch(caught => setError(caught instanceof Error ? caught.message : "Could not load setup"));
    if (paymentReturn !== "success" && paymentReturn !== "check") return () => { alive = false; };
    // Back from the gateway: wait for the payment webhook, then unlock integrations.
    setNotice("Confirming your payment…");
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries += 1;
      const next = await loadFlow().catch(() => null);
      if (!alive) return;
      if (next?.paid) {
        window.clearInterval(timer);
        await api(`/tenants/${tenantId}/onboarding/flow`, { method: "PUT", body: JSON.stringify({ step: "integrations" }) }).catch(() => {});
        setStep("integrations"); setNotice("Payment confirmed. Welcome to Pro! Now connect your channels.");
      } else if (tries >= 30) {
        window.clearInterval(timer);
        setStep("plan");
        setNotice("Payment is still being verified. This can take a few minutes; refresh this page shortly.");
      }
    }, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [tenantId, isOwner, loadFlow, router, refreshWorkspace]);

  async function go(next: Step) {
    setMoving(true); setError(""); setNotice("");
    try {
      await api(`/tenants/${tenantId}/onboarding/flow`, { method: "PUT", body: JSON.stringify({ step: next }) });
      setStep(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not continue"); }
    finally { setMoving(false); }
  }

  async function chooseFree() {
    setError("");
    try {
      await api(`/tenants/${tenantId}/onboarding/free`, { method: "POST" });
      await refreshWorkspace();
      router.replace("/dashboard");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not start the free trial"); }
  }

  async function finish() {
    await api(`/tenants/${tenantId}/onboarding/complete`, { method: "POST" });
    await refreshWorkspace();
    router.replace("/dashboard");
  }

  if (workspace.loading || (isOwner && !flow && !error)) return <BootLoading message="Preparing your setup…" />;
  if (workspace.error) return <main className="loading-screen"><span className="brand-mark"><PulseMark /></span><p>{workspace.error}</p></main>;
  if (!current) return <main className="loading-screen"><span className="brand-mark"><PulseMark /></span><p>No workspace found for this account.</p></main>;
  if (!isOwner) return <main className="loading-screen"><span className="brand-mark"><PulseMark /></span><p>The owner of {current.tenants.name} is finishing setup.</p></main>;

  const index = order.indexOf(step);
  const savedIndex = flow ? order.indexOf(flow.step as Step) : 0;
  const reachable = (key: Step) => order.indexOf(key) <= Math.max(index, savedIndex) && (!rail.find(item => item.key === key)?.proOnly || flow?.paid);
  const connected = channels.filter(row => row.status === "connected").length;

  return <div className="onb">
    <aside className="onb-rail">
      <div className="auth-brand"><span className="brand-mark"><PulseMark /></span><span>pulse<span className="brand-dot">.</span></span></div>
      <p className="onb-rail-intro">Let’s get <b>{flow?.business_name || current.tenants.name}</b> ready to answer customers.</p>
      <ol className="onb-steps">{rail.map((item, position) => {
        const state = position < index ? "done" : position === index ? "current" : "todo";
        const enabled = reachable(item.key) && item.key !== step && !moving;
        return <li key={item.key} className={`onb-step ${state} ${item.proOnly ? "pro" : ""}`}>
          <button type="button" disabled={!enabled} onClick={() => go(item.key)} aria-current={state === "current" ? "step" : undefined}>
            <span className="onb-step-dot">{state === "done" ? <Check size={13} weight="bold" /> : position + 1}</span>
            <span className="onb-step-copy"><strong>{item.label}{item.proOnly && <em>Pro</em>}</strong><small>{item.hint}</small></span>
          </button>
        </li>;
      })}</ol>
      <button type="button" className="text-button onb-signout" onClick={workspace.signOut}><LogOut size={15} /> Sign out</button>
    </aside>

    <main className={`onb-stage onb-stage-${step}`}>
      <div className="onb-progress" aria-hidden="true"><i style={{ width: `${((index + 1) / order.length) * 100}%` }} /></div>
      <p className="onb-count">Step {index + 1} of {order.length}</p>
      {error && <p className="form-notice plan-banner warn" role="alert">{error}</p>}
      {notice && <p className="form-notice plan-banner" role="status">{notice}</p>}

      <div className="onb-panel" key={step}>
        {step === "business" && <BusinessStep tenantId={tenantId} initialName={flow?.business_name || current.tenants.name} onDone={() => { void loadFlow(); void go("ai"); }} />}
        {step === "ai" && <div className="onb-wide">
          <AgentEditor tenantId={tenantId} role="owner" variant="onboarding" onContinue={() => go("delivery")} />
          <div className="onb-actions onb-under"><button className="button subtle" onClick={() => go("business")}><ArrowLeft size={16} /> Back</button></div>
        </div>}
        {step === "delivery" && <DeliveryStep tenantId={tenantId} onBack={() => go("ai")} onDone={() => go("plan")} />}
        {step === "plan" && <div className="onb-wide">
          {flow?.paid
            ? <section className="onb-card onb-narrow"><h1>You’re on Pro</h1><p>Your plan is active. Connect your channels next.</p>
                <div className="onb-actions"><button className="button subtle" onClick={() => go("delivery")}><ArrowLeft size={16} /> Back</button><button className="button primary" onClick={() => go("integrations")}>Connect channels <ArrowRight size={16} /></button></div></section>
            : <>
                <PlanPicker tenantId={tenantId} role="owner" returnTo="onboarding" onFree={chooseFree} />
                <div className="onb-actions onb-under"><button className="button subtle" onClick={() => go("delivery")}><ArrowLeft size={16} /> Back</button></div>
              </>}
        </div>}
        {step === "integrations" && <section className="onb-card onb-integrations">
          <h1>Connect where your customers message you</h1>
          <p>Sign in with Meta to link your Page, Instagram account, or WhatsApp number. Pulse never sees your password.</p>
          <ChannelConnect tenantId={tenantId} isOwner paid={!!flow?.paid} returnTo="onboarding" onChange={setChannels} />
          <PathaoConnect tenantId={tenantId} isOwner paid={!!flow?.paid} />
          <div className="onb-actions">
            <button className="button subtle" onClick={() => go("plan")}><ArrowLeft size={16} /> Back</button>
            <div className="onb-actions-end">
              {!connected && <button className="text-button" onClick={() => go("inbox")}>I’ll connect later</button>}
              <button className="button primary" disabled={!connected || moving} onClick={() => go("inbox")}>Continue <ArrowRight size={16} /></button>
            </div>
          </div>
        </section>}
        {step === "inbox" && <InboxIntroStep onFinish={finish} />}
      </div>
    </main>
  </div>;
}
