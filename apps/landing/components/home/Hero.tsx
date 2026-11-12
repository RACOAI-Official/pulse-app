'use client';

/**
 * SECTION 01 — Signature hero.
 *
 * Preserved from the original: the 400vh pinned scroll track, the oversized
 * PULSE wordmark, the centre card that tilts with mouse velocity, the
 * thumbnail-to-fullscreen expansion and the arc-path floating cards.
 * New: headline + CTAs in the first viewport, and a scripted
 * "message → reply → order draft" sequence inside the expanding interface.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, MotionValue, useMotionValue, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Sparkles, UserRound, ShoppingBag, Clock3, Inbox, Users, Package, ReceiptText, BarChart3 } from 'lucide-react';
import { CONVERSATION, DEMO, HERO, money } from '@/content/pulse';
import { Avatar, ChannelIcon, CTAButton, AITag, PulseAppTile } from '../ui/primitives';
import { ChatBubble, MiniStat, OrderDraftCard, ProductQuoteCard, ThreadList, TypingDots } from '../ui/mocks';

// Design size of the interface canvas; it is scaled to fit the expanding card.
const CANVAS = { desktop: { w: 1280, h: 760 }, mobile: { w: 380, h: 700 } };

// Expanded dashboard size per breakpoint, in viewport units
const GEOMETRY = {
  desktop: { w: 90, h: 74, top: 48 },
  mobile: { w: 94, h: 64, top: 45 },
};

// Scroll choreography (progress 0 → 1 across the pinned track)
const T = {
  introOut: [0, 0.1],
  zoom: [0.03, 0.12, 0.2], // the U fills the viewport; further scaling only grows the compositor layer
  wordOut: [0.22, 0.28],
  expand: [0.12, 0.31], // dashboard grows out of the letter
  msg1: [0.32, 0.37],
  typing: [0.38, 0.42, 0.45],
  msg2: [0.44, 0.5],
  msg3: [0.53, 0.58],
  draft: [0.61, 0.68],
  msg4: [0.66, 0.71],
  settle: [0.76, 0.9],
  floats: [0.78, 0.93],
  exit: [0.94, 0.99], // dissolves before Section 02 transition
};

function useViewport() {
  const [vp, setVp] = useState({ w: 1440, h: 900, mobile: false });
  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight, mobile: window.innerWidth < 768 });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return vp;
}

/** Fade + lift an element in over a progress range. */
function useReveal(p: MotionValue<number>, [a, b]: number[], dy = 16) {
  const opacity = useTransform(p, [a, b], [0, 1]);
  const y = useTransform(p, [a, b], [dy, 0]);
  return { opacity, y };
}

export default function Hero() {
  const reduce = useReducedMotion();
  const vp = useViewport();
  if (reduce) return <StaticHero mobile={vp.mobile} />;
  return <AnimatedHero vp={vp} />;
}

