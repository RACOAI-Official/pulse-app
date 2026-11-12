'use client';

/**
 * Floating-pill navigation (preserved from the original): FlipLink letter
 * roll on hover, animated chevron and the glass mega-dropdown — now listing
 * the five Pulse product areas. Adds a compact mobile bar + menu sheet.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, Inbox, Menu, Package, ReceiptText, Sparkles, X } from 'lucide-react';
import FlipLink from '../Effects/FlipLink';
import { PulseLogo, CTAButton } from '../ui/primitives';
import { ANCHORS, LINKS, NAV, SHOWCASE, type ShowcaseTabId } from '@/content/pulse';

const TAB_ICONS: Record<ShowcaseTabId, React.ElementType> = {
  inbox: Inbox,
  'ai-setup': Sparkles,
  catalog: Package,
  orders: ReceiptText,
  analytics: BarChart3,
};

/** Ask the product showcase to switch tab, then let the anchor scroll there. */
export function openShowcaseTab(id: ShowcaseTabId) {
  window.dispatchEvent(new CustomEvent('pulse:showcase-tab', { detail: id }));
}

export default function Navbar() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // true while the dark top shade of the hero sits behind the header
  const [onDark, setOnDark] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      // onDark is true only while the header is within the hero top dark shade (~22vh)
      setOnDark(y < window.innerHeight * 0.22);
      // Dismiss mega-dropdown immediately if the user scrolls
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setDropdownOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
        setMobileOpen(false);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
  }, [mobileOpen]);

  const mobileDark = onDark && !mobileOpen;

  const open = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setDropdownOpen(true);
  };
  const close = () => {
    timeoutRef.current = setTimeout(() => setDropdownOpen(false), 220);
  };

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50">
      {/* ---------------- Desktop ---------------- */}
      <div className="relative mx-auto hidden h-[88px] max-w-[1600px] items-center justify-between px-8 lg:flex">
        <span aria-hidden />

        <nav
          aria-label="Primary"
          onMouseLeave={close}
          className={`pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-6 rounded-full border border-white/70 px-6 py-2 backdrop-blur-xl transition-all duration-300 ${
            onDark ? 'bg-white/90 shadow-[0_8px_32px_rgba(0,0,0,0.12)]' : scrolled ? 'bg-white/80 shadow-soft' : 'bg-white/55 shadow-[0_8px_32px_rgba(21,59,55,0.05)]'
          }`}
        >
          {NAV.map((link, i) => (
            <React.Fragment key={link.label}>
            {/* Pulse logo sits in the middle of the pill, between How It Works and Features */}
            {i === 2 && (
              <a href={`#${ANCHORS.top}`} aria-label="Pulse home" className="mx-1 grid place-items-center rounded-full px-1 transition-transform duration-300 hover:scale-105">
                <PulseLogo className="[&_svg]:h-8" />
              </a>
            )}
            {link.dropdown ? (
              <div onMouseEnter={open}>
                <button
                  type="button"
                  aria-expanded={dropdownOpen}
                  aria-controls="features-menu"
                  onClick={open}
                  className="rounded-full"
                >
                  <FlipLink hasDropdown isActive={dropdownOpen}>
                    {link.label}
                  </FlipLink>
                </button>
              </div>
            ) : (
              <a href={link.href} onMouseEnter={close} className="rounded-full">
                <FlipLink>{link.label}</FlipLink>
              </a>
            )}
            </React.Fragment>
          ))}
        </nav>

        <div className="pointer-events-auto flex items-center gap-5">
          <CTAButton href={LINKS.signIn} variant={onDark ? 'light' : 'primary'}>Try Pulse</CTAButton>
        </div>

        {/* Mega dropdown */}
        <AnimatePresence>
          {dropdownOpen && (
            <motion.div
              id="features-menu"
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onMouseEnter={open}
              onMouseLeave={close}
              className="pointer-events-auto absolute left-1/2 top-[68px] pt-3 w-[min(92vw,980px)] -translate-x-1/2"
            >
              <div className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/85 p-4 shadow-lift backdrop-blur-2xl">
                <div className="grid grid-cols-5 gap-3">
                  {SHOWCASE.tabs.map((tab, idx) => {
                    const Icon = TAB_ICONS[tab.id];
                    return (
                      <motion.a
                        key={tab.id}
                        href={`#${ANCHORS.features}`}
                        onClick={() => {
                          openShowcaseTab(tab.id);
                          setDropdownOpen(false);
                        }}
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.04 }}
                        className="group flex flex-col gap-3 rounded-2xl bg-mesh-soft p-4 ring-1 ring-line transition-shadow hover:shadow-soft focus-visible:!rounded-2xl"
                      >
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-teal shadow-soft transition-transform duration-300 group-hover:-translate-y-0.5">
                          <Icon className="h-5 w-5" aria-hidden />
                        </span>
                        <span>
                          <span className="block text-[15px] font-semibold text-forest">{tab.label}</span>
                          <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-soft">{tab.summary}</span>
                        </span>
                      </motion.a>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line px-2 pt-3 text-sm">
                  <span className="text-ink-soft">Works with Facebook Messenger and Instagram. Now in beta.</span>
                  <a href={`#${ANCHORS.beta}`} onClick={() => setDropdownOpen(false)} className="group flex items-center gap-2 rounded-full font-semibold text-forest">
                    What’s available today <span className="transition-transform group-hover:translate-x-1">→</span>
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---------------- Mobile / tablet ---------------- */}
      <div className="pointer-events-auto px-3 pt-3 lg:hidden">
        <div
          className={`flex items-center justify-between gap-2 rounded-full border py-1.5 pl-3 pr-1.5 backdrop-blur-xl transition-colors duration-300 ${
            mobileDark ? 'border-white/15 bg-white/5' : scrolled || mobileOpen ? 'border-white/70 bg-white/90 shadow-soft' : 'border-white/70 bg-white/60'
          }`}
        >
          <a href={`#${ANCHORS.top}`} aria-label="Pulse home" className="rounded-full" onClick={() => setMobileOpen(false)}>
            <PulseLogo tone={mobileDark ? 'white' : 'brand'} className="px-1 [&_svg]:h-8" />
          </a>
          <div className="flex items-center gap-1.5">
            <a
              href={LINKS.signIn}
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-full px-4 py-2 text-[13.5px] font-semibold transition-colors duration-300 ${mobileDark ? 'bg-brand text-forest' : 'bg-forest text-white'}`}
            >
              Try Pulse
            </a>
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              className={`grid h-10 w-10 place-items-center rounded-full transition-colors duration-300 ${mobileDark ? 'bg-white/15 text-white' : 'bg-mint text-forest'}`}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 -z-10 bg-paper/70 backdrop-blur-md"
              aria-hidden
            />
          )}
          {mobileOpen && (
            <motion.nav
              key="menu"
              id="mobile-menu"
              aria-label="Mobile"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="mt-2 rounded-[1.75rem] border border-white/80 bg-white/95 p-3 shadow-lift backdrop-blur-xl"
            >
              <ul className="flex flex-col">
                {NAV.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center justify-between rounded-2xl px-4 py-3.5 font-display text-xl font-semibold text-forest active:bg-mint"
                    >
                      {link.label} <span aria-hidden className="text-ink-faint">→</span>
                    </a>
                  </li>
                ))}
              </ul>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
