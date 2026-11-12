'use client';

/**
 * SECTION 05 — Built for real merchants.
 * Preserves the original full-width rows, circular arrow treatment and the
 * spring-follow cursor preview (fine pointers). Adds tap / Enter to reveal
 * an inline preview so touch and keyboard users get the same content.
 */
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { ANCHORS, ANALYTICS, CONVERSATION, DEMO, USE_CASES, money, type UseCaseId } from '@/content/pulse';
import { DemoLabel, Eyebrow } from '../ui/primitives';
import { ChatBubble, ConversationPane, LineChart, MiniStat, OrderDraftCard, ProductQuoteCard, ThreadList } from '../ui/mocks';

function Preview({ id }: { id: UseCaseId }) {
  switch (id) {
    case 'answer':
      return (
        <div className="flex h-full flex-col justify-end gap-2.5 p-4">
          <ChatBubble from="customer">{CONVERSATION[0].text}</ChatBubble>
          <ChatBubble from="ai">Yes — size 39 is in stock. It’s {money(DEMO.product.price)} + {money(DEMO.delivery.fee)} delivery.</ChatBubble>
          <ProductQuoteCard className="ml-auto w-[85%]" />
        </div>
      );
    case 'cod':
      return (
        <div className="flex h-full flex-col justify-end gap-3 p-4">
          <ChatBubble from="customer">{CONVERSATION[2].text}</ChatBubble>
          <OrderDraftCard compact />
        </div>
      );
    case 'manage':
      return (
        <div className="h-full overflow-hidden rounded-2xl ring-1 ring-line">
          <ThreadList />
        </div>
      );
    case 'takeover':
      return (
        <div className="h-full overflow-hidden rounded-2xl bg-[#f6f9f6] ring-1 ring-line">
          <ConversationPane takeover upto={1} />
        </div>
      );
    case 'sales':
      return (
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="grid grid-cols-2 gap-2.5">
            <MiniStat label="Conversations" value={ANALYTICS.stats[0].value} trend="This week" />
            <MiniStat label="Confirmed orders" value={ANALYTICS.stats[2].value} trend="This week" />
          </div>
          <div className="flex-1 rounded-2xl bg-white p-3 ring-1 ring-line">
            <LineChart />
          </div>
        </div>
      );
  }
}

function PreviewFrame({ id, className = '' }: { id: UseCaseId; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[1.75rem] bg-mesh-sage shadow-lift ring-1 ring-white ${className}`}>
      <div className="h-full pt-9">
        <Preview id={id} />
      </div>
      <DemoLabel className="absolute left-4 top-3">Illustrative demo</DemoLabel>
    </div>
  );
}

export default function UseCases() {
  const [hovered, setHovered] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setCanHover(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Spring-follow cursor preview (original mechanic)
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const spring = { damping: 22, stiffness: 300, mass: 0.5 };
  const x = useSpring(mouseX, spring);
  const y = useSpring(mouseY, spring);

  const items = USE_CASES.items;
  const showFloating = canHover && hovered !== null && hovered !== expanded;

  return (
    <section
      id={ANCHORS.useCases}
      onMouseMove={(e) => {
        mouseX.set(e.clientX);
        mouseY.set(e.clientY);
      }}
      className="relative w-full overflow-hidden bg-paper py-24 sm:py-32"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mb-14 flex flex-col gap-5 sm:mb-20 md:flex-row md:items-end md:justify-between">
          <div>
            <Eyebrow className="mb-4">Use cases</Eyebrow>
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-display text-5xl font-semibold leading-[1] tracking-[-0.035em] text-forest sm:text-7xl lg:text-8xl"
            >
              {USE_CASES.headline}
            </motion.h2>
          </div>
          <p className="max-w-xs text-base text-ink-soft md:text-right">{USE_CASES.sub}</p>
        </div>

        <ul className="flex flex-col border-t border-forest/10">
          {items.map((item, index) => {
            const isOpen = expanded === index;
            return (
              <li key={item.id} className="border-b border-forest/10">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`usecase-${item.id}`}
                  onClick={() => setExpanded(isOpen ? null : index)}
                  onMouseEnter={(e) => {
                    // appear at the cursor instead of flying in from the last position
                    if (hovered === null) {
                      mouseX.set(e.clientX);
                      mouseY.set(e.clientY);
                      x.jump(e.clientX);
                      y.jump(e.clientY);
                    }
                    setHovered(index);
                  }}
                  onMouseLeave={() => setHovered(null)}
                  className="group relative flex w-full items-center justify-between gap-4 px-1 py-7 text-left transition-colors duration-300 hover:bg-mint/40 focus-visible:!rounded-2xl sm:px-4 sm:py-10"
                >
                  <span className="flex min-w-0 flex-col gap-2 transition-transform duration-300 group-hover:translate-x-3">
                    <span className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-forest sm:text-4xl md:text-5xl lg:text-6xl">{item.name}</span>
                    <span className="max-w-xl text-[15px] text-ink-soft sm:text-base">{item.desc}</span>
                  </span>
                  <span
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border transition-all duration-300 sm:h-16 sm:w-16 ${
                      isOpen ? 'rotate-90 border-forest bg-forest text-white' : 'border-forest/20 text-forest group-hover:border-forest group-hover:bg-forest group-hover:text-white'
                    }`}
                  >
                    <ArrowUpRight className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`usecase-${item.id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="pb-8 sm:px-4">
                        <PreviewFrame id={item.id} className="h-[390px] w-full max-w-[460px]" />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Floating cursor preview (fine pointers only) */}
      <AnimatePresence>
        {showFloating && hovered !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ opacity: { duration: 0.2 }, scale: { duration: 0.2 } }}
            style={{ x, y }}
            className="pointer-events-none fixed left-0 top-0 z-40 hidden md:block"
            aria-hidden
          >
            {/* offset to the right of the cursor so the row title stays readable */}
            <div className="translate-x-10 -translate-y-1/2">
              <PreviewFrame id={items[hovered].id} className="h-[390px] w-[400px]" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
