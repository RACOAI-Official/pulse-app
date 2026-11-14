"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { useWorkspace } from "@/lib/workspace";
import PulseMark from "@/components/PulseMark";
import { BootLoading, SectionSkeleton } from "@/components/LoadingFeedback";

type Paged<T> = { total: number; rows: T[] };
type Overview = { businesses: number; paid: number; trialing: number; suspended: number; users: number; signups_7d: number; payments_review: number; revenue_30d: Record<string, number>; connected_channels: number; failed_webhooks: number; problem_sends: number };
type Business = { id: string; name: string; created_at: string; suspended_at: string | null; suspended_reason: string | null; owner_email: string | null; plan_key: string | null; billing_state: string | null; provider: string | null; paid_through: string | null; trial_ends_at: string | null; balance: number | null; allowance: number | null; bonus_balance: number; members: number; access: boolean };
type LedgerRow = { id: number; tenant_id?: string; tenant_name?: string; delta: number; reason: string; bucket: string; note: string | null; created_at: string; actor_email: string | null };
type Invoice = { id: string; tenant_id?: string; tenant_name?: string; plan_key: string; billing_interval: string; kind: string; provider: string; amount_minor: number; currency_code: string; state: string; provider_transaction_id: string | null; paid_at: string | null; created_at: string };
type Detail = { tenant: { id: string; name: string; created_at: string; currency_code: string; suspended_at: string | null; suspended_reason: string | null }; access: boolean; billing: { plan_key: string | null; state: string; provider: string | null; billing_interval: string | null; paid_through: string | null; trial_ends_at: string | null; auto_renew: boolean; billing_email: string | null } | null; operator_grant: { access_until: string; reason: string } | null; credits: { allowance: number; balance: number; bonus_balance: number; cycle_end: string } | null; ai_replies_30d: number; members: { user_id: string; email: string; role: string; joined_at: string; last_sign_in_at: string | null }[]; counts: Record<string, number>; invoices: Invoice[]; ledger: LedgerRow[] };
type User = { id: string; email: string; created_at: string; last_sign_in_at: string | null; email_confirmed_at: string | null; is_operator: boolean; workspaces: { tenant_id: string; name: string; role: string }[] };
type Audit = { id: number; action: string; tenant_id: string | null; tenant_name: string | null; details: Record<string, unknown>; created_at: string; actor_email: string | null };

const TABS = ["Overview", "Businesses", "Users", "Payments", "Credits", "Audit"] as const;
type Tab = typeof TABS[number];
const PAGE = 50;
const REASONS = ["admin_grant", "admin_deduct", "cycle_grant", "upgrade_topup", "trial", "ai_reply", "refund"];

const date = (value?: string | null) => value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const label = (value?: string | null) => value ? value.replace(/_/g, " ") : "—";
const qs = (params: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

function status(row: Pick<Business, "suspended_at" | "access" | "billing_state">) {
  if (row.suspended_at) return { text: "Suspended", tone: "cancelled" };
  if (!row.access) return { text: "No access", tone: "archived" };
  return { text: row.billing_state === "trialing" ? "Trial" : "Paid", tone: row.billing_state === "trialing" ? "draft" : "completed" };
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return <div className="admin-pager"><span>{total.toLocaleString()} total · page {page} of {pages}</span><button className="button subtle" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button className="button subtle" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div>;
}

function useList<T>(path: string, params: Record<string, string | number | undefined>) {
  const [data, setData] = useState<Paged<T> | null>(null);
  const [error, setError] = useState("");
  const key = `${path}?${qs(params)}`;
  const load = useCallback(() => { setError(""); api<Paged<T>>(key).then(setData).catch(caught => setError(caught.message)); }, [key]);
  useEffect(load, [load]);
  return { data, error, reload: load };
}

function OverviewTab({ onManage }: { onManage: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Overview>("/admin/overview").then(setData).catch(caught => setError(caught.message)); }, []);
  if (error) return <p className="form-notice" role="alert">{error}</p>;
  if (!data) return <SectionSkeleton variant="dashboard" />;
  const revenue = Object.entries(data.revenue_30d);
  const cards: [string, string | number][] = [["Businesses", data.businesses], ["Paid", data.paid], ["On trial", data.trialing], ["Suspended", data.suspended], ["Users", data.users], ["New businesses (7d)", data.signups_7d], ["Payments in review", data.payments_review], ["Connected channels", data.connected_channels], ["Failed webhooks", data.failed_webhooks], ["Problem sends", data.problem_sends]];
  return <>
    <div className="admin-overview-actions"><p>Adjust credits and manage workspace access from Businesses.</p><button type="button" className="button primary" onClick={onManage}>Manage businesses</button></div>
    <div className="metric-grid admin-metrics">{cards.map(([name, value]) => <div className="metric-card" key={name}><span>{name}</span><strong>{value.toLocaleString()}</strong></div>)}</div>
    <section className="commerce-card"><h2>Revenue, last 30 days</h2><p>Paid invoices only, per currency (never converted).</p>{revenue.length ? <div className="admin-kv">{revenue.map(([currency, minor]) => <div key={currency}><span>{currency}</span><strong>{formatMoney(minor, currency)}</strong></div>)}</div> : <p className="commerce-empty">No paid invoices in the last 30 days.</p>}</section>
  </>;
}

function BusinessDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const load = useCallback(() => { api<Detail>(`/admin/businesses/${id}`).then(setData).catch(caught => setError(caught.message)); }, [id]);
  useEffect(load, [load]);

  async function adjust(event: FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) { setNotice("Enter a whole number, positive to add or negative to deduct."); return; }
    if (!window.confirm(`${value > 0 ? "Add" : "Deduct"} ${Math.abs(value).toLocaleString()} bonus credits ${value > 0 ? "to" : "from"} ${data?.tenant.name}?`)) return;
    setBusy(true); setNotice("");
    try {
      const result = await api<{ bonus_balance: number; replayed: boolean }>(`/admin/businesses/${id}/credits`, { method: "POST", body: JSON.stringify({ amount: value, note, idempotency_key: requestKey }) });
      setNotice(result.replayed ? "Already applied." : `Done. Bonus balance is now ${result.bonus_balance.toLocaleString()}.`);
      setAmount(""); setNote(""); setRequestKey(crypto.randomUUID());
      load(); onChanged();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Could not adjust credits"); }
    finally { setBusy(false); }
  }

  async function toggleSuspend(event: FormEvent) {
    event.preventDefault();
    const suspended = !!data?.tenant.suspended_at;
    if (!window.confirm(suspended ? `Restore ${data?.tenant.name}? Writes and AI replies resume.` : `Suspend ${data?.tenant.name}? The workspace becomes read-only and AI replies stop.`)) return;
    setBusy(true); setNotice("");
    try {
      await api(`/admin/businesses/${id}/${suspended ? "unsuspend" : "suspend"}`, { method: "POST", body: JSON.stringify({ reason }) });
      setNotice(suspended ? "Workspace restored." : "Workspace suspended.");
      setReason(""); load(); onChanged();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Could not update the workspace"); }
    finally { setBusy(false); }
  }

  return <aside className="admin-drawer" role="dialog" aria-modal="true" aria-label="Business details">
    <div className="admin-drawer-head"><div><span className="eyebrow">Business</span><h2>{data?.tenant.name || "Loading…"}</h2>{data && <small>{data.tenant.id}</small>}</div><button className="button subtle" onClick={onClose}>Close</button></div>
    {error && <p className="form-notice" role="alert">{error}</p>}
    {!data && !error && <SectionSkeleton variant="dashboard" />}
    {data && <>
      {data.tenant.suspended_at && <p className="form-notice plan-banner warn">Suspended {dateTime(data.tenant.suspended_at)}: {data.tenant.suspended_reason}</p>}
      <div className="admin-kv">
        <div><span>Created</span><strong>{date(data.tenant.created_at)}</strong></div>
        <div><span>Status</span><strong>{status({ suspended_at: data.tenant.suspended_at, access: data.access, billing_state: data.billing?.state ?? null }).text}</strong></div>
        <div><span>Plan</span><strong>{label(data.billing?.plan_key) } {data.billing?.billing_interval ? `· ${data.billing.billing_interval}ly` : ""}</strong></div>
        <div><span>Paid through</span><strong>{date(data.billing?.paid_through || data.billing?.trial_ends_at)}</strong></div>
        <div><span>Provider</span><strong>{data.billing?.provider || "—"}</strong></div>
        <div><span>Plan credits</span><strong>{data.credits ? `${data.credits.balance.toLocaleString()} / ${data.credits.allowance.toLocaleString()}` : "—"}</strong></div>
        <div><span>Bonus credits</span><strong>{(data.credits?.bonus_balance ?? 0).toLocaleString()}</strong></div>
        <div><span>AI replies (30d)</span><strong>{data.ai_replies_30d.toLocaleString()}</strong></div>
        <div><span>Channels · Products · Orders</span><strong>{data.counts.channels} · {data.counts.products} · {data.counts.orders}</strong></div>
        {data.operator_grant && <div><span>Free access until</span><strong>{date(data.operator_grant.access_until)}</strong></div>}
      </div>

      <form className="commerce-card admin-form" onSubmit={adjust}>
        <h3>Adjust bonus credits</h3>
        <p>Bonus credits never reset and are spent after plan credits. Use a negative number to deduct.</p>
        <div className="commerce-form-grid">
          <label>Amount<input type="number" step={1} min={-1000000} max={1000000} required value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 500 or -100" /></label>
          <label>Reason<input required minLength={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Shown in the ledger and audit log" /></label>
        </div>
        <div className="commerce-actions"><button className="button primary" disabled={busy}>Apply</button></div>
      </form>

      <form className="commerce-card admin-form" onSubmit={toggleSuspend}>
        <h3>{data.tenant.suspended_at ? "Restore workspace" : "Suspend workspace"}</h3>
        <p>{data.tenant.suspended_at ? "Writes, AI replies and outbound sends resume." : "Read-only for its team; AI replies and outbound sends stop. Incoming messages are still stored."}</p>
        <label className="admin-field">Reason{data.tenant.suspended_at ? " (optional)" : ""}<input required={!data.tenant.suspended_at} minLength={data.tenant.suspended_at ? 0 : 3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="commerce-actions"><button className={`button ${data.tenant.suspended_at ? "primary" : "danger"}`} disabled={busy}>{data.tenant.suspended_at ? "Restore" : "Suspend"}</button></div>
      </form>
      {notice && <p className="form-notice" role="status">{notice}</p>}

      <section className="commerce-card"><h3>Members</h3>{data.members.map(member => <div className="commerce-row" key={member.user_id}><div className="commerce-row-main"><strong>{member.email}</strong><small>Joined {date(member.joined_at)} · last sign-in {date(member.last_sign_in_at)}</small></div><span className="commerce-state">{member.role}</span></div>)}</section>
      <section className="commerce-card"><h3>Payments</h3>{data.invoices.length ? <InvoiceTable rows={data.invoices} /> : <p className="commerce-empty">No payments yet.</p>}</section>
      <section className="commerce-card"><h3>Credit changes</h3><p>Grants, top-ups and admin adjustments (AI reply usage is summarized above).</p>{data.ledger.length ? <LedgerTable rows={data.ledger} /> : <p className="commerce-empty">No credit changes.</p>}</section>
    </>}
  </aside>;
}

function InvoiceTable({ rows, showBusiness }: { rows: Invoice[]; showBusiness?: boolean }) {
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Date</th>{showBusiness && <th>Business</th>}<th>Plan</th><th>Amount</th><th>Provider</th><th>State</th><th>Transaction</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{dateTime(row.paid_at || row.created_at)}</td>{showBusiness && <td>{row.tenant_name || "—"}</td>}<td>{label(row.plan_key)} · {row.billing_interval}{row.kind === "upgrade" ? " (upgrade)" : ""}</td><td className="num">{formatMoney(row.amount_minor, row.currency_code)}</td><td>{row.provider}</td><td><span className={`commerce-state ${row.state === "paid" ? "completed" : row.state === "failed" ? "cancelled" : "draft"}`}>{row.state}</span></td><td className="mono">{row.provider_transaction_id || "—"}</td></tr>)}</tbody></table></div>;
}

