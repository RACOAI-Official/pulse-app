'use client';

/**
 * SECTION 06 — Closing CTA.
 * Preserves the original pinned 300vh reveal (side columns slide out while
 * the centre card widens and the CTA fades in) and the gentle bobbing of the
 * former floating-image composition.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ANCHORS, CLOSING } from '@/content/pulse';
import { CTAButton } from '../ui/primitives';
import { MiniStat, OrderDraftCard, ProductQuoteCard } from '../ui/mocks';
import PulseMark from '../ui/PulseMark';

function Bob({ children, i, className = '' }: { children: React.ReactNode; i: number; className?: string }) {
  return (
    <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 4 + i, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }} className={className}>
      {children}
    </motion.div>
  );
}

function Photo({ src, className = '' }: { src: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-[1.75rem] shadow-lift ${className}`}>
      <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
    </div>
  );
}

export default function ClosingCTA() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const u = () => setMobile(window.innerWidth < 1024);
    u();
    window.addEventListener('resize', u);
    return () => window.removeEventListener('resize', u);
  }, []);

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const done = useMotionValue(1);
  const p = reduce ? done : scrollYProgress;

  const xLeft = useTransform(p, [0, 0.5], [0, -800]);
  const xRight = useTransform(p, [0, 0.5], [0, 800]);
  const opacitySides = useTransform(p, [0, 0.4], [1, 0]);
  const width = useTransform(p, [0, 0.6], [mobile ? '88%' : '42%', '94%']);
  const height = useTransform(p, [0, 0.6], [mobile ? '62svh' : '60vh', mobile ? '82svh' : '82vh']);
  const contentOpacity = useTransform(p, [0.35, 0.65], [0, 1]);
  const contentY = useTransform(p, [0.35, 0.65], [30, 0]);
  const buttonScale = useTransform(p, [0.4, 0.7], [0.85, 1]);
  const teaserOpacity = useTransform(p, [0.15, 0.35], [1, 0]);

  return (
    <section ref={ref} id={ANCHORS.requestAccess} aria-label="Request beta access" className={`relative bg-mesh-soft ${reduce ? 'py-16' : 'h-[300vh]'}`}>
      <div className={`${reduce ? '' : 'sticky top-0 h-[100svh]'} flex w-full items-center justify-center overflow-hidden`}>
        <div className="relative flex h-full w-full max-w-[1600px] items-center justify-center px-4">
          {/* LEFT COLUMN */}
          <motion.div style={{ x: xLeft, opacity: opacitySides }} className="absolute left-4 top-1/2 hidden w-[22%] -translate-y-1/2 flex-col gap-6 lg:flex" aria-hidden>
            <Bob i={0}><Photo src="/media/products/vase.webp" className="aspect-[4/5] w-full" /></Bob>
            <Bob i={1} className="-mt-16 ml-auto w-[80%]"><MiniStat label="Orders drafted by AI" value="57" trend="Demo week" className="shadow-lift" /></Bob>
          </motion.div>

          {/* CENTRE CARD */}
          <motion.div style={{ width, height }} className="relative z-20 flex-shrink-0 overflow-hidden rounded-[2.5rem] bg-mesh-deep shadow-lift">
            {/* teaser composition visible while narrow */}
            <motion.div style={{ opacity: teaserOpacity }} className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6" aria-hidden>
              <ProductQuoteCard className="w-[260px] -rotate-3" />
              <div className="w-[260px] rotate-2"><OrderDraftCard compact /></div>
            </motion.div>

            {/* CTA */}
            <motion.div style={{ opacity: contentOpacity, y: contentY }} className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white sm:p-10">
              <span className="mb-8 grid h-16 w-16 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur sm:h-20 sm:w-20">
                <PulseMark className="h-auto w-[62%] text-white" title="Pulse" />
              </span>
              <h2 className="text-balance font-display text-[40px] font-semibold leading-[0.98] tracking-[-0.035em] sm:text-6xl lg:text-8xl">
                {CLOSING.headline[0]} <br className="hidden sm:block" />
                <span className="text-brand">{CLOSING.headline[1]}</span>
              </h2>
              <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-white/80 sm:text-lg">{CLOSING.body}</p>
              <motion.div style={{ scale: buttonScale }} className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
                <CTAButton href={CLOSING.primary.href} variant="light" size="lg">{CLOSING.primary.label}</CTAButton>
                <a
                  href={CLOSING.secondary.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full px-6 py-3 text-base font-semibold text-white underline-offset-4 ring-1 ring-white/30 transition hover:bg-white/10 sm:text-lg"
                >
                  {CLOSING.secondary.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </motion.div>
            </motion.div>
          </motion.div>

          {/* RIGHT COLUMN */}
          <motion.div style={{ x: xRight, opacity: opacitySides }} className="absolute right-4 top-1/2 hidden w-[22%] -translate-y-[40%] flex-col gap-6 lg:flex" aria-hidden>
            <Bob i={2} className="w-[88%]"><OrderDraftCard state="confirmed" compact className="shadow-lift" /></Bob>
            <Bob i={3}><Photo src="/media/products/chair.webp" className="aspect-[4/5] w-full" /></Bob>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
