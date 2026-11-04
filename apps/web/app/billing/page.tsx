"use client";

import { useCallback, useEffect, useState } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api } from "@/lib/api";

type Plan = { key: "light" | "pro" | "plus"; name: string; usd_minor: number; bdt_minor: number | null };
type Account = { plan_key: string | null; provider: string | null; state: string; auto_renew: boolean; trial_used: boolean; trial_ends_at: string | null; paid_through: string | null };
type Invoice = { id: string; plan_key: string; provider: string; amount_minor: number; currency_code: string; state: string; period_start: string | null; period_end: string | null; paid_at: string | null; created_at: string };
type BillingStatus = { account: Account | null; access: boolean; providers: { stripe: boolean; sslcommerz: boolean }; policies: { terms: string; privacy: string; refund: string }; sales_email: string; plans: Plan[]; invoices: Invoice[] };

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency }).format(amount / 100);
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-BD", { year: "numeric", month: "long", day: "numeric" }) : "—";
}

function BillingContent({ tenantId, role }: { tenantId: string; role: string }) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [provider, setProvider] = useState<"stripe" | "sslcommerz">("stripe");
  const [autoRenew, setAutoRenew] = useState(false);
  const [trialConsent, setTrialConsent] = useState(false);
  const [policyConsent, setPolicyConsent] = useState(false);
  const [contact, setContact] = useState({ billing_name: "", billing_phone: "", billing_address: "", billing_city: "", billing_postcode: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(() => api<BillingStatus>(`/tenants/${tenantId}/billing`).then(setStatus), [tenantId]);
  useEffect(() => { refresh().catch(caught => setError(caught.message)); }, [refresh]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("return")) {
      setNotice("Your payment is being verified. Refresh Billing if the status has not updated yet.");
      window.history.replaceState(null, "", "/billing");
    }
  }, []);
  async function start(plan: Plan, trial: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ checkout_url: string }>(`/tenants/${tenantId}/billing/checkout`, {
        method: "POST", body: JSON.stringify({ plan: plan.key, provider: trial ? "stripe" : provider,
          trial, auto_renew: trial ? false : provider === "stripe" && autoRenew,
          accepted_policies: policyConsent, ...contact }),
      });
      window.location.assign(result.checkout_url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not start checkout"); setBusy(false); }
  }
  async function cancel() {
    if (!window.confirm("Cancel the trial now or stop renewal at the end of the paid month?")) return;
    setBusy(true); setError("");
    try { await api(`/tenants/${tenantId}/billing/cancel`, { method: "POST" }); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Cancellation failed"); }
    finally { setBusy(false); }
  }
  async function changeRenewal(enabled: boolean) {
    setBusy(true); setError("");
    try { await api(`/tenants/${tenantId}/billing/auto-renew?enabled=${enabled}`, { method: "POST" }); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update renewal"); }
    finally { setBusy(false); }
  }
  const account = status?.account;
  const active = account?.state === "trialing" && !!account.trial_ends_at && new Date(account.trial_ends_at) > new Date() || account?.state === "active" && !!account.paid_through && new Date(account.paid_through) > new Date();
  const sslRenewal = Boolean(active && account?.provider === "sslcommerz" && account.paid_through && new Date(account.paid_through).getTime() - Date.now() <= 7 * 86400000);
  const policiesReady = Boolean(status?.policies.terms && status.policies.privacy && status.policies.refund);
  useEffect(() => { if (sslRenewal) setProvider("sslcommerz"); }, [sslRenewal]);
  return <main className="commerce-page"><header className="commerce-heading"><div><h1>Pulse subscription</h1><p>Choose a monthly plan and pay Pulse from your business dashboard.</p></div></header>
    {error && <p className="form-notice" role="alert">{error}</p>}{notice && <p className="form-notice">{notice}</p>}
    <section className="commerce-card"><h2>{account?.plan_key ? `${account.plan_key[0].toUpperCase()}${account.plan_key.slice(1)} / ${active ? account.state : "expired"}` : status?.access ? "Operator access" : "No active subscription"}</h2><p>{account?.state === "trialing" && active ? `Seven-day trial ends ${date(account.trial_ends_at)}. Your selected plan will be charged then.` : account?.paid_through ? `Paid through ${date(account.paid_through)}.` : "Choose a plan below to start."} {account?.provider === "stripe" && account.state === "active" ? account.auto_renew ? "Auto renewal is on." : "Auto renewal is off." : ""}</p>{account?.provider === "sslcommerz" && account.paid_through && active && new Date(account.paid_through).getTime() - Date.now() < 3 * 86400000 && <p className="form-notice">Your monthly payment is due soon. You can renew now to extend access for another month.</p>}
      {role === "owner" && account?.provider === "stripe" && account.state === "active" && <div className="commerce-actions"><button className="button subtle" disabled={busy} onClick={() => changeRenewal(!account.auto_renew)}>{account.auto_renew ? "Turn off auto renewal" : "Turn on auto renewal"}</button>{account.auto_renew && <button className="button subtle" disabled={busy} onClick={cancel}>Cancel at period end</button>}</div>}
      {role === "owner" && account?.state === "trialing" && <button className="button subtle" disabled={busy} onClick={cancel}>Cancel trial before charge</button>}
    </section>
    {(!active || sslRenewal) && <><section className="commerce-card"><h2>{sslRenewal ? "Renew your subscription" : "Payment method"}</h2><div className="commerce-inline"><label><input type="radio" name="provider" checked={provider === "stripe"} onChange={() => setProvider("stripe")} /> Stripe / USD</label><label><input type="radio" name="provider" checked={provider === "sslcommerz"} onChange={() => setProvider("sslcommerz")} /> SSLCOMMERZ / BDT</label></div>{status && !status.providers[provider] && <p className="form-notice">This payment gateway is not configured for checkout yet.</p>}{provider === "stripe" && <label className="settings-note"><input type="checkbox" checked={autoRenew} onChange={event => setAutoRenew(event.target.checked)} /> Auto renew monthly after the first paid month</label>}{provider === "sslcommerz" && <div className="commerce-form-grid"><label>Billing name<input value={contact.billing_name} onChange={event => setContact({ ...contact, billing_name: event.target.value })} /></label><label>Bangladesh mobile number<input value={contact.billing_phone} onChange={event => setContact({ ...contact, billing_phone: event.target.value })} /></label><label className="wide">Billing address<input value={contact.billing_address} onChange={event => setContact({ ...contact, billing_address: event.target.value })} /></label><label>City<input value={contact.billing_city} onChange={event => setContact({ ...contact, billing_city: event.target.value })} /></label><label>Postcode<input inputMode="numeric" value={contact.billing_postcode} onChange={event => setContact({ ...contact, billing_postcode: event.target.value })} /></label><p className="settings-note wide">SSLCOMMERZ requires a new checkout each month. Automatic renewal is available only through Stripe.</p></div>}</section>
      <section className="commerce-card"><label className="settings-note"><input type="checkbox" checked={policyConsent} onChange={event => setPolicyConsent(event.target.checked)} /> I have read and agree to Pulse’s <a href={status?.policies.terms || "#"} target="_blank" rel="noopener noreferrer">terms</a>, <a href={status?.policies.privacy || "#"} target="_blank" rel="noopener noreferrer">privacy policy</a>, and <a href={status?.policies.refund || "#"} target="_blank" rel="noopener noreferrer">refund policy</a> for this subscription.</label>{!policiesReady && <p className="form-notice">Pulse’s billing policies have not been published yet. Checkout is unavailable.</p>}</section>
      <div className="integration-grid">{status?.plans.map(plan => <section className="commerce-card" key={plan.key}><h2>{plan.name}</h2><p><strong>{provider === "stripe" ? formatAmount(plan.usd_minor, "USD") : plan.bdt_minor ? formatAmount(plan.bdt_minor, "BDT") : "BDT price pending"}</strong> / month</p><p>All three plans currently include the same Pulse access. Plan-specific allowances will be announced before they apply.</p>{role === "owner" && <div className="commerce-actions"><button className="button primary" disabled={busy || !status.providers[provider] || !policyConsent || !policiesReady || sslRenewal && (provider !== "sslcommerz" || plan.key !== account?.plan_key) || provider === "sslcommerz" && !plan.bdt_minor} onClick={() => start(plan, false)}>{provider === "stripe" && autoRenew ? "Subscribe with auto renewal" : "Pay for one month"}</button>{provider === "stripe" && !account?.trial_used && <button className="button subtle" disabled={busy || !status.providers.stripe || !trialConsent || !policyConsent || !policiesReady || sslRenewal} onClick={() => start(plan, true)}>Start 7-day card trial</button>}</div>}{provider === "stripe" && !account?.trial_used && !sslRenewal && <label className="settings-note"><input type="checkbox" checked={trialConsent} onChange={event => setTrialConsent(event.target.checked)} /> I agree that Pulse will charge {formatAmount(plan.usd_minor, "USD")} to my card seven days after starting this trial, approximately {date(new Date(Date.now() + 7 * 86400000).toISOString())}, unless I cancel first. Stripe will show the exact charge date before I confirm. This pays for one month; later renewal stays off.</label>}{provider === "sslcommerz" && !plan.bdt_minor && <p className="settings-note">Pulse has not set this plan’s BDT price yet.</p>}</section>)}</div></>}
    <section className="commerce-card"><h2>Enterprise</h2><p>Custom pricing and integration. Contact Pulse to discuss your requirements.</p>{status?.sales_email && <a className="button subtle" href={`mailto:${status.sales_email}?subject=Pulse%20Enterprise`}>Contact sales</a>}</section>
    <section className="commerce-card"><h2>Payment history</h2>{status?.invoices.length ? status.invoices.map(invoice => <div className="order-summary-row" key={invoice.id}><span>{invoice.plan_key} / {invoice.provider} / {invoice.state} / {date(invoice.paid_at || invoice.created_at)}</span><strong>{formatAmount(invoice.amount_minor, invoice.currency_code)}</strong></div>) : <p>No subscription payments yet.</p>}</section>
  </main>;
}

export default function BillingPage() {
  return <WorkspaceShell>{workspace => <BillingContent key={workspace.tenantId} tenantId={workspace.tenantId} role={workspace.current?.role || "staff"} />}</WorkspaceShell>;
}