function LedgerTable({ rows, showBusiness }: { rows: LedgerRow[]; showBusiness?: boolean }) {
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Date</th>{showBusiness && <th>Business</th>}<th>Change</th><th>Reason</th><th>Bucket</th><th>By</th><th>Note</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{dateTime(row.created_at)}</td>{showBusiness && <td>{row.tenant_name || "—"}</td>}<td className={`num ${row.delta < 0 ? "neg" : "pos"}`}>{row.delta > 0 ? "+" : ""}{row.delta.toLocaleString()}</td><td>{label(row.reason)}</td><td>{row.bucket}</td><td>{row.actor_email || "system"}</td><td>{row.note || "—"}</td></tr>)}</tbody></table></div>;
}

function BusinessesTab() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, reload } = useList<Business>("/admin/businesses", { q: query, status: filter, page });
  return <>
    <p className="admin-help">Use <strong>Manage</strong> to adjust bonus credits or suspend and restore a workspace.</p>
    <form className="commerce-section-head" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(q.trim()); }}>
      <input type="search" maxLength={120} value={q} onChange={e => setQ(e.target.value)} placeholder="Name, owner email or ID" aria-label="Search businesses" />
      <select value={filter} onChange={e => { setPage(1); setFilter(e.target.value); }} aria-label="Status filter"><option value="all">All</option><option value="paid">Paid</option><option value="trialing">On trial</option><option value="expired">No access</option><option value="suspended">Suspended</option></select>
      <button className="button">Search</button>
    </form>
    {error && <p className="form-notice" role="alert">{error}</p>}
    {!data && !error && <SectionSkeleton variant="dashboard" />}
    {data && <section className="commerce-card admin-list-card">
      {data.rows.length ? <div className="admin-table-wrap"><table className="admin-table admin-business-table">
        <thead><tr><th>Business / owner</th><th>Status / plan</th><th>Until</th><th className="num">Credits<br />plan + bonus</th><th className="num">Members</th><th className="admin-action-cell">Actions</th></tr></thead>
        <tbody>{data.rows.map(row => {
          const s = status(row);
          return <tr key={row.id}>
            <td><span className="admin-cell-stack"><strong>{row.name}</strong><small>{row.owner_email || "No owner email"}</small></span></td>
            <td><span className="admin-cell-stack"><span className={`commerce-state ${s.tone}`}>{s.text}</span><small>{label(row.plan_key)}</small></span></td>
            <td>{date(row.paid_through || row.trial_ends_at)}</td>
            <td className="num">{(row.balance ?? 0).toLocaleString()} + {row.bonus_balance.toLocaleString()}</td>
            <td className="num">{row.members}</td>
            <td className="admin-action-cell"><button type="button" className="button admin-manage" onClick={() => setOpen(row.id)} aria-label={`Manage ${row.name}`}>Manage</button></td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="commerce-empty">No businesses match.</p>}
      <Pager page={page} total={data.total} onPage={setPage} />
    </section>}
    {open && <><button className="rail-scrim admin-scrim" aria-label="Close details" onClick={() => setOpen(null)} /><BusinessDetail id={open} onClose={() => setOpen(null)} onChanged={reload} /></>}
  </>;
}

function UsersTab() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { data, error } = useList<User>("/admin/users", { q: query, page });
  return <>
    <form className="commerce-section-head" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(q.trim()); }}><input type="search" maxLength={120} value={q} onChange={e => setQ(e.target.value)} placeholder="Email or user ID" aria-label="Search users" /><button className="button">Search</button></form>
    {error && <p className="form-notice" role="alert">{error}</p>}
    {!data && !error && <SectionSkeleton variant="dashboard" />}
    {data && <section className="commerce-card">{data.rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Email</th><th>Workspaces</th><th>Signed up</th><th>Last sign-in</th><th>Verified</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.id}><td>{row.email}{row.is_operator && <span className="commerce-state completed admin-tag">operator</span>}</td><td>{row.workspaces.length ? row.workspaces.map(w => `${w.name} (${w.role})`).join(", ") : "—"}</td><td>{date(row.created_at)}</td><td>{dateTime(row.last_sign_in_at)}</td><td>{row.email_confirmed_at ? "Yes" : "No"}</td></tr>)}</tbody></table></div> : <p className="commerce-empty">No users match.</p>}<Pager page={page} total={data.total} onPage={setPage} /></section>}
  </>;
}

