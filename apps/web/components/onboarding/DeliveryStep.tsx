"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Truck } from "@/components/icons";
import { api } from "@/lib/api";

type Delivery = {
  inside_dhaka_fee_minor: number; outside_dhaka_fee_minor: number;
  inside_dhaka_days: number; outside_dhaka_days: number;
  cod_enabled: boolean; free_delivery_threshold_minor: number | null; notes: string;
};
type Form = { insideFee: string; outsideFee: string; insideDays: string; outsideDays: string; cod: boolean; freeFrom: string; notes: string };

const defaults: Form = { insideFee: "60", outsideFee: "120", insideDays: "1", outsideDays: "3", cod: true, freeFrom: "", notes: "" };
const toMinor = (taka: string) => Math.round(Number(taka || 0) * 100);
const toTaka = (minor: number) => String(minor / 100);

export default function DeliveryStep({ tenantId, onBack, onDone }: { tenantId: string; onBack: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Form>(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Delivery | null>(`/tenants/${tenantId}/delivery`).then(saved => {
      if (!saved) return;
      setForm({ insideFee: toTaka(saved.inside_dhaka_fee_minor), outsideFee: toTaka(saved.outside_dhaka_fee_minor),
        insideDays: String(saved.inside_dhaka_days), outsideDays: String(saved.outside_dhaka_days), cod: saved.cod_enabled,
        freeFrom: saved.free_delivery_threshold_minor === null ? "" : toTaka(saved.free_delivery_threshold_minor), notes: saved.notes });
    }).catch(() => {});
  }, [tenantId]);

  function set<K extends keyof Form>(key: K, value: Form[K]) { setForm(current => ({ ...current, [key]: value })); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/tenants/${tenantId}/delivery`, { method: "PUT", body: JSON.stringify({
        inside_dhaka_fee_minor: toMinor(form.insideFee), outside_dhaka_fee_minor: toMinor(form.outsideFee),
        inside_dhaka_days: Number(form.insideDays), outside_dhaka_days: Number(form.outsideDays),
        cod_enabled: form.cod, free_delivery_threshold_minor: form.freeFrom.trim() ? toMinor(form.freeFrom) : null,
        notes: form.notes,
      }) });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save delivery details");
      setBusy(false);
    }
  }

  return <form className="onb-card" onSubmit={submit}>
    <span className="onb-glyph"><Truck size={26} weight="duotone" /></span>
    <h1>How do you deliver?</h1>
    <p>Your assistant quotes these fees and times, and confirmed orders are charged the right zone fee automatically.</p>
    <div className="onb-zones">
      <fieldset className="onb-zone"><legend>Inside Dhaka</legend>
        <label>Delivery fee<div className="input-shell onb-money"><span>৳</span><input required type="number" min={0} step="1" inputMode="numeric" value={form.insideFee} onChange={event => set("insideFee", event.target.value)} /></div></label>
        <label>Arrives in<div className="input-shell onb-days"><input required type="number" min={0} max={60} inputMode="numeric" value={form.insideDays} onChange={event => set("insideDays", event.target.value)} /><span>days</span></div></label>
      </fieldset>
      <fieldset className="onb-zone"><legend>Outside Dhaka</legend>
        <label>Delivery fee<div className="input-shell onb-money"><span>৳</span><input required type="number" min={0} step="1" inputMode="numeric" value={form.outsideFee} onChange={event => set("outsideFee", event.target.value)} /></div></label>
        <label>Arrives in<div className="input-shell onb-days"><input required type="number" min={0} max={60} inputMode="numeric" value={form.outsideDays} onChange={event => set("outsideDays", event.target.value)} /><span>days</span></div></label>
      </fieldset>
    </div>
    <div className="onb-row">
      <label className="onb-toggle"><input type="checkbox" checked={form.cod} onChange={event => set("cod", event.target.checked)} /><span><b>Cash on delivery</b><small>Customers can pay the rider.</small></span></label>
      <label>Free delivery from <small>(optional)</small><div className="input-shell onb-money"><span>৳</span><input type="number" min={0} step="1" inputMode="numeric" placeholder="No free delivery" value={form.freeFrom} onChange={event => set("freeFrom", event.target.value)} /></div></label>
    </div>
    <label className="onb-field">Anything else customers should know? <small>(optional)</small>
      <textarea maxLength={1000} rows={3} value={form.notes} onChange={event => set("notes", event.target.value)} placeholder="e.g. No delivery on Fridays. Advance payment for orders over ৳5,000." />
    </label>
    {error && <p className="form-notice" role="alert">{error}</p>}
    <div className="onb-actions"><button type="button" className="button subtle" onClick={onBack}><ArrowLeft size={16} /> Back</button>
      <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Continue"}<ArrowRight size={16} /></button></div>
  </form>;
}
