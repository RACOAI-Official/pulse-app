"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { courierLabel } from "@/lib/commerce";

type CourierRow = { courier: string; courier_name: string | null; handoffs: number; delivered: number; returned: number; delivery_fees_lost_minor: number; damage_loss_minor: number; sale_value_lost_minor: number };
type ReturnRow = { id: string; order_id: string; courier: string; courier_name: string | null; tracking_code: string | null; returned_at: string; return_note: string | null; delivery_fee_minor: number | null; damage_loss_minor: number; sale_value_minor: number; customer_name: string; damaged_items: { product_title: string; sku: string; damaged_quantity: number }[] };
type Report = { days: number; currency: string; couriers: CourierRow[]; returns: ReturnRow[] };

const money = (minor: number, currency: string) => new Intl.NumberFormat("en-BD", { style: "currency", currency }).format(minor / 100);

export default function CourierReturns({ tenantId, days }: { tenantId: string; days: number }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    api<Report>(`/tenants/${tenantId}/analytics/courier-returns?days=${days}`).then(setReport)
      .catch(caught => setError(caught instanceof Error ? caught.message : "Courier report unavailable"));
  }, [tenantId, days]);

  if (error) return <section className="insights-card wide"><h2>Courier returns</h2><p className="insights-empty">{error}</p></section>;
  if (!report) return <section className="insights-card wide"><h2>Courier returns</h2><p className="insights-empty">Loading…</p></section>;
  const c = report.currency;
  const sum = (key: keyof CourierRow) => report.couriers.reduce((total, row) => total + Number(row[key]), 0);
  const cashLoss = sum("delivery_fees_lost_minor") + sum("damage_loss_minor");
  return <section className="insights-card wide">
    <div className="insights-card-head"><div><h2>Courier returns</h2><p className="insights-empty">Parcels handed off in the last {report.days} days. Cash loss = delivery fees paid on returned parcels + damaged or lost goods.</p></div><span>{money(cashLoss, c)} cash loss</span></div>
    {report.couriers.length === 0 ? <p className="insights-empty">No courier handoffs in this period.</p> : <>
      <div style={{ overflowX: "auto" }}><table className="courier-table">
        <thead><tr><th>Courier</th><th>Handed off</th><th>Delivered</th><th>Returned</th><th>Return rate</th><th>Delivery fees lost</th><th>Damage loss</th><th>Cash loss</th><th>Sale value lost</th></tr></thead>
        <tbody>{report.couriers.map(row => <tr key={`${row.courier}:${row.courier_name || ""}`}>
          <td>{courierLabel(row.courier, row.courier_name)}</td><td>{row.handoffs}</td><td>{row.delivered}</td><td>{row.returned}</td>
          <td>{Math.round(100 * row.returned / Math.max(1, row.handoffs))}%</td>
          <td>{money(row.delivery_fees_lost_minor, c)}</td><td>{money(row.damage_loss_minor, c)}</td>
          <td><strong>{money(row.delivery_fees_lost_minor + row.damage_loss_minor, c)}</strong></td><td>{money(row.sale_value_lost_minor, c)}</td>
        </tr>)}</tbody>
      </table></div>
      <h3>Returned parcels</h3>
      {report.returns.length === 0 ? <p className="insights-empty">No returns in this period.</p> : report.returns.map(row => <div className="insights-list-row" key={row.id}>
        <strong>{new Date(row.returned_at).toLocaleDateString("en-BD", { month: "short", day: "numeric" })} · {row.customer_name || "Customer"} · {courierLabel(row.courier, row.courier_name)}{row.tracking_code && ` #${row.tracking_code}`}</strong>
        <span>{row.return_note || "No reason recorded"}{row.damaged_items.length > 0 && ` · damaged: ${row.damaged_items.map(item => `${item.damaged_quantity}× ${item.product_title}`).join(", ")}`} · loss {money((row.delivery_fee_minor || 0) + row.damage_loss_minor, c)} · sale {money(row.sale_value_minor, c)}</span>
      </div>)}
    </>}
  </section>;
}