function PaymentsTab() {
  const [provider, setProvider] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const { data, error } = useList<Invoice>("/admin/payments", { provider, state, page });
  return <>
    <div className="commerce-section-head"><select value={provider} onChange={e => { setPage(1); setProvider(e.target.value); }} aria-label="Provider"><option value="">All providers</option><option value="stripe">Stripe</option><option value="sslcommerz">SSLCOMMERZ</option></select><select value={state} onChange={e => { setPage(1); setState(e.target.value); }} aria-label="State"><option value="">All states</option><option value="paid">Paid</option><option value="review">In review</option><option value="pending">Pending</option><option value="failed">Failed</option></select></div>
    {error && <p className="form-notice" role="alert">{error}</p>}
    {!data && !error && <SectionSkeleton variant="dashboard" />}
    {data && <section className="commerce-card">{data.rows.length ? <InvoiceTable rows={data.rows} showBusiness /> : <p className="commerce-empty">No payments match.</p>}<Pager page={page} total={data.total} onPage={setPage} /></section>}
  </>;
}

function CreditsTab() {
  const [reason, setReason] = useState("");
  const [page, setPage] = useState(1);
  const { data, error } = useList<LedgerRow>("/admin/credits", { reason, page });
  return <>
    <div className="commerce-section-head"><select value={reason} onChange={e => { setPage(1); setReason(e.target.value); }} aria-label="Reason"><option value="">All changes</option>{REASONS.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></div>
    {error && <p className="form-notice" role="alert">{error}</p>}
    {!data && !error && <SectionSkeleton variant="dashboard" />}
    {data && <section className="commerce-card">{data.rows.length ? <LedgerTable rows={data.rows} showBusiness /> : <p className="commerce-empty">No credit changes match.</p>}<Pager page={page} total={data.total} onPage={setPage} /></section>}
  </>;
}

function AuditTab() {
  const [page, setPage] = useState(1);
  const { data, error } = useList<Audit>("/admin/audit", { page });
  return <>
    {error && <p className="form-notice" role="alert">{error}</p>}
    {!data && !error && <SectionSkeleton variant="dashboard" />}
    {data && <section className="commerce-card"><p>Every admin action, newest first. Entries cannot be edited or deleted.</p>{data.rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Business</th><th>Details</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.id}><td>{dateTime(row.created_at)}</td><td>{row.actor_email || "—"}</td><td>{label(row.action)}</td><td>{row.tenant_name || "—"}</td><td>{Object.entries(row.details).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${label(k)}: ${v}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div> : <p className="commerce-empty">No admin actions yet.</p>}<Pager page={page} total={data.total} onPage={setPage} /></section>}
  </>;
}

export default function AdminPage() {
  const workspace = useWorkspace();
  const [access, setAccess] = useState<"checking" | "yes" | "no">("checking");
  const [email, setEmail] = useState("");
  const [tab, setTab] = useState<Tab>("Overview");
  useEffect(() => {
    if (workspace.loading) return;
    api<{ email: string }>("/admin/me").then(me => { setEmail(me.email); setAccess("yes"); }).catch(() => setAccess("no"));
  }, [workspace.loading]);

  if (workspace.loading || access === "checking") return <BootLoading />;
  if (access === "no") return <main className="loading-screen"><span className="brand-mark"><PulseMark /></span><h1>Page not found</h1><Link className="button" href="/dashboard">Go to dashboard</Link></main>;

  return <main className="ops-page admin-page">
    <header className="ops-head"><Link href="/dashboard" className="rail-brand" aria-label="Pulse dashboard"><span className="rail-brand-mark"><PulseMark /></span></Link><div><h1>Admin</h1><p>Signed in as {email}. Every change is recorded in the audit log.</p></div><button className="button subtle admin-signout" onClick={workspace.signOut}>Sign out</button></header>
    <nav className="admin-tabs" aria-label="Admin sections">{TABS.map(item => <button key={item} className={tab === item ? "active" : ""} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === "Overview" && <OverviewTab onManage={() => setTab("Businesses")} />}
    {tab === "Businesses" && <BusinessesTab />}
    {tab === "Users" && <UsersTab />}
    {tab === "Payments" && <PaymentsTab />}
    {tab === "Credits" && <CreditsTab />}
    {tab === "Audit" && <AuditTab />}
  </main>;
}
