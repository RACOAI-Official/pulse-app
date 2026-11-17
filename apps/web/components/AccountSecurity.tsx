"use client";

import { FormEvent, useEffect, useState } from "react";
import { LockKeyhole, Mail, ShieldCheck } from "@/components/icons";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";

const MIN_LENGTH = 8;

/** Account section for every role: shows the sign-in email and lets the user change their password. */
export default function AccountSecurity() {
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    supabase().auth.getUser().then(({ data }) => setEmail(data.user?.email || "")).catch(() => {});
  }, []);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const sameAsCurrent = next.length > 0 && next === current;
  const ready = current.length > 0 && next.length >= MIN_LENGTH && confirm === next && !sameAsCurrent;

  function reset() {
    setCurrent(""); setNext(""); setConfirm(""); setShow(false); setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/me/password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) });
      reset(); setOpen(false);
      setNotice("Password updated. Other devices were signed out.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the password");
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    if (!email) return;
    setBusy(true); setError(""); setNotice("");
    const { error: failed } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback` });
    setBusy(false);
    if (failed) setError(failed.message);
    else setNotice(`We emailed a reset link to ${email}.`);
  }

  const type = show ? "text" : "password";
  return <section className="settings-section account-section">
    <div className="settings-section-heading"><div><h2>Account</h2></div><ShieldCheck size={20} /></div>
    <div className="account-row">
      <div><span className="account-label">Sign-in email</span><strong className="account-email"><Mail size={16} />{email || "—"}</strong></div>
      {!open && <button type="button" className="button primary" onClick={() => { setOpen(true); setNotice(""); }}>
        <LockKeyhole size={16} />Change password</button>}
    </div>
    {open && <form className="password-form" onSubmit={submit} noValidate>
      <label htmlFor="pw-current">Current password
        <div className="input-shell"><LockKeyhole size={18} /><input id="pw-current" type={type} autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)} /></div>
      </label>
      <label htmlFor="pw-new">New password
        <div className="input-shell"><LockKeyhole size={18} /><input id="pw-new" type={type} autoComplete="new-password" required minLength={MIN_LENGTH} maxLength={72} aria-invalid={tooShort || sameAsCurrent} aria-describedby="pw-new-hint" value={next} onChange={event => setNext(event.target.value)} /></div>
        <small id="pw-new-hint" className={tooShort || sameAsCurrent ? "error-text" : ""}>{sameAsCurrent ? "Use a password that differs from the current one." : `At least ${MIN_LENGTH} characters.`}</small>
      </label>
      <label htmlFor="pw-confirm">Confirm new password
        <div className="input-shell"><LockKeyhole size={18} /><input id="pw-confirm" type={type} autoComplete="new-password" required aria-invalid={mismatch} aria-describedby="pw-confirm-hint" value={confirm} onChange={event => setConfirm(event.target.value)} /></div>
        <small id="pw-confirm-hint" className={mismatch ? "error-text" : ""}>{mismatch ? "Passwords do not match." : " "}</small>
      </label>
      <label className="settings-note password-show"><input type="checkbox" checked={show} onChange={event => setShow(event.target.checked)} /> Show passwords</label>
      <div className="commerce-actions">
        <button type="submit" className="button primary" disabled={busy || !ready}>{busy ? "Updating…" : "Update password"}</button>
        <button type="button" className="button subtle" disabled={busy} onClick={() => { reset(); setOpen(false); }}>Cancel</button>
        <button type="button" className="text-button" disabled={busy || !email} onClick={sendReset}>Forgot current password?</button>
      </div>
    </form>}
    {error && <p className="form-notice error-text" role="alert">{error}</p>}
    {notice && <p className="form-notice" role="status">{notice}</p>}
  </section>;
}
