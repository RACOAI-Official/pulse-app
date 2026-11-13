"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const DotLottieReact = dynamic(
  () => import("@lottiefiles/dotlottie-react").then(module => module.DotLottieReact),
  { ssr: false },
);

export default function LoadingAnimation() {
  const [allowMotion, setAllowMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAllowMotion(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  return <div className="site-loading-animation" role="status" aria-label="Loading Pulse">
    {allowMotion ? <DotLottieReact src="/media/loading.lottie" loop autoplay /> : <span className="site-loading-still" aria-hidden="true" />}
  </div>;
}
