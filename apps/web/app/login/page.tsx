"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, LockKeyhole } from "@/components/icons";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      if (reset) {
        const { error } = await supabase().auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback`,
        });
        if (error) throw error;
        setNotice("Check your email for a recovery link.");
      } else {
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/dashboard");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-screen">
    <header className="login-header"><div className="auth-brand"><span className="brand-mark">P</span><span>pulse<span className="brand-dot">.</span></span></div><span className="login-header-note">Your operations workspace</span></header>
    <div className="auth-grid auth-grid-centered">
      <section className="auth-story">
        <div className="eyebrow">CUSTOMER OPERATIONS / ONE VIEW</div>
        <h1>Every conversation,<br /><em>in rhythm.</em></h1>
        <p>Bring your customer messages into one focused workspace. Your team stays close to every reply.</p>
        <div className="auth-lines" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
      </section>
      <section className="auth-card auth-card-login">
        <div className="eyebrow">{reset ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</div>
        <h2>{reset ? "Reset your password" : "Sign in to Pulse"}</h2>
        <p>{reset ? "We will email you a secure recovery link." : "Pick up the conversation where your team left off."}</p>
        <form onSubmit={submit}>
          <label>Email address<div className="input-shell"><Mail size={18} /><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></div></label>
          {!reset && <div className="auth-password-field"><label htmlFor="login-password">Password</label><div className="input-shell"><LockKeyhole size={18} /><input id="login-password" type={showPassword ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" /><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></div></div>}
          {notice && <div className="form-notice" role="status">{notice}</div>}
          <button type="submit" className="button primary wide" disabled={busy}>{busy ? "Please wait…" : reset ? "Send recovery link" : "Sign in"}<ArrowRight size={17} /></button>
        </form>
        <button className="text-button auth-switch" onClick={() => { setReset(!reset); setNotice(""); }}>{reset ? "Back to sign in" : "Forgot password?"}</button>
        {!reset && <p className="auth-signup-link">New to Pulse? <Link href="/signup">Create an account</Link></p>}
      </section>
      <div className="login-doodle login-doodle-left" aria-hidden="true"><span className="doodle-speech"><i /><i /></span><span className="doodle-block" /></div>
      <div className="login-doodle login-doodle-right" aria-hidden="true"><span className="doodle-speech"><i /><i /></span></div>
      <svg className="login-flourish login-flourish-top" viewBox="0 0 180 65" fill="none" aria-hidden="true"><path d="M2 42c18 22 27-32 40-12 10 17 19 25 31 0 11-24 20 30 33 8 12-19 30-13 40-4 8 8 17 2 31-6" /><circle cx="153" cy="8" r="3" /></svg>
      <svg className="login-flourish login-flourish-bottom" viewBox="0 0 150 72" fill="none" aria-hidden="true"><path d="M2 43c16 15 28 12 39-5 9-14 18-12 23 5 5 16 17 14 25-2 9-18 23-15 31 1 5 11 14 15 28 0" /><circle cx="24" cy="9" r="3" /><circle cx="128" cy="66" r="2" /></svg>
      <svg className="login-art login-art-orbit" viewBox="0 0 110 110" fill="none" aria-hidden="true"><circle cx="55" cy="55" r="31" /><path d="M12 61c20-19 61-32 85-17M18 78c25 10 54 4 78-14" /><circle cx="86" cy="20" r="4" /></svg>
      <svg className="login-art login-art-spark" viewBox="0 0 92 92" fill="none" aria-hidden="true"><path d="M46 5v22m0 38v22M5 46h22m38 0h22M18 18l16 16m24 24 16 16m0-56L58 34M34 58 18 74" /><circle cx="46" cy="46" r="10" /></svg>
      <svg className="login-art login-art-leaf" viewBox="0 0 132 94" fill="none" aria-hidden="true"><path d="M15 82c27-17 47-35 69-64M29 68C15 58 14 43 18 32c16 3 27 10 30 22M55 45c-2-19 6-34 22-41 7 18 3 32-9 43M77 28c13-13 28-15 42-9-2 20-15 31-34 29" /></svg>
      <svg className="login-window" viewBox="0 0 380 310" fill="none" aria-hidden="true">
        <defs><linearGradient id="login-sky" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#e8f0dc"/><stop offset="1" stopColor="#f7f8ef"/></linearGradient><clipPath id="login-window-clip"><rect x="23" y="20" width="334" height="263" rx="5"/></clipPath></defs>
        <rect x="16" y="13" width="348" height="278" rx="8" fill="#f9faf5" stroke="#aabb9f" strokeWidth="2"/>
        <g clipPath="url(#login-window-clip)">
          <rect x="23" y="20" width="334" height="263" fill="url(#login-sky)"/>
          <circle className="window-sun" cx="278" cy="73" r="25" fill="#d9e8a4"/>
          <g className="window-cloud window-cloud-one" fill="#fff" opacity=".66"><ellipse cx="86" cy="88" rx="33" ry="9"/><ellipse cx="107" cy="82" rx="22" ry="11"/></g>
          <g className="window-cloud window-cloud-two" fill="#fff" opacity=".5"><ellipse cx="226" cy="118" rx="29" ry="7"/><ellipse cx="244" cy="113" rx="17" ry="9"/></g>
          <path d="M23 208c48-47 91-45 137-16 50-49 100-46 197-9v100H23z" fill="#c9dac0"/>
          <path d="M23 241c59-36 112-31 168-8 53-39 103-37 166-16v66H23z" fill="#9bb997"/>
          <g className="window-trees" stroke="#718f74" strokeWidth="3" strokeLinecap="round"><path d="M68 248v-47m0 23-15-14m15 8 13-18M107 249v-57m0 27-15-17m15 6 14-18M319 243v-50m0 22-14-16m14 9 12-19"/></g>
          <path className="window-curtain window-curtain-left" d="M23 20h65c-17 34-10 58-24 82-12 23-20 45-16 74-23-31-21-65-25-99V20z" fill="#d9e6d4" stroke="#aec2ab"/>
          <path className="window-curtain window-curtain-right" d="M357 20h-65c17 34 10 58 24 82 12 23 20 45 16 74 23-31 21-65 25-99V20z" fill="#d9e6d4" stroke="#aec2ab"/>
        </g>
        <path d="M190 14v276M16 155h348" stroke="#aabb9f" strokeWidth="5"/>
        <path d="M5 294h370" stroke="#9cae96" strokeWidth="8" strokeLinecap="round"/>
      </svg>
      <img className="login-illustration" src="/login-illustration.png" alt="" aria-hidden="true" />
    </div>
    <div className="auth-footer">Pulse workspace <span>© 2026 Pulse</span></div>
  </main>;
}
