"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { CommerceOrder, Courier, courierLabel, couriers, decimal, money, Shipment, toMinor } from "@/lib/commerce";

const statusLabel = (state: string) => state === "booked" ? "handed off" : state.replaceAll("_", " ");
const optionalMinor = (value: string) => value.trim() ? toMinor(value) : null;

type Props = {
  base: string;
  order: CommerceOrder;
  role: string;
  shipment: Shipment | null;
  busy: boolean;
  run: (work: () => Promise<void>) => Promise<void>;
  onShipment: (shipment: Shipment) => void;
};

export default function CourierPanel({ base, order, role, shipment, busy, run, onShipment }: Props) {
  const url = `${base}/orders/${order.id}/shipment`;
  const canManage = role !== "staff";
  const open = ["confirmed", "processing"].includes(order.state);
  const closed = shipment && ["delivered", "returned"].includes(shipment.state);
  const [editing, setEditing] = useState(false);
  const [handoff, setHandoff] = useState({ courier: "" as Courier | "", name: "", tracking: "", fee: "" });
  const [status, setStatus] = useState("picked_up");
  const [returning, setReturning] = useState(false);
  const [damaged, setDamaged] = useState<Record<string, number>>({});
  const [ret, setRet] = useState({ loss: "", fee: "", note: "" });

  function startHandoff() {
    setHandoff(shipment
      ? { courier: shipment.provider, name: shipment.courier_name || "", tracking: shipment.tracking_code || "", fee: decimal(shipment.delivery_fee_minor) }
      : { courier: "", name: "", tracking: "", fee: "" });
    setEditing(true);
  }
  async function saveHandoff(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      onShipment(await api<Shipment>(url, { method: "POST", body: JSON.stringify({
        courier: handoff.courier, courier_name: handoff.courier === "other" ? handoff.name : null,
        tracking_code: handoff.tracking || null, delivery_fee_minor: optionalMinor(handoff.fee) }) }));
      setEditing(false);
    });
  }
  async function saveStatus() {
    await run(async () => { onShipment(await api<Shipment>(`${url}/status`, { method: "POST", body: JSON.stringify({ state: status }) })); });
  }
  function startReturn() {
    setDamaged({}); setRet({ loss: "", fee: decimal(shipment?.delivery_fee_minor), note: "" }); setReturning(true);
  }
  async function saveReturn(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      onShipment(await api<Shipment>(`${url}/return`, { method: "POST", body: JSON.stringify({
        damaged: Object.entries(damaged).filter(([, quantity]) => quantity > 0).map(([item_id, quantity]) => ({ item_id, quantity })),
        damage_loss_minor: optionalMinor(ret.loss) ?? 0, delivery_fee_minor: optionalMinor(ret.fee), note: ret.note }) }));
      setReturning(false);
    });
  }

  const items = order.commerce_order_items || [];
  const damagedRows = shipment?.commerce_shipment_return_items || [];
  return <>
    <h3>Courier delivery</h3>
    {shipment ? <>
      <div className="order-summary-row"><span>Courier</span><strong>{courierLabel(shipment.provider, shipment.courier_name)}</strong></div>
      <div className="order-summary-row"><span>Status</span><strong className="commerce-state">{statusLabel(shipment.state)}</strong></div>
      <div className="order-summary-row"><span>Tracking / consignment</span><strong>{shipment.tracking_code || "Not recorded"}</strong></div>
      <div className="order-summary-row"><span>Cash to collect (COD)</span><strong>{money(shipment.cod_minor, order.currency_code)}</strong></div>
      <div className="order-summary-row"><span>Delivery fee paid</span><strong>{shipment.delivery_fee_minor == null ? "Not recorded" : money(shipment.delivery_fee_minor, order.currency_code)}</strong></div>
      {shipment.state === "returned" && <p className="refund-notice">Returned {shipment.returned_at && new Date(shipment.returned_at).toLocaleDateString()}{shipment.return_note && ` · ${shipment.return_note}`}. Damage loss {money(shipment.damage_loss_minor, order.currency_code)}{damagedRows.length > 0 && ` (${damagedRows.map(row => `${row.damaged_quantity}× ${items.find(item => item.id === row.order_item_id)?.product_title || "item"}`).join(", ")} not restocked)`}.</p>}
    </> : <p>{open ? "Not handed to a courier yet. Courier delivery is optional; pick any courier when ready." : "No courier handoff."}</p>}

    {canManage && open && !closed && !editing && !returning && <div className="commerce-actions">
      <button className="button subtle" disabled={busy} onClick={startHandoff}>{shipment ? "Edit handoff" : "Hand off to courier"}</button>
      {shipment && <button className="button danger" disabled={busy} onClick={startReturn}>Record return</button>}
    </div>}

    {canManage && editing && <form className="commerce-form-grid payment-form" onSubmit={saveHandoff}>
      <label>Courier<select required value={handoff.courier} onChange={e => setHandoff({ ...handoff, courier: e.target.value as Courier })}><option value="" disabled>Choose courier</option>{Object.entries(couriers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {handoff.courier === "other" && <label>Courier name<input required maxLength={80} value={handoff.name} onChange={e => setHandoff({ ...handoff, name: e.target.value })} /></label>}
      <label>Tracking / consignment (optional)<input maxLength={100} value={handoff.tracking} onChange={e => setHandoff({ ...handoff, tracking: e.target.value })} /></label>
      <label>Delivery fee you pay (optional)<input inputMode="decimal" placeholder="0.00" value={handoff.fee} onChange={e => setHandoff({ ...handoff, fee: e.target.value })} /></label>
      <div className="wide commerce-actions"><button className="button primary" disabled={busy}>Save handoff</button><button type="button" className="button subtle" onClick={() => setEditing(false)}>Cancel</button></div>
    </form>}

    {canManage && open && shipment && !closed && shipment.state !== "failed" && !editing && !returning && <div className="commerce-inline payment-form">
      <select aria-label="Courier status" value={status} onChange={e => setStatus(e.target.value)}>{["picked_up", "in_transit", "delivered", "failed", "review"].map(state => <option key={state} value={state}>{statusLabel(state)}</option>)}</select>
      <button className="button subtle" disabled={busy} onClick={saveStatus}>Update status</button>
    </div>}

    {canManage && returning && <form className="commerce-form-grid payment-form" onSubmit={saveReturn}>
      <p className="wide">The order will be cancelled and stock restored, except units you mark damaged or lost.</p>
      {items.map(item => <label key={item.id}>Damaged / lost: {item.product_title} ({item.sku}, ordered {item.quantity})<input type="number" min={0} max={item.quantity} value={damaged[item.id] ?? 0} onChange={e => setDamaged({ ...damaged, [item.id]: Math.min(item.quantity, Math.max(0, Number(e.target.value) || 0)) })} /></label>)}
      <label>Damage loss amount<input inputMode="decimal" placeholder="0.00" value={ret.loss} onChange={e => setRet({ ...ret, loss: e.target.value })} /></label>
      <label>Delivery fee paid<input inputMode="decimal" placeholder="0.00" value={ret.fee} onChange={e => setRet({ ...ret, fee: e.target.value })} /></label>
      <label className="wide">Reason / note<input maxLength={500} placeholder="e.g. customer refused, wrong address" value={ret.note} onChange={e => setRet({ ...ret, note: e.target.value })} /></label>
      <div className="wide commerce-actions"><button className="button danger" disabled={busy}>Confirm return</button><button type="button" className="button subtle" onClick={() => setReturning(false)}>Back</button></div>
    </form>}
  </>;
}
