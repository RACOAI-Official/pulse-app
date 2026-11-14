"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check } from "@/components/icons";
import { api } from "@/lib/api";
import { SectionSkeleton } from "@/components/LoadingFeedback";
import { CURRENCIES, type Currency, detectCurrency, formatMoney, rememberCurrency } from "@/lib/currency";

type PlanKey = "pro" | "enterprise";
type Interval = "month" | "year";
type Plan = { key: PlanKey; name: string; credits: number; conversations_per_day: number; prices: Record<Interval, Record<Currency, number>> };
type Account = {
  plan_key: PlanKey | null; pending_plan_key: PlanKey | null; billing_interval: Interval | null; currency_code: Currency | null;
  provider: "stripe" | "sslcommerz" | null; state: "inactive" | "trialing" | "active" | "expired" | "review";
  auto_renew: boolean; trial_ends_at: string | null; term_start: string | null; paid_through: string | null;
};
type Credits = { allowance: number; balance: number; bonus_balance?: number; cycle_start: string; cycle_end: string };
type Invoice = { id: string; plan_key: PlanKey; billing_interval: Interval; kind: "purchase" | "upgrade"; provider: string; amount_minor: number; currency_code: string; state: string; period_start: string | null; period_end: string | null; paid_at: string | null; created_at: string };
type Status = {
  account: Account | null; credits: Credits | null; invoices: Invoice[]; access: boolean;
  providers: { stripe: boolean; sslcommerz: boolean }; policies: { terms: string; privacy: string; refund: string };
  upgrade_quote: { amount_minor: number; currency_code: Currency; estimate: boolean } | null; plans: Plan[];
};

const DAY = 86400000;
const emptyContact = { billing_name: "", billing_phone: "", billing_address: "", billing_city: "", billing_postcode: "" };

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

