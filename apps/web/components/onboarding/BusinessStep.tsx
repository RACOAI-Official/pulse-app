"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Storefront } from "@/components/icons";
import { api } from "@/lib/api";

export default function BusinessStep({ tenantId, initialName, onDone }: { tenantId: string; initialName: string; onDone: () => void }) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/tenants/${tenantId}/onboarding/business`, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the name");
      setBusy(false);
    }
  }

  return <form className="onb-card onb-narrow" onSubmit={submit}>
    <span className="onb-glyph"><Storefront size={26} weight="duotone" /></span>
    <h1>What should customers call your business?</h1>
    <p>Your assistant introduces itself with this name in every chat. You can change it later.</p>
    <label className="onb-field">Business name
      <div className="input-shell"><input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Nakshi Threads" /></div>
    </label>
    {error && <p className="form-notice" role="alert">{error}</p>}
    <div className="onb-actions"><span /><button className="button primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Continue"}<ArrowRight size={16} /></button></div>
  </form>;
}
