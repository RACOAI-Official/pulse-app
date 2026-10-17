"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api } from "@/lib/api";
import { CommerceConfig, CommerceOrder, decimal, money, OrderState, Product, toMinor } from "@/lib/commerce";

type Draft = { id?: string; customer_name: string; customer_phone: string; delivery_address: string; discount_type: "none" | "amount" | "percent"; discount: string; delivery: string; items: { variant_id: string; quantity: number }[] };
const emptyDraft = (): Draft => ({ customer_name: "", customer_phone: "", delivery_address: "", discount_type: "none", discount: "0", delivery: "0.00", items: [{ variant_id: "", quantity: 1 }] });
const states: OrderState[] = ["draft", "pending_confirmation", "confirmed", "processing", "completed", "cancelled"];
const labels: Record<OrderState, string> = { draft: "Draft", pending_confirmation: "Pending confirmation", confirmed: "Confirmed", processing: "Processing", completed: "Completed", cancelled: "Cancelled" };

function OrdersContent({ tenantId }: { tenantId: string }) {
  const base = `/tenants/${tenantId}/commerce`;
  const [config, setConfig] = useState<CommerceConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<CommerceOrder[]>([]);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<CommerceOrder | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [payment, setPayment] = useState({ amount: "", method: "cash", note: "" });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("conversation_id");
    if (value && /^[0-9a-f-]{36}$/i.test(value)) {
      setConversationId(value);
      setDraft(emptyDraft());
    }
  }, []);
  const refresh = useCallback(async () => {
    const [settings, catalog, rows] = await Promise.all([api<CommerceConfig>(`${base}/config`), api<Product[]>(`${base}/products`), api<CommerceOrder[]>(`${base}/orders`)]);
    setConfig(settings); setProducts(catalog); setOrders(rows);
  }, [base]);
  useEffect(() => { refresh().catch(error => setNotice(error.message)); }, [refresh]);
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    api<CommerceOrder>(`${base}/orders/${selectedId}`).then(setSelected).catch(error => setNotice(error.message));
  }, [base, selectedId, orders]);
  const choices = useMemo(() => products.filter(p => p.state === "active").flatMap(p => p.product_variants.filter(v => v.active).map(v => ({ ...v, product: p.title }))), [products]);
  const shown = orders.filter(order => filter === "all" || order.state === filter);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setNotice("");
    try { await work(); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  };
  function editOrder(order: CommerceOrder) {
    setDraft({ id: order.id, customer_name: order.customer_name, customer_phone: order.customer_phone,
      delivery_address: order.delivery_address, discount_type: order.discount_type,
      discount: order.discount_type === "percent" ? String(order.discount_value / 100) : decimal(order.discount_value),
      delivery: decimal(order.delivery_minor),
      items: order.commerce_order_items?.map(item => ({ variant_id: item.variant_id, quantity: item.quantity })) || [] });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft) return;
    await run(async () => {
      const result = await api<{ id: string }>(`${base}/orders`, { method: "POST", body: JSON.stringify({
        id: draft.id, customer_name: draft.customer_name, customer_phone: draft.customer_phone,
        delivery_address: draft.delivery_address, discount_type: draft.discount_type,
        discount_value: draft.discount_type === "percent" ? Math.round(Number(draft.discount) * 100) : draft.discount_type === "amount" ? toMinor(draft.discount) : 0,
        delivery_minor: toMinor(draft.delivery), items: draft.items,
      }) });
      setDraft(current => current ? { ...current, id: result.id } : current);
      if (conversationId) {
        await api(`${base}/orders/${result.id}/conversation`, { method: "POST", body: JSON.stringify({ conversation_id: conversationId }) });
      }
      setSelectedId(result.id); setDraft(null); setNotice("Draft saved.");
    });
  }
  async function action(name: string) {
    if (!selected) return;
    let reason: string | undefined;
    if (name === "cancel") {
      const response = window.prompt("Reason for cancellation? Reserved stock will be restored. Recorded payments remain in history.");
      if (!response?.trim()) return;
      reason = response.trim();
    }
    await run(async () => {
      await api(`${base}/orders/${selected.id}/action`, { method: "POST", body: JSON.stringify({ action: name, reason }) });
      setSelected(await api<CommerceOrder>(`${base}/orders/${selected.id}`));
    });
  }
  async function recordPayment(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    await run(async () => {
      await api(`${base}/orders/${selected.id}/payments`, { method: "POST", body: JSON.stringify({ amount_minor: toMinor(payment.amount), method: payment.method, note: payment.note }) });
      setSelected(await api<CommerceOrder>(`${base}/orders/${selected.id}`)); setPayment({ amount: "", method: "cash", note: "" });
    });
  }
  const subtotal = draft?.items.reduce((total, line) => {
    const variant = choices.find(v => v.id === line.variant_id);
    return total + (variant?.offer_price_minor ?? variant?.regular_price_minor ?? 0) * line.quantity;
  }, 0) || 0;
  return <main className="commerce-page"><header className="commerce-heading"><div><span className="eyebrow">COMMERCE / FULFILLMENT</span><h1>Orders</h1><p>Create manual orders, confirm stock, and record payments.</p></div><button className="button primary" onClick={() => { setDraft(emptyDraft()); setSelectedId(""); }} disabled={!choices.length}><Plus size={16} /> New order</button></header>
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {!choices.length && <p className="form-notice">Activate a product with an image before creating an order.</p>}
    <div className="orders-layout"><section className="commerce-card order-list"><div className="commerce-section-head"><h2>Order queue <span className="count-pill">{orders.length}</span></h2><select aria-label="Filter order status" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All states</option>{states.map(state => <option key={state} value={state}>{labels[state]}</option>)}</select></div>
      {shown.map(order => <button className={`order-list-item ${selectedId === order.id ? "selected" : ""}`} key={order.id} onClick={() => { setSelectedId(order.id); setDraft(null); }}><span><strong>{order.customer_name || "Unnamed draft"}</strong><small>{order.id.slice(0, 8)} · {new Date(order.created_at).toLocaleDateString()}</small></span><span><strong>{money(order.total_minor, order.currency_code)}</strong><small className={`commerce-state ${order.state}`}>{labels[order.state]}</small></span></button>)}
      {!shown.length && <p className="commerce-empty">No orders in this view.</p>}</section>
      <div className="order-detail">
        {draft ? <section className="commerce-card"><div className="commerce-section-head"><h2>{draft.id ? "Edit draft" : "Create order"}</h2><button className="button subtle" onClick={() => setDraft(null)}>Close</button></div><form onSubmit={save}><div className="commerce-form-grid"><label>Customer name<input required value={draft.customer_name} onChange={e => setDraft({ ...draft, customer_name: e.target.value })} /></label><label>Phone<input required value={draft.customer_phone} onChange={e => setDraft({ ...draft, customer_phone: e.target.value })} /></label><label className="wide">Delivery address<textarea required value={draft.delivery_address} onChange={e => setDraft({ ...draft, delivery_address: e.target.value })} /></label></div><h3>Catalog items</h3>
          {draft.items.map((line, index) => <div className="commerce-inline order-line" key={index}><select aria-label={`Product variant ${index + 1}`} required value={line.variant_id} onChange={e => setDraft({ ...draft, items: draft.items.map((item, i) => i === index ? { ...item, variant_id: e.target.value } : item) })}><option value="">Select variant</option>{choices.map(v => <option key={v.id} value={v.id}>{v.product} / {v.sku} · {money(v.offer_price_minor ?? v.regular_price_minor, config?.currency || "BDT")} · {v.stock} in stock</option>)}</select><input aria-label={`Quantity ${index + 1}`} type="number" min="1" value={line.quantity} onChange={e => setDraft({ ...draft, items: draft.items.map((item, i) => i === index ? { ...item, quantity: Number(e.target.value) } : item) })} /><button type="button" className="button subtle" disabled={draft.items.length === 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}>Remove</button></div>)}<button type="button" className="button subtle" onClick={() => setDraft({ ...draft, items: [...draft.items, { variant_id: "", quantity: 1 }] })}>Add item</button>
          <div className="commerce-form-grid order-totals"><label>Discount type<select value={draft.discount_type} onChange={e => setDraft({ ...draft, discount_type: e.target.value as Draft["discount_type"], discount: "0" })}><option value="none">None</option><option value="amount">Amount</option><option value="percent">Percent</option></select></label>{draft.discount_type !== "none" && <label>Discount {draft.discount_type === "percent" ? "%" : config?.currency}<input inputMode="decimal" value={draft.discount} onChange={e => setDraft({ ...draft, discount: e.target.value })} /></label>}<label>Delivery charge ({config?.currency})<input inputMode="decimal" value={draft.delivery} onChange={e => setDraft({ ...draft, delivery: e.target.value })} /></label></div><p className="commerce-preview">Current item subtotal: {money(subtotal, config?.currency || "BDT")}. Final prices and stock are checked when confirming.</p><div className="commerce-actions"><button className="button primary" disabled={busy}>Save draft</button></div></form></section>
        : selected ? <section className="commerce-card"><div className="commerce-section-head"><div><span className={`commerce-state ${selected.state}`}>{labels[selected.state]}</span><h2>Order {selected.id.slice(0, 8)}</h2><p>{new Date(selected.created_at).toLocaleString()}</p></div><button className="button subtle" onClick={() => refresh()}><RefreshCw size={15} /> Refresh</button></div><div className="order-customer"><strong>{selected.customer_name || "Unnamed draft"}</strong><span>{selected.customer_phone}</span><span>{selected.delivery_address}</span></div><h3>Items</h3>{selected.commerce_order_items?.map(item => <div className="order-summary-row" key={item.id}><span>{item.product_title} · {item.sku} × {item.quantity}</span><strong>{money(item.line_total_minor, selected.currency_code)}</strong></div>)}<div className="order-summary-row"><span>Subtotal</span><strong>{money(selected.subtotal_minor, selected.currency_code)}</strong></div><div className="order-summary-row"><span>Discount</span><strong>−{money(selected.discount_minor, selected.currency_code)}</strong></div><div className="order-summary-row"><span>Delivery</span><strong>{money(selected.delivery_minor, selected.currency_code)}</strong></div><div className="order-summary-row total"><span>Total</span><strong>{money(selected.total_minor, selected.currency_code)}</strong></div><div className="order-summary-row"><span>Paid</span><strong>{money(selected.paid_minor, selected.currency_code)}</strong></div>{selected.refund_due_minor > 0 && <p className="refund-notice">Refund due: {money(selected.refund_due_minor, selected.currency_code)}. Record the refund outside Pulse; payment history is retained.</p>}
          <div className="commerce-actions">{selected.state === "draft" && <><button className="button subtle" onClick={() => editOrder(selected)}>Edit draft</button><button className="button primary" disabled={busy} onClick={() => action("submit")}>Submit for confirmation</button></>}{selected.state === "pending_confirmation" && <><button className="button subtle" disabled={busy} onClick={() => action("edit")}>Return to draft</button><button className="button primary" disabled={busy} onClick={() => action("confirm")}>Confirm & reserve stock</button></>}{selected.state === "confirmed" && <button className="button primary" disabled={busy} onClick={() => action("process")}>Start processing</button>}{selected.state === "processing" && <button className="button primary" disabled={busy} onClick={() => action("complete")}>Complete order</button>}{!["completed", "cancelled"].includes(selected.state) && <button className="button danger" disabled={busy} onClick={() => action("cancel")}>Cancel order</button>}</div>
          <h3>Payments</h3>{selected.commerce_payments?.map(item => <div className="order-summary-row" key={item.id}><span>{item.method} · {new Date(item.created_at).toLocaleString()} {item.note && `· ${item.note}`}</span><strong>{money(item.amount_minor, selected.currency_code)}</strong></div>)}{["confirmed", "processing", "completed"].includes(selected.state) && <form className="commerce-inline payment-form" onSubmit={recordPayment}><input aria-label="Payment amount" placeholder="Amount" inputMode="decimal" required value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} /><select aria-label="Payment method" value={payment.method} onChange={e => setPayment({ ...payment, method: e.target.value })}>{["cash", "bank", "card", "bkash", "nagad", "rocket", "other"].map(method => <option key={method}>{method}</option>)}</select><input aria-label="Payment note" placeholder="Note (optional)" value={payment.note} onChange={e => setPayment({ ...payment, note: e.target.value })} /><button className="button subtle" disabled={busy}>Record payment</button></form>}</section>
        : <section className="commerce-card commerce-empty">Choose an order or create a new one.</section>}
      </div></div>
  </main>;
}

export default function OrdersPage() {
  return <WorkspaceShell>{workspace => <OrdersContent key={workspace.tenantId} tenantId={workspace.tenantId} />}</WorkspaceShell>;
}