function message(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

type Props = {
  tenantId: string;
  role: string;
  /** Where the payment gateway sends the owner back to. */
  returnTo?: "plan" | "onboarding";
  /** Onboarding only: keep the free trial (AI setup + preview, no integrations). */
  onFree?: () => void;
};

export default function PlanPicker({ tenantId, role, returnTo = "plan", onFree }: Props) {
  const onboarding = returnTo === "onboarding";
  const [status, setStatus] = useState<Status | null>(null);
  const [interval, setTermInterval] = useState<Interval>("month");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [selected, setSelected] = useState<PlanKey | null>(null);
  const [consent, setConsent] = useState(false);
  const [autoRenew, setAutoRenew] = useState(true);
  const [contact, setContact] = useState(emptyContact);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isOwner = role === "owner";

  const refresh = useCallback(() => api<Status>(`/tenants/${tenantId}/billing`).then(next => { setStatus(next); return next; }), [tenantId]);
  useEffect(() => { setCurrency(detectCurrency()); }, []);
  useEffect(() => { refresh().catch(caught => setError(message(caught, "Could not load your plan"))); }, [refresh]);
  useEffect(() => {
    // Onboarding handles its own gateway return.
    if (onboarding) return;
    const result = new URLSearchParams(window.location.search).get("return");
    if (!result) return;
    window.history.replaceState(null, "", "/plan");
    if (result === "cancel") { setNotice("Checkout was cancelled. No payment was taken."); return; }
    setNotice("Verifying your payment with the gateway…");
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries += 1;
      const next = await refresh().catch(() => null);
      const latest = next?.invoices[0];
      if (latest && Date.now() - new Date(latest.created_at).getTime() < 15 * 60000 && latest.state !== "pending") {
        setNotice(latest.state === "paid" ? "Payment confirmed. Your plan and credits are updated." : "Payment received and held for review. We will email you once it clears.");
        window.clearInterval(timer);
      } else if (tries >= 10) {
        setNotice("Payment is still being verified. This page updates automatically once the gateway confirms it.");
        window.clearInterval(timer);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh, onboarding]);

  const account = status?.account ?? null;
  const credits = status?.credits ?? null;
  const now = Date.now();
  const paidActive = account?.state === "active" && !!account.paid_through && new Date(account.paid_through).getTime() > now;
  const trialActive = account?.state === "trialing" && !!account.trial_ends_at && new Date(account.trial_ends_at).getTime() > now;
  const daysLeft = paidActive ? Math.ceil((new Date(account!.paid_through!).getTime() - now) / DAY) : 0;
  const sslRenewalOpen = paidActive && account?.provider === "sslcommerz" && daysLeft <= 7;
  const renewPlan = account?.pending_plan_key || account?.plan_key || null;
  const used = credits && credits.allowance > 0 ? Math.min(1, Math.max(0, (credits.allowance - credits.balance) / credits.allowance)) : 0;
  const policiesReady = Boolean(status?.policies.terms && status.policies.privacy && status.policies.refund);

  // An active plan is billed in its own currency and interval; show those while it lasts.
  useEffect(() => {
    if (paidActive && account?.currency_code && account.billing_interval) {
      setCurrency(account.currency_code);
      setTermInterval(account.billing_interval);
    }
  }, [paidActive, account?.currency_code, account?.billing_interval]);

  const checkoutCurrency: Currency = sslRenewalOpen ? "BDT" : currency;
  const gateway = checkoutCurrency === "BDT" ? "sslcommerz" : "stripe";
  const gatewayReady = Boolean(status?.providers[gateway]);

  function pickCurrency(next: Currency) { setCurrency(next); rememberCurrency(next); }

  async function act<T>(fn: () => Promise<T>, fallback: string) {
    setBusy(true); setError(""); setNotice("");
    try { return await fn(); }
    catch (caught) { setError(message(caught, fallback)); return null; }
    finally { setBusy(false); }
  }

  async function checkout(plan: PlanKey) {
    const result = await act(() => api<{ checkout_url: string }>(`/tenants/${tenantId}/billing/checkout`, {
      method: "POST", body: JSON.stringify({ plan, interval, currency: checkoutCurrency, auto_renew: gateway === "stripe" && autoRenew, accepted_policies: consent, return_to: returnTo, ...contact }),
    }), "Could not start checkout");
    if (result) window.location.assign(result.checkout_url);
  }

  async function upgrade() {
    const quote = status?.upgrade_quote;
    const amount = quote ? formatMoney(quote.amount_minor, quote.currency_code) : "the prorated difference";
    if (!window.confirm(`Upgrade to Enterprise now? You pay ${quote?.estimate ? "about " : ""}${amount} for the rest of this term and get the extra credits immediately.`)) return;
    const result = await act(() => api<{ checkout_url?: string; status?: string }>(`/tenants/${tenantId}/billing/upgrade`, { method: "POST" }), "Upgrade failed");
    if (result?.checkout_url) window.location.assign(result.checkout_url);
    else if (result) { await refresh(); setNotice("Upgraded to Enterprise. Your extra credits are ready."); }
  }

  async function downgrade() {
    if (!window.confirm(`Switch to Pro when this term ends on ${date(account?.paid_through)}? You keep Enterprise until then.`)) return;
    if (await act(() => api(`/tenants/${tenantId}/billing/downgrade`, { method: "POST" }), "Could not schedule the change")) {
      await refresh(); setNotice(`Pro starts at your next renewal on ${date(account?.paid_through)}.`);
    }
  }

  async function changeRenewal(enabled: boolean) {
    if (!enabled && !window.confirm(`Stop auto-renewal? Your plan stays active until ${date(account?.paid_through)}.`)) return;
    if (await act(() => api(`/tenants/${tenantId}/billing/${enabled ? "auto-renew?enabled=true" : "cancel"}`, { method: "POST" }), "Could not update renewal")) await refresh();
  }

  const banners = useMemo(() => {
    const list: { tone: "warn" | "info"; text: string }[] = [];
    if (!status) return list;
    if (!status.access) list.push({ tone: "warn", text: "Your workspace has no active plan. AI replies, sending, and edits are paused until you choose a plan." });
    if (trialActive) list.push({ tone: "info", text: `Free trial: ${credits?.balance ?? 0} AI credits left, ends ${date(account?.trial_ends_at)}. Choose a plan anytime — your trial ends when it starts.` });
    const bonus = credits?.bonus_balance ?? 0;
    if (status.access && credits && credits.allowance > 0 && credits.balance === 0 && bonus > 0) list.push({ tone: "info", text: `Plan credits used up. AI replies now use your ${bonus.toLocaleString()} bonus credits until the reset on ${date(credits.cycle_end)}.` });
    else if (status.access && credits && credits.allowance > 0 && credits.balance === 0) list.push({ tone: "warn", text: `AI credits used up. AI auto-replies are paused and new messages wait in the Inbox for your team. Credits reset on ${date(credits.cycle_end)}${account?.plan_key === "pro" && paidActive ? ", or upgrade to Enterprise for more now" : ""}.` });
    else if (status.access && used >= 0.8) list.push({ tone: "warn", text: `You have used ${Math.round(used * 100)}% of this month's AI credits.` });
    if (sslRenewalOpen) list.push({ tone: "warn", text: `Your ${account?.billing_interval === "year" ? "yearly" : "monthly"} term ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Renew now so service continues without a gap.` });
    if (account?.pending_plan_key && paidActive) list.push({ tone: "info", text: `Switching to ${account.pending_plan_key === "pro" ? "Pro" : "Enterprise"} at renewal on ${date(account.paid_through)}.` });
    return list;
  }, [status, trialActive, credits, account, paidActive, used, sslRenewalOpen, daysLeft]);

  function cardAction(plan: Plan) {
    if (!isOwner) return null;
    if (paidActive && account?.plan_key === plan.key) {
      if (sslRenewalOpen && renewPlan === plan.key) return <button className="button primary wide" disabled={busy} onClick={() => setSelected(plan.key)}>Renew {plan.name}</button>;
      return <button className="button wide" disabled>Current plan</button>;
    }
    if (paidActive && account?.plan_key === "pro" && plan.key === "enterprise") {
      const quote = status?.upgrade_quote;
      return <button className="button primary wide" disabled={busy || !quote?.amount_minor} onClick={upgrade}>Upgrade now{quote?.amount_minor ? ` · ${quote.estimate ? "≈ " : ""}${formatMoney(quote.amount_minor, quote.currency_code)}` : ""}</button>;
    }
    if (paidActive && account?.plan_key === "enterprise" && plan.key === "pro") {
      if (account.pending_plan_key === "pro") return <>{sslRenewalOpen && <button className="button primary wide" disabled={busy} onClick={() => setSelected("pro")}>Renew on Pro</button>}<button className="button wide" disabled>Starts {date(account.paid_through)}</button></>;
      return <button className="button subtle wide" disabled={busy} onClick={downgrade}>Switch at renewal</button>;
    }
    return <button className={`button wide ${selected === plan.key ? "primary" : ""}`} disabled={busy} onClick={() => setSelected(plan.key)}>{selected === plan.key ? "Selected" : `Choose ${plan.name}`}</button>;
  }

  const lockedTerms = paidActive && !sslRenewalOpen;
  const selectedPlan = status?.plans.find(plan => plan.key === selected);

  if (!status && !error) return <main className={`commerce-page plan-page ${onboarding ? "plan-page-onboarding" : ""}`}><header className="commerce-heading"><h1>{onboarding ? "Pick how you start" : "Plans & AI credits"}</h1></header><SectionSkeleton /></main>;

  return <main className={`commerce-page plan-page ${onboarding ? "plan-page-onboarding" : ""}`}>
    <header className="commerce-heading plan-heading">
      <div><span className="eyebrow">Plan</span><h1>{onboarding ? "Pick how you start" : <>Plans &amp; AI credits</>}</h1><p>{onboarding ? "Start free to set up and preview your AI, or go Pro to connect Messenger, Instagram and WhatsApp right away." : "One credit covers one AI auto-reply to a customer. Credits reset every month and do not roll over."}</p></div>
      <div className="plan-toggles" aria-label="Pricing options">
        <div className="plan-segment" role="radiogroup" aria-label="Billing interval">
          {(["month", "year"] as Interval[]).map(value => <button key={value} role="radio" aria-checked={interval === value} className={interval === value ? "on" : ""} disabled={lockedTerms} onClick={() => setTermInterval(value)}>{value === "month" ? "Monthly" : <>Yearly <b>2 months free</b></>}</button>)}
        </div>
        <div className="plan-segment" role="radiogroup" aria-label="Currency">
          {CURRENCIES.map(value => <button key={value} role="radio" aria-checked={currency === value} className={currency === value ? "on" : ""} disabled={lockedTerms || sslRenewalOpen} onClick={() => pickCurrency(value)}>{value}</button>)}
        </div>
      </div>
    </header>

    {error && <p className="form-notice plan-banner warn" role="alert">{error}</p>}
    {notice && <p className="form-notice plan-banner" role="status">{notice}</p>}
    {banners.map(banner => <p key={banner.text} className={`form-notice plan-banner ${banner.tone}`}>{banner.text}</p>)}

    {!onboarding && <section className="plan-status">
      <div className="commerce-card plan-current">
        <span className="eyebrow">Current plan</span>
        <h2>{paidActive && account?.plan_key ? `${account.plan_key === "pro" ? "Pro" : "Enterprise"} · ${account.billing_interval === "year" ? "Yearly" : "Monthly"}` : trialActive ? "Free trial" : status?.access ? "Operator access" : "No active plan"}</h2>
        <p>{paidActive
          ? account?.provider === "stripe"
            ? account.auto_renew ? `Renews automatically on ${date(account.paid_through)} via Stripe (${account.currency_code}).` : `Active until ${date(account.paid_through)}. Auto-renewal is off.`
            : `Prepaid via SSLCOMMERZ until ${date(account?.paid_through)}. Renew from 7 days before it ends.`
          : trialActive ? `Trial ends ${date(account?.trial_ends_at)}.` : "Choose Pro or Enterprise below to start."}</p>
        {isOwner && paidActive && account?.provider === "stripe" && <div className="commerce-actions">
          <button className="button subtle" disabled={busy} onClick={() => changeRenewal(!account.auto_renew)}>{account.auto_renew ? "Stop auto-renewal" : "Turn on auto-renewal"}</button>
        </div>}
      </div>
      <div className="commerce-card plan-credits">
        <div className="plan-credits-top"><span className="eyebrow">AI credits this cycle</span><small>{credits ? `Resets ${date(credits.cycle_end)}` : ""}</small></div>
        <strong className="plan-credits-figure">{credits ? credits.balance.toLocaleString() : "—"}<small> / {credits ? credits.allowance.toLocaleString() : "—"} left</small></strong>
        <div className={`plan-meter ${used >= 1 ? "empty" : used >= 0.8 ? "low" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={credits?.allowance || 0} aria-valuenow={credits?.balance || 0} aria-label="AI credits remaining">
          {Array.from({ length: 40 }, (_, index) => <i key={index} className={index / 40 < 1 - used ? "fill" : ""} />)}
        </div>
        <p>{credits ? `${(credits.allowance - credits.balance).toLocaleString()} AI replies sent since ${date(credits.cycle_start)}.` : "Credits appear once your plan or trial starts."}</p>
        {!!credits?.bonus_balance && <p><strong>+{credits.bonus_balance.toLocaleString()} bonus credits</strong> — never reset, used after plan credits.</p>}
      </div>
    </section>}

    <section className={`plan-grid ${onboarding ? "with-free" : ""}`} aria-label="Plans">
      {onboarding && onFree && <article className="plan-card free">
        <header><h2>Free</h2><span className="plan-tag">7-day trial</span></header>
        <div className="plan-price"><strong>{formatMoney(0, currency)}</strong><span>/ 7 days</span></div>
        <p className="plan-sub">Set up and preview your assistant before you commit.</p>
        <ul>
          <li><Check size={14} weight="bold" /><span>Full AI setup: voice, policies, FAQs</span></li>
          <li><Check size={14} weight="bold" /><span>Private test phone to preview replies</span></li>
          <li><Check size={14} weight="bold" /><span>Dashboard access</span></li>
          <li className="muted"><span>No channel integrations</span></li>
        </ul>
        <div className="plan-card-action"><button className="button wide" disabled={busy} onClick={onFree}>Start free <ArrowRight size={15} /></button></div>
      </article>}
      {status?.plans.map((plan, index) => {
        const amount = plan.prices[interval][currency];
        const monthlyEquivalent = interval === "year" ? Math.round(amount / 12) : null;
        const current = paidActive && account?.plan_key === plan.key;
        return <article key={plan.key} className={`plan-card ${plan.key} ${current ? "current" : ""} ${selected === plan.key ? "selected" : ""}`} style={{ animationDelay: `${index * 70}ms` }}>
          <header><h2>{plan.name}</h2>{current ? <span className="plan-tag">Your plan</span> : plan.key === "enterprise" ? <span className="plan-tag alt">Most capacity</span> : null}</header>
          <div className="plan-price"><strong>{formatMoney(amount, currency)}</strong><span>/ {interval === "year" ? "year" : "month"}</span></div>
          <p className="plan-sub">{monthlyEquivalent ? `${formatMoney(monthlyEquivalent, currency)}/month billed yearly — 2 months free` : "Billed monthly. Cancel anytime."}</p>
          <ul>
            <li><Check size={14} weight="bold" /><span><b>{plan.credits.toLocaleString()}</b> AI credits every month</span></li>
            <li><Check size={14} weight="bold" /><span>About <b>{plan.conversations_per_day}</b> customer chats a day (~8 replies each)</span></li>
            <li><Check size={14} weight="bold" /><span>Messenger, Instagram &amp; WhatsApp AI replies</span></li>
            <li><Check size={14} weight="bold" /><span>Your team takes over in the Inbox when credits run out</span></li>
          </ul>
          <div className="plan-card-action">{cardAction(plan)}</div>
        </article>;
      })}
    </section>

    {isOwner && selectedPlan && (!paidActive || sslRenewalOpen) && <section className="commerce-card plan-checkout">
      <h2>{sslRenewalOpen ? "Renew" : "Checkout"}: {selectedPlan.name} · {interval === "year" ? "Yearly" : "Monthly"} · {formatMoney(selectedPlan.prices[interval][checkoutCurrency], checkoutCurrency)}</h2>
      <p>{gateway === "stripe"
        ? `You will pay securely with Stripe in ${checkoutCurrency}. Card details never touch Pulse.`
        : "You will pay with SSLCOMMERZ in BDT (bKash, Nagad, Rocket, or local cards). This is a prepaid term with no automatic renewal."}</p>
      {!gatewayReady && <p className="form-notice plan-banner warn">{gateway === "stripe" ? "Stripe" : "SSLCOMMERZ"} checkout is not configured yet. Try another currency or contact Pulse support.</p>}
      {gateway === "stripe" && <label className="settings-note plan-check"><input type="checkbox" checked={autoRenew} onChange={event => setAutoRenew(event.target.checked)} /> Renew automatically every {interval === "year" ? "year" : "month"} (you can turn this off anytime)</label>}
      {gateway === "sslcommerz" && <div className="commerce-form-grid">
        <label>Billing name<input autoComplete="name" value={contact.billing_name} onChange={event => setContact({ ...contact, billing_name: event.target.value })} /></label>
        <label>Bangladesh mobile<input autoComplete="tel" inputMode="tel" placeholder="01XXXXXXXXX" value={contact.billing_phone} onChange={event => setContact({ ...contact, billing_phone: event.target.value })} /></label>
        <label className="wide">Billing address<input autoComplete="street-address" value={contact.billing_address} onChange={event => setContact({ ...contact, billing_address: event.target.value })} /></label>
        <label>City<input autoComplete="address-level2" value={contact.billing_city} onChange={event => setContact({ ...contact, billing_city: event.target.value })} /></label>
        <label>Postcode<input inputMode="numeric" autoComplete="postal-code" value={contact.billing_postcode} onChange={event => setContact({ ...contact, billing_postcode: event.target.value })} /></label>
      </div>}
      <label className="settings-note plan-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> I agree to Pulse’s <a href={status?.policies.terms || "#"} target="_blank" rel="noopener noreferrer">terms</a>, <a href={status?.policies.privacy || "#"} target="_blank" rel="noopener noreferrer">privacy policy</a>, and <a href={status?.policies.refund || "#"} target="_blank" rel="noopener noreferrer">refund policy</a>.</label>
      {!policiesReady && <p className="settings-note">Billing policies are not published yet, so live checkout is unavailable.</p>}
      <div className="commerce-actions">
        <button className="button primary" disabled={busy || !consent || !gatewayReady || !policiesReady} onClick={() => checkout(selectedPlan.key)}>{busy ? "Opening checkout…" : `Continue to ${gateway === "stripe" ? "Stripe" : "SSLCOMMERZ"}`}</button>
        <button className="button subtle" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
      </div>
    </section>}

    {!isOwner && <p className="settings-note">Only the workspace owner can buy or change the plan.</p>}

    {!onboarding && <section className="commerce-card">
      <h2>Payment history</h2>
      {status?.invoices.length ? status.invoices.map(invoice => <div className="order-summary-row" key={invoice.id}>
        <span>{invoice.kind === "upgrade" ? "Upgrade to Enterprise" : `${invoice.plan_key === "pro" ? "Pro" : "Enterprise"} · ${invoice.billing_interval === "year" ? "yearly" : "monthly"}`} · {invoice.provider === "stripe" ? "Stripe" : "SSLCOMMERZ"} · <span className={`commerce-state ${invoice.state === "paid" ? "completed" : invoice.state === "failed" ? "cancelled" : ""}`}>{invoice.state}</span> · {date(invoice.paid_at || invoice.created_at)}</span>
        <strong>{formatMoney(invoice.amount_minor, invoice.currency_code)}</strong>
      </div>) : <p>No subscription payments yet.</p>}
    </section>}
  </main>;
}
