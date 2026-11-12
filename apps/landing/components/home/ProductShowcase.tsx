'use client';

/**
 * SECTION 03 — Interactive product showcase. Preserves the original tab bar
 * (icon + label with an active underline and colour shift), the animated
 * feature list and the cross-fading media panel. Adds WAI-ARIA tabs with
 * arrow-key navigation and deep-linking from the navigation dropdown.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, Inbox, Package, ReceiptText, Sparkles } from 'lucide-react';
import { ANCHORS, SHOWCASE, type ShowcaseTabId } from '@/content/pulse';
import { ChannelIcon, DemoLabel, Eyebrow } from '../ui/primitives';
import { AISetupMock, AnalyticsMock, CatalogMock, InboxMock, OrdersMock } from '../ui/mocks';

const ICONS: Record<ShowcaseTabId, React.ElementType> = {
  inbox: Inbox,
  'ai-setup': Sparkles,
  catalog: Package,
  orders: ReceiptText,
  analytics: BarChart3,
};

const PANELS: Record<ShowcaseTabId, React.ReactNode> = {
  inbox: <InboxMock />,
  'ai-setup': <AISetupMock />,
  catalog: <CatalogMock />,
  orders: <OrdersMock />,
  analytics: <AnalyticsMock />,
};

export default function ProductShowcase() {
  const tabs = SHOWCASE.tabs;
  const [active, setActive] = useState<ShowcaseTabId>(tabs[0].id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  // Deep-link from the nav dropdown
  useEffect(() => {
    const onTab = (e: Event) => {
      const id = (e as CustomEvent<ShowcaseTabId>).detail;
      if (tabs.some((t) => t.id === id)) setActive(id);
    };
    window.addEventListener('pulse:showcase-tab', onTab);
    return () => window.removeEventListener('pulse:showcase-tab', onTab);
  }, [tabs]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = tabs.findIndex((t) => t.id === active);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    setActive(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
    tabRefs.current[tabs[next].id]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  };

  return (
    <section id={ANCHORS.features} className="relative overflow-hidden bg-mesh-sage px-4 py-24 sm:px-6 md:py-32 lg:px-8">
      <div className="glow-mint pointer-events-none absolute -right-40 top-40 h-[40vh] w-[40vw]" aria-hidden />
      <div className="relative mx-auto max-w-[1400px]">
        {/* HEADER */}
        <div className="mx-auto mb-10 max-w-3xl text-center md:mb-14">
          <Eyebrow className="mb-5">Product</Eyebrow>
          <h2 className="text-balance font-display text-4xl font-semibold leading-[1.04] tracking-[-0.03em] text-forest md:text-6xl lg:text-7xl">{SHOWCASE.headline}</h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base text-ink-soft md:text-lg">{SHOWCASE.sub}</p>
        </div>

        {/* TABS */}
        <div className="no-scrollbar -mx-4 mb-8 overflow-x-auto px-4 md:mb-12">
          <div role="tablist" aria-label="Pulse product areas" onKeyDown={onKeyDown} className="mx-auto flex w-max min-w-full justify-center border-b border-forest/10">
            {tabs.map((tab) => {
              const Icon = ICONS[tab.id];
              const selected = tab.id === active;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  role="tab"
                  id={`tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(tab.id)}
                  className={`group relative flex items-center gap-2.5 whitespace-nowrap px-4 py-4 text-[15px] font-semibold transition-colors duration-200 focus-visible:!rounded-xl md:px-8 md:py-5 md:text-lg ${
                    selected ? 'text-teal' : 'text-ink-soft hover:text-forest'
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-xl transition-all duration-300 ${
                      selected ? 'bg-teal text-white shadow-[0_8px_20px_-8px_rgba(11,79,75,0.6)]' : 'bg-white/70 text-ink-faint group-hover:-translate-y-0.5 group-hover:text-teal'
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  {tab.label}
                  {selected && <motion.span layoutId="showcase-underline" className="absolute inset-x-3 -bottom-px h-[2.5px] rounded-full bg-teal" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* CONTENT */}
        <div
          role="tabpanel"
          id={`panel-${current.id}`}
          aria-labelledby={`tab-${current.id}`}
          className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14"
        >
          <div className="order-2 lg:order-1 lg:col-span-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col gap-7"
              >
                <p className="font-display text-2xl font-semibold leading-snug text-forest md:text-3xl">{current.summary}</p>
                {current.points.map((pt, i) => (
                  <div key={pt.title} className="flex gap-4">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white font-display text-sm font-semibold text-teal shadow-soft">{i + 1}</span>
                    <div>
                      <h3 className="text-lg font-semibold text-forest">{pt.title}</h3>
                      <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{pt.desc}</p>
                    </div>
                  </div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="order-1 lg:order-2 lg:col-span-8">
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[1.75rem] bg-white shadow-lift ring-1 ring-white sm:aspect-[16/11] lg:aspect-[16/10]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, scale: 0.985, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.985, y: -12 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 rounded-[inherit]"
                >
                  {PANELS[current.id]}
                </motion.div>
              </AnimatePresence>
            </div>
            <DemoLabel className="mt-3">Illustrative reconstruction of the Pulse beta interface · fictional data</DemoLabel>
          </div>
        </div>

        {/* INTEGRATIONS */}
        <div id={ANCHORS.integrations} className="mx-auto mt-16 flex max-w-3xl flex-col items-center gap-4 rounded-[1.75rem] border border-white/80 bg-white/60 px-6 py-5 text-center backdrop-blur sm:flex-row sm:text-left">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-soft">Integrations</span>
          <span className="flex items-center gap-4 text-[15px] font-semibold text-forest">
            <span className="flex items-center gap-2"><ChannelIcon channel="messenger" className="h-5 w-5" /> Facebook Messenger</span>
            <span className="flex items-center gap-2"><ChannelIcon channel="instagram" className="h-5 w-5" /> Instagram</span>
          </span>
          <span className="text-[13px] leading-snug text-ink-soft sm:ml-auto sm:max-w-[220px]">Channels are connected and verified during beta onboarding.</span>
        </div>
      </div>
    </section>
  );
}
