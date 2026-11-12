'use client';

/**
 * SECTION 04 — "One conversation, one order".
 * Preserves the original stacked-card mechanic: a pinned 300vh track where
 * each card slides up to reveal the next (which scales forward), while the
 * copy cross-fades. Cards now follow one fictional order end to end.
 */
import React, { useRef } from 'react';
import { motion, MotionValue, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { BookOpen, Check, Package, Truck, Zap } from 'lucide-react';
import { ANCHORS, CONVERSATION, DEMO, LINKS, WORKFLOW, money } from '@/content/pulse';
import { Avatar, ChannelIcon, CTAButton, Eyebrow } from '../ui/primitives';
import { ChatBubble, OrderDraftCard, ProductQuoteCard } from '../ui/mocks';
import PulseMark from '../ui/PulseMark';

const STEPS = WORKFLOW.steps;

function InstantBadge() {
  return (
    <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-forest shadow-soft backdrop-blur">
      <Zap className="h-3.5 w-3.5 fill-brand text-teal" aria-hidden /> Instant response
    </span>
  );
}

function Stage({ tone, badge = false, children }: { tone: string; badge?: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden p-5 sm:p-10 ${tone}`}>
      {badge && <InstantBadge />}
      <div className="relative w-full max-w-[440px] origin-center scale-[0.78] sm:scale-100">{children}</div>
    </div>
  );
}

function PhoneHeader() {
  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-2xl bg-white/80 px-3 py-2 backdrop-blur">
      <Avatar initials={DEMO.customer.initials} className="h-8 w-8 text-[11px]" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-forest">
          {DEMO.customer.name} <ChannelIcon channel="instagram" className="h-3.5 w-3.5" />
        </p>
        <p className="text-[11px] text-ink-soft">to {DEMO.merchant} · Instagram</p>
      </div>
    </div>
  );
}

const VISUALS = [
  // 1 — Customer asks
  <div
    key="ask"
    className="relative h-full w-full overflow-hidden"
    style={{
      background:
        'radial-gradient(70% 60% at 20% 15%, rgba(197,228,120,0.18) 0%, transparent 60%), radial-gradient(60% 60% at 85% 90%, rgba(156,199,187,0.25) 0%, transparent 60%), linear-gradient(160deg, #0d5a45 0%, #0a4a3a 45%, #06382c 100%)',
    }}
  >
    {/* Pulse mark sits behind the notification and the customer's question */}
    <InstantBadge />
    <PulseMark className="absolute left-1/2 top-1/2 h-auto w-[70%] max-w-[380px] -translate-x-1/2 -translate-y-1/2 text-white/[0.09]" />
    <div className="absolute inset-0 flex flex-col justify-center px-5 sm:px-10">
      <PhoneHeader />
      <ChatBubble from="customer" className="[&>div]:text-[15px]">{CONVERSATION[0].text}</ChatBubble>
    </div>
  </div>,
  // 2 — Pulse quotes
  <Stage key="quote" tone="bg-mesh-sage" badge>
    <div className="mb-3 hidden opacity-50 sm:block"><ChatBubble from="customer">{CONVERSATION[0].text}</ChatBubble></div>
    <ChatBubble from="ai">{CONVERSATION[1].text}</ChatBubble>
    <ProductQuoteCard className="ml-auto mt-3 w-[min(280px,90%)]" />
    <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-medium text-forest">
      <span className="text-ink-soft">Answered from</span>
      <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 ring-1 ring-line"><Package className="h-3 w-3 text-teal" aria-hidden /> Catalogue</span>
      <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 ring-1 ring-line"><BookOpen className="h-3 w-3 text-teal" aria-hidden /> Delivery policy</span>
    </div>
  </Stage>,
  // 3 — Pulse drafts
  <Stage key="draft" tone="bg-mesh-soft">
    <div className="mb-3 hidden sm:block"><ChatBubble from="customer">{CONVERSATION[2].text}</ChatBubble></div>
    <OrderDraftCard />
  </Stage>,
  // 4 — Team reviews
  <Stage key="review" tone="bg-mesh-sage">
    <OrderDraftCard state="confirmed" compact />
    <ol className="mt-4 grid grid-cols-4 gap-1.5 text-center text-[10.5px] font-semibold sm:text-[11px]">
      {['Drafted by AI', 'Confirmed', 'Packed', 'Shipped'].map((s, i) => (
        <li key={s} className="flex flex-col items-center gap-1.5">
          <span className={`grid h-7 w-7 place-items-center rounded-full ${i < 2 ? 'bg-teal text-white' : 'bg-white text-ink-faint ring-1 ring-line'}`}>
            {i < 2 ? <Check className="h-3.5 w-3.5" aria-hidden /> : i === 2 ? <Package className="h-3.5 w-3.5" aria-hidden /> : <Truck className="h-3.5 w-3.5" aria-hidden />}
          </span>
          <span className={i < 2 ? 'text-forest' : 'text-ink-faint'}>{s}</span>
        </li>
      ))}
    </ol>
    <p className="mt-4 flex items-center justify-between rounded-xl bg-white/80 px-3 py-2 text-[12px] text-ink-soft">
      Reviewed by <span className="font-semibold text-forest">Ayesha · {DEMO.merchant}</span>
      <span className="font-semibold text-forest">{money(DEMO.product.price + DEMO.delivery.fee)}</span>
    </p>
  </Stage>,
];

export default function OrderWorkflow() {
  const reduce = useReducedMotion();
  return reduce ? <StaticWorkflow /> : <PinnedWorkflow />;
}

function PinnedWorkflow() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  return (
    <section ref={ref} id={ANCHORS.howItWorks} className="relative h-[340vh] bg-paper">
      <div className="sticky top-0 flex h-[100svh] w-full flex-col overflow-hidden">
        <div className="mx-auto w-full max-w-7xl px-5 pt-20 sm:pt-24 lg:px-10">
          <Eyebrow>{WORKFLOW.eyebrow}</Eyebrow>
          <h2 className="mt-3 max-w-3xl text-balance font-display text-[28px] font-semibold leading-[1.05] tracking-[-0.03em] text-forest sm:text-5xl lg:text-6xl">{WORKFLOW.headline}</h2>
        </div>

        <div className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 gap-5 px-5 pb-6 pt-5 lg:grid-cols-2 lg:items-center lg:gap-14 lg:px-10 lg:pb-10">
          {/* Stacked visuals */}
          <div className="relative h-[40svh] w-full overflow-hidden rounded-[2rem] bg-sage shadow-lift lg:h-[62vh]">
            {VISUALS.map((v, i) => (
              <StackedCard key={i} index={i} total={VISUALS.length} progress={scrollYProgress}>
                {v}
              </StackedCard>
            ))}
          </div>

          {/* Copy */}
          <div className="relative min-h-[200px] lg:h-[62vh]">
            {STEPS.map((s, i) => (
              <StackedText key={s.step} index={i} total={STEPS.length} progress={scrollYProgress} step={s} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StackedCard({ index, total, progress, children }: { index: number; total: number; progress: MotionValue<number>; children: React.ReactNode }) {
  const step = 1 / (total - 1);
  const start = index * step;
  const isLast = index === total - 1;
  // Card slides up and away as its segment passes (original mechanic)
  const y = useTransform(progress, [start, start + step], ['0%', isLast ? '0%' : '-100%']);
  // The card behind scales forward while the previous one leaves
  const scale = useTransform(progress, [Math.max(0, (index - 1) * step), index * step], [index === 0 ? 1 : 0.9, 1]);
  return (
    <motion.div style={{ y, scale, zIndex: total - index }} className="absolute inset-0 h-full w-full overflow-hidden rounded-[2rem] will-change-transform">
      {children}
    </motion.div>
  );
}

function StackedText({ index, total, progress, step: s }: { index: number; total: number; progress: MotionValue<number>; step: (typeof STEPS)[number] }) {
  const step = 1 / (total - 1);
  const start = index * step;
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const input = isFirst ? [0, step / 2] : isLast ? [start - step / 2, start] : [start - step / 2, start, start + step / 2 - 0.001, start + step / 2];
  const output = isFirst ? [1, 0] : isLast ? [0, 1] : [0, 1, 1, 0];
  const opacity = useTransform(progress, input, output);
  const y = useTransform(progress, [start - step / 2, start, start + step / 2], [40, 0, isLast ? 0 : -40]);
  const pointerEvents = useTransform(opacity, (v) => (v > 0.5 ? 'auto' : 'none'));
  return (
    <motion.div style={{ opacity, y, pointerEvents }} className="absolute inset-0 flex flex-col justify-start pt-6 lg:justify-center lg:pt-0">
      <h3 className="font-display text-2xl font-semibold leading-tight tracking-[-0.02em] text-forest sm:text-3xl md:text-5xl lg:mb-6">{s.title}</h3>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-soft md:text-lg">{s.description}</p>
      {isLast && (
        <div className="mt-6 hidden lg:block">
          <CTAButton href={LINKS.requestAccess}>Request beta access</CTAButton>
        </div>
      )}
    </motion.div>
  );
}


function StaticWorkflow() {
  return (
    <section id={ANCHORS.howItWorks} className="bg-paper px-5 py-24">
      <div className="mx-auto max-w-7xl">
        <Eyebrow>{WORKFLOW.eyebrow}</Eyebrow>
        <h2 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight text-forest md:text-6xl">{WORKFLOW.headline}</h2>
        <ol className="mt-12 grid gap-8 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.step} className="overflow-hidden rounded-[2rem] bg-white shadow-soft">
              <div className="aspect-[4/3]">{VISUALS[i]}</div>
              <div className="p-6">
                <h3 className="font-display text-2xl font-semibold text-forest">{s.title}</h3>
                <p className="mt-2 text-ink-soft">{s.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