// ---------------------------------------------------------------------------
function AnimatedHero({ vp }: { vp: { w: number; h: number; mobile: boolean } }) {
  const sectionRef = useRef<HTMLElement>(null);
  const wordRef = useRef<HTMLParagraphElement>(null);
  const uRef = useRef<HTMLSpanElement>(null);
  const { scrollYProgress: p } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] });
  const g = vp.mobile ? GEOMETRY.mobile : GEOMETRY.desktop;
  const canvas = vp.mobile ? CANVAS.mobile : CANVAS.desktop;

  // Point inside the "U" counter we zoom into. offset* values ignore transforms,
  // so this stays correct even when the page is reloaded mid-scroll.
  const [focus, setFocus] = useState({ ox: vp.w / 2, oy: 0, cx: vp.w / 2, cy: vp.h * 0.8, uw: 120 });
  useEffect(() => {
    const measure = () => {
      const word = wordRef.current;
      const u = uRef.current;
      if (!word || !u) return;
      const ox = u.offsetLeft + u.offsetWidth / 2;
      const oy = u.offsetTop + u.offsetHeight * 0.36;
      setFocus({ ox, oy, cx: word.offsetLeft + ox, cy: word.offsetTop + oy, uw: u.offsetWidth * 0.32 });
    };
    measure();
    document.fonts?.ready.then(measure);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [vp.w, vp.h]);

  // Intro copy
  const introOpacity = useTransform(p, T.introOut, [1, 0]);
  const introY = useTransform(p, T.introOut, [0, -70]);
  const introEvents = useTransform(introOpacity, (v) => (v > 0.4 ? 'auto' : 'none'));

  // Wordmark: accelerating zoom into the U, then it fades away
  const wordScale = useTransform(p, T.zoom, [1, 2.4, 7]);
  const wordOpacity = useTransform(p, T.wordOut, [1, 0]);

  // Dashboard grows out of the U and settles in the centre of the screen
  const endW = (g.w / 100) * vp.w;
  const endH = (g.h / 100) * vp.h;
  const startW = focus.uw;
  const startH = focus.uw * 0.62;
  const t = (pp: number) => Math.min(1, Math.max(0, (pp - T.expand[0]) / (T.expand[1] - T.expand[0])));
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  const width = useTransform(p, (pp) => startW + (endW - startW) * ease(t(pp)));
  const height = useTransform(p, (pp) => startH + (endH - startH) * ease(t(pp)));
  const left = useTransform(p, (pp) => focus.cx + (vp.w / 2 - focus.cx) * ease(t(pp)));
  const top = useTransform(p, (pp) => focus.cy + ((g.top / 100) * vp.h - focus.cy) * ease(t(pp)));
  const radius = useTransform(p, T.expand, [14, 28]);
  const cardOpacity = useTransform(p, [T.expand[0], T.expand[0] + 0.03, T.exit[0], T.exit[1]], [0, 1, 1, 0]);
  const settleScale = useTransform(p, T.settle, [1, vp.mobile ? 0.92 : 0.86]);

  // CTAs: fade in after expansion, dissolve before Section 02 transition
  const ctaOpacity = useTransform(p, [T.expand[1], T.expand[1] + 0.04, T.exit[0], T.exit[1]], [0, 1, 1, 0]);
  const ctaY = useTransform(p, [T.expand[1], T.expand[1] + 0.04], [24, 0]);
  const ctaEvents = useTransform(ctaOpacity, (v) => (v > 0.5 ? 'auto' : 'none'));

  // Fit the fixed-size canvas into the card at every scroll position.
  const canvasScale = useTransform(p, (pp) => {
    const k = ease(t(pp));
    return Math.min((startW + (endW - startW) * k) / canvas.w, (startH + (endH - startH) * k) / canvas.h);
  });

  return (
    <section id="top" ref={sectionRef} className="relative h-[420vh] bg-mesh-hero" aria-label="Pulse — from message to order">
      <div className="grain sticky top-0 h-[100svh] w-full overflow-hidden">
        {/* ambient glows */}
        <div className="glow-mint absolute -left-40 top-10 h-[50vh] w-[50vw]" aria-hidden />
        <div className="glow-teal absolute -right-40 bottom-0 h-[50vh] w-[45vw]" aria-hidden />
        {/* dark green shade along the top, melting into the mint mesh */}
        <div className="hero-top-shade pointer-events-none absolute inset-x-0 top-0 h-[24vh] md:h-[30vh]" aria-hidden />

        {/* OVERSIZED WORDMARK — the camera zooms into the U */}
        <motion.p
          ref={wordRef}
          aria-hidden
          style={{ scale: wordScale, opacity: wordOpacity, transformOrigin: `${focus.ox}px ${focus.oy}px` }}
          className="wordmark-gradient pointer-events-none absolute inset-x-0 bottom-0 z-10 select-none text-center font-display text-[28vw] font-bold leading-[0.88] tracking-[-0.05em] md:bottom-2 md:text-[25vw]"
        >
          P<span ref={uRef}>U</span>LSE
        </motion.p>

        {/* INTRO COPY (first viewport) */}
        <motion.div
          style={{ opacity: introOpacity, y: introY, pointerEvents: introEvents as unknown as MotionValue<string> }}
          className="relative z-30 mx-auto flex max-w-4xl flex-col items-center px-5 pt-[22vh] text-center md:pt-[27vh]"
        >
          <IntroCopy />
        </motion.div>

        {/* DASHBOARD — expands out of the letter */}
        <motion.div
          style={{ width, height, left, top, opacity: cardOpacity, scale: settleScale, borderRadius: radius }}
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-[#f6f9f6] shadow-lift ring-1 ring-white/80"
        >
          <div className="absolute inset-0 grid place-items-center">
            <motion.div style={{ width: canvas.w, height: canvas.h, scale: canvasScale }} className="shrink-0 origin-center">
              {vp.mobile ? <MobileCanvas p={p} /> : <DesktopCanvas p={p} />}
            </motion.div>
          </div>
        </motion.div>

        {/* FLOATING CARDS ON ARC PATHS */}
        <FloatingCards p={p} mobile={vp.mobile} />

        {/* CTAs appear only once the dashboard is fully shown */}
        <motion.div
          style={{ opacity: ctaOpacity, y: ctaY, pointerEvents: ctaEvents as unknown as MotionValue<string> }}
          className="absolute inset-x-0 bottom-[3vh] z-40 flex justify-center px-5"
        >
          <HeroCTAs />
        </motion.div>


        {/* Scroll cue */}
        <motion.div
          style={{ opacity: introOpacity }}
          aria-hidden
          className="absolute bottom-5 right-6 z-30 hidden items-center gap-2 text-xs font-medium text-ink-soft md:flex"
        >
          <span className="h-8 w-[1px] origin-top animate-pulse bg-teal/50" /> Scroll to see Pulse work
        </motion.div>
      </div>
    </section>
  );
}

function IntroCopy() {
  return (
    <>
      <h1 className="text-balance font-display text-[32px] font-semibold leading-[1.02] tracking-[-0.03em] text-forest sm:text-[44px] md:text-[clamp(44px,4.2vw,66px)]">
        {HERO.headline[0]}
        <br />
        <span className="text-teal">{HERO.headline[1]}</span>
      </h1>
      <p className="mt-3 max-w-md text-pretty text-[15px] leading-relaxed text-ink-soft md:mt-4 md:max-w-lg md:text-[17px]">{HERO.body}</p>
    </>
  );
}

/** Hero CTAs — revealed once the dashboard has fully expanded. */
function HeroCTAs({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-2.5 sm:flex-row sm:gap-3 ${className}`}>
      <CTAButton href={HERO.primary.href} className="shadow-lift">{HERO.primary.label}</CTAButton>
      <CTAButton href={HERO.secondary.href} variant="secondary" className="!bg-white shadow-lift">
        {HERO.secondary.label}
      </CTAButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interface canvases
// ---------------------------------------------------------------------------
function Conversation({ p }: { p: MotionValue<number> }) {
  const m1 = useReveal(p, T.msg1);
  const typingOpacity = useTransform(p, T.typing, [0, 1, 0]);
  const m2 = useReveal(p, T.msg2);
  const m3 = useReveal(p, T.msg3);
  const m4 = useReveal(p, T.msg4);
  return (
    <div className="flex flex-1 flex-col justify-end gap-3 p-5">
      <motion.div style={m1}><ChatBubble from="customer">{CONVERSATION[0].text}</ChatBubble></motion.div>
      <motion.div style={{ opacity: typingOpacity }} className="-mb-3 h-0 overflow-visible">
        <div className="-translate-y-0"><TypingDots /></div>
      </motion.div>
      <motion.div style={m2} className="flex flex-col gap-2">
        <ChatBubble from="ai">{CONVERSATION[1].text}</ChatBubble>
        <ProductQuoteCard className="ml-auto w-[270px]" />
      </motion.div>
      <motion.div style={m3}><ChatBubble from="customer">{CONVERSATION[2].text}</ChatBubble></motion.div>
      <motion.div style={m4}><ChatBubble from="ai">{CONVERSATION[3].text}</ChatBubble></motion.div>
    </div>
  );
}

function ConversationHeader() {
  return (
    <div className="flex items-center gap-2.5 border-b border-line bg-white/80 px-5 py-3">
      <Avatar initials={DEMO.customer.initials} className="h-8 w-8 text-[11px]" />
      <div>
        <p className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          {DEMO.customer.name} <ChannelIcon channel="instagram" className="h-4 w-4" />
        </p>
        <p className="text-[11px] text-ink-faint">{DEMO.customer.handle} · Instagram DM</p>
      </div>
      <AITag label="AI replying" className="ml-auto" />
    </div>
  );
}

function DesktopCanvas({ p }: { p: MotionValue<number> }) {
  const draft = useReveal(p, T.draft, 30);
  const profileOpacity = useTransform(p, T.draft, [1, 0]);
  return (
    <div className="flex h-full w-full bg-[#f6f9f6] text-forest">
      {/* rail */}
      <aside className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-line bg-white py-4">
        <PulseAppTile className="mb-3 h-9 w-9" />
        {[Inbox, Users, Package, ReceiptText, BarChart3, Sparkles].map((Icon, i) => (
          <span key={i} className={`grid h-10 w-10 place-items-center rounded-xl ${i === 0 ? 'bg-mint text-teal' : 'text-ink-faint'}`}>
            <Icon className="h-[19px] w-[19px]" aria-hidden />
          </span>
        ))}
      </aside>
      <ThreadList className="w-[300px] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <ConversationHeader />
        <Conversation p={p} />
        <div className="mx-5 mb-4 rounded-full bg-white px-5 py-2.5 text-[12px] text-ink-faint ring-1 ring-line">Pulse AI is handling this conversation · Take over anytime</div>
      </div>
      {/* right panel: customer → order draft */}
      <div className="relative w-[330px] shrink-0 border-l border-line bg-white/60 p-4">
        <motion.div style={{ opacity: profileOpacity }} className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Customer</p>
          <div className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-line">
            <Avatar initials={DEMO.customer.initials} className="h-10 w-10 text-xs" />
            <div>
              <p className="text-[13px] font-semibold">{DEMO.customer.name}</p>
              <p className="text-[11px] text-ink-soft">First conversation</p>
            </div>
          </div>
          {[
            { icon: UserRound, t: 'New customer' },
            { icon: ShoppingBag, t: 'Interested in sneakers' },
            { icon: Clock3, t: 'Replied in under a minute' },
          ].map(({ icon: Icon, t }) => (
            <p key={t} className="flex items-center gap-2 text-[12px] text-ink-soft">
              <Icon className="h-4 w-4 text-teal" aria-hidden /> {t}
            </p>
          ))}
        </motion.div>
        <motion.div style={draft} className="absolute inset-x-4 top-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-teal">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> New order draft
          </p>
          <OrderDraftCard />
        </motion.div>
      </div>
    </div>
  );
}

function MobileCanvas({ p }: { p: MotionValue<number> }) {
  const draft = useReveal(p, T.draft, 30);
  const m1 = useReveal(p, T.msg1);
  const m2 = useReveal(p, T.msg2);
  const m3 = useReveal(p, T.msg3);
  const chatShift = useTransform(p, T.draft, [0, -250]);
  return (
    <div className="flex h-full w-full flex-col bg-[#f6f9f6] text-forest">
      <ConversationHeader />
      <div className="relative flex-1 overflow-hidden">
        <motion.div style={{ y: chatShift }} className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-4">
          <motion.div style={m1}><ChatBubble from="customer">{CONVERSATION[0].text}</ChatBubble></motion.div>
          <motion.div style={m2} className="flex flex-col gap-2">
            <ChatBubble from="ai">{CONVERSATION[1].text}</ChatBubble>
            <ProductQuoteCard className="ml-auto w-[250px]" />
          </motion.div>
          <motion.div style={m3}><ChatBubble from="customer">{CONVERSATION[2].text}</ChatBubble></motion.div>
        </motion.div>
        <motion.div style={draft} className="absolute inset-x-4 bottom-4">
          <OrderDraftCard compact />
        </motion.div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating cards — travel along an arc (the original carousel's path) into place
// ---------------------------------------------------------------------------
function FloatingCards({ p, mobile }: { p: MotionValue<number>; mobile: boolean }) {
  const cards = mobile
    ? [
        { key: 'product', from: [-160, 220, -20], to: [0, 0, -3], className: 'left-3 top-[12vh] w-[250px]' },
      ]
    : [
        { key: 'product', from: [-420, 260, -24], to: [0, 0, -4], className: 'left-[3vw] top-[18vh] w-[290px]' },
        { key: 'order', from: [420, 260, 24], to: [0, 0, 3], className: 'right-[3vw] top-[14vh] w-[260px]' },
        { key: 'stat', from: [-360, 320, -18], to: [0, 0, 2], className: 'left-[6vw] bottom-[10vh] w-[200px]' },
      ];
  return (
    <>
      {cards.map((c, i) => (
        <FloatingCard key={c.key} p={p} index={i} from={c.from} to={c.to} className={c.className}>
          {c.key === 'product' && (
            <div>
              <p className="mb-1.5 ml-1 flex items-center gap-1.5 text-[11px] font-semibold text-teal">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> {HERO.floating.product}
              </p>
              <ProductQuoteCard className="shadow-lift" />
            </div>
          )}
          {c.key === 'order' && (
            <div className="rounded-2xl bg-white p-3.5 shadow-lift ring-1 ring-forest/5">
              <p className="flex items-center gap-2 text-[12.5px] font-semibold text-forest">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-brand"><Sparkles className="h-3.5 w-3.5" aria-hidden /></span>
                {HERO.floating.order}
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-soft">
                #{DEMO.order.id} · {DEMO.customer.name} · <span className="font-semibold text-forest">{money(DEMO.product.price + DEMO.delivery.fee)}</span>
              </p>
            </div>
          )}
          {c.key === 'stat' && <MiniStat label={HERO.floating.stat} value="78%" trend="Demo data" className="shadow-lift" />}
        </FloatingCard>
      ))}
    </>
  );
}

function FloatingCard({ p, index, from, to, className, children }: { p: MotionValue<number>; index: number; from: number[]; to: number[]; className: string; children: React.ReactNode }) {
  const start = T.floats[0] + index * 0.035;
  const end = Math.min(T.floats[1], start + 0.12);
  const mid = (start + end) / 2;
  const x = useTransform(p, [start, end], [from[0], to[0]]);
  // arc: overshoot upward at the midpoint, like the original carousel apex
  const y = useTransform(p, [start, mid, end], [from[1], -24, to[1]]);
  const rotate = useTransform(p, [start, end], [from[2], to[2]]);
  const opacity = useTransform(p, [start, start + 0.03, T.exit[0], T.exit[1]], [0, 1, 1, 0]);
  const pointerEvents = useTransform(opacity, (v) => (v > 0.5 ? 'auto' : 'none'));
  return (
    <motion.div style={{ x, y, rotate, opacity, pointerEvents: pointerEvents as unknown as MotionValue<string> }} className={`absolute z-30 ${className}`} aria-hidden>
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Reduced-motion version: same content, no pinning or scroll choreography
// ---------------------------------------------------------------------------
function StaticHero({ mobile }: { mobile: boolean }) {
  const one = useMotionValue(1);
  return (
    <section id="top" className="relative overflow-hidden bg-mesh-hero pb-20" aria-label="Pulse — from message to order">
      <div className="hero-top-shade pointer-events-none absolute inset-x-0 top-0 h-[260px]" aria-hidden />
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-5 pt-[120px] text-center">
        <IntroCopy />
      </div>
      <div className="relative mx-auto mt-14 w-[94vw] max-w-[1280px]">
        <div className="overflow-hidden rounded-[28px] shadow-lift ring-1 ring-white/80" style={{ aspectRatio: mobile ? '380 / 700' : '1280 / 760' }}>
          <div className="h-full w-full">{mobile ? <MobileCanvas p={one} /> : <DesktopCanvas p={one} />}</div>
        </div>
        <HeroCTAs className="mt-6" />
      </div>
    </section>
  );
}
