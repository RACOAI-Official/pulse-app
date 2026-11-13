"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const DotLottieReact = dynamic(
  () => import("@lottiefiles/dotlottie-react").then(module => module.DotLottieReact),
  { ssr: false },
);

export function LoadingAnimation({ label = "Loading" }: { label?: string }) {
  const [allowMotion, setAllowMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAllowMotion(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  return <div className="loading-animation" role="status" aria-label={label}>
    {allowMotion ? <DotLottieReact src="/loading.lottie" loop autoplay /> : <span className="loading-still" aria-hidden="true" />}
  </div>;
}

export function BootLoading({ message = "Opening workspace…" }: { message?: string }) {
  return <main className="loading-screen boot-loading"><LoadingAnimation label={message} /><p>{message}</p></main>;
}

export function SectionSkeleton({ variant = "list" }: { variant?: "list" | "dashboard" | "agent" | "inbox" }) {
  return <div className={`section-skeleton section-skeleton-${variant}`} role="status" aria-label="Loading section">
    {variant === "dashboard" ? <>
      <div className="skeleton-metrics">{Array.from({ length: 6 }, (_, index) => <div className="skeleton-card" key={index}><i className="skeleton-line short" /><i className="skeleton-line number" /><i className="skeleton-line medium" /></div>)}</div>
      <div className="skeleton-columns"><div className="skeleton-card tall"><i className="skeleton-line medium" /><i className="skeleton-chart" /></div><div className="skeleton-card tall"><i className="skeleton-line medium" /><i className="skeleton-line" /><i className="skeleton-line" /><i className="skeleton-line" /></div></div>
    </> : variant === "agent" ? <div className="skeleton-columns agent"><div>{Array.from({ length: 3 }, (_, index) => <div className="skeleton-card agent-card-placeholder" key={index}><i className="skeleton-line medium" /><i className="skeleton-line" /><i className="skeleton-line tall-line" /></div>)}</div><div className="skeleton-card phone-placeholder" /></div>
    : variant === "inbox" ? <div className="skeleton-inbox"><div className="skeleton-inbox-list">{Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index}><i className="skeleton-avatar" /><span><i className="skeleton-line medium" /><i className="skeleton-line short" /></span></div>)}</div><div className="skeleton-inbox-chat"><i className="skeleton-line medium" /><div className="skeleton-chat-space" /><i className="skeleton-line" /></div></div>
    : <div className="skeleton-card list-placeholder"><i className="skeleton-line medium" />{Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index}><i className="skeleton-avatar" /><span><i className="skeleton-line medium" /><i className="skeleton-line short" /></span></div>)}</div>}
  </div>;
}
