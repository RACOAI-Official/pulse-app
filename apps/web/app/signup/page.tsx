"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Mail } from "@/components/icons";
import { publicApi } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export default function Signup() {
  const router = useRouter();
  const [step, setStep] = useState<"details" | "code">("details");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setNotice("");
    try {
      await publicApi("/auth/signup/start", { email, business_name: businessName });
      setStep("code"); setCooldown(60);
      setNotice(`We sent a 6-digit code to ${email}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send the code");
    } finally { setBusy(false); }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setNotice("");
    try {
      await publicApi("/auth/signup/verify", { email, code, password });
      const { error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/dashboard");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sign-up failed");
      setBusy(false);
    }
  }

  return <main className="auth-screen callback-screen">
    <div className="auth-brand"><span className="brand-mark">P</span><span>pulse<span className="brand-dot">.</span></span></div>
    <section className="auth-card">
      <div className="eyebrow">{step === "details" ? "CREATE ACCOUNT" : "CHECK YOUR EMAIL"}</div>
      <h2>{step === "details" ? "Start with Pulse" : "Enter your code"}</h2>
      <p>{step === "details" ? "We'll email you a code to confirm your address." : "Type the code from the email and choose a password."}</p>
      {step === "details" ? <form onSubmit={sendCode}>
        <label>Business name<div className="input-shell"><input required maxLength={120} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Your shop or company" /></div></label>
        <label>Email address<div className="input-shell"><Mail size={18} /><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></div></label>
        {notice && <div className="form-notice" role="status">{notice}</div>}
        <button type="submit" className="button primary wide" disabled={busy}>{busy ? "Sending…" : "Send code"}<ArrowRight size={17} /></button>
      </form> : <form onSubmit={createAccount}>
        <label>6-digit code<div className="input-shell"><input required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" autoFocus /></div></label>
        <div className="auth-password-field"><label htmlFor="signup-password">Password</label><div className="input-shell"><LockKeyhole size={18} /><input id="signup-password" type={showPassword ? "text" : "password"} required minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></div></div>
        {notice && <div className="form-notice" role="status">{notice}</div>}
        <button type="submit" className="button primary wide" disabled={busy}>{busy ? "Creating account…" : "Create account"}<ArrowRight size={17} /></button>
        <div className="auth-code-actions"><button type="button" className="text-button" disabled={busy || cooldown > 0} onClick={() => sendCode()}>{cooldown ? `Resend code in ${cooldown}s` : "Resend code"}</button><button type="button" className="text-button" onClick={() => { setStep("details"); setCode(""); setNotice(""); }}>Change email</button></div>
      </form>}
      <p className="auth-signup-link">Already have an account? <Link href="/login">Sign in</Link></p>
    </section>
  </main>;
}
