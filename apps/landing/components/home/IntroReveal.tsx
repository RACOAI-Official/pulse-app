'use client';

/**
 * SECTION 02 (intro) — what Pulse is, in one glance.
 * Keeps the original word-by-word spring reveal with inline media chips, but
 * the chips are now tiny pieces of the product telling the story:
 * message in → AI answer → order drafted.
 */
import React, { useRef } from 'react';
import { motion, useInView, Variants } from 'framer-motion';
import { Check, ReceiptText, Sparkles } from 'lucide-react';
import { ANCHORS, CHAOS } from '@/content/pulse';
import { ChannelIcon, Eyebrow } from '../ui/primitives';

const container: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const item: Variants = {
  hidden: { y: 40, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { type: 'spring', damping: 22, stiffness: 110 } },
};
const chipIn: Variants = {
  hidden: { scale: 0.6, opacity: 0, rotate: -6 },
  show: { scale: 1, opacity: 1, rotate: 0, transition: { type: 'spring', damping: 14, stiffness: 180 } },
};

const CHIP = 'mx-1.5 inline-flex translate-y-[-0.08em] items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 align-middle font-sans text-[13px] font-semibold tracking-normal shadow-soft sm:mx-2 sm:px-3.5 sm:py-1.5 sm:text-[15px] md:text-base';

export default function IntroReveal() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px -15% 0px' });
  const { beats, label, sub } = CHAOS.story;

  const chips = [
    <span key="dm" className={`${CHIP} bg-white text-forest ring-1 ring-line`}>
      <ChannelIcon channel="instagram" className="h-4 w-4" /> {beats[0].chip}
    </span>,
    <span key="ai" className={`${CHIP} bg-teal text-white`}>
      <Sparkles className="h-4 w-4" aria-hidden /> {beats[1].chip}
    </span>,
    <span key="order" className={`${CHIP} bg-brand text-forest`}>
      <ReceiptText className="h-4 w-4" aria-hidden /> {beats[2].chip}
      <Check className="h-4 w-4" aria-hidden />
    </span>,
  ];

  return (
    <section id={ANCHORS.product} className="relative overflow-hidden bg-mesh-soft px-5 pb-12 pt-24 sm:pt-32 md:pt-36">
      <div className="mx-auto max-w-4xl text-center">
        <Eyebrow className="mb-6">{CHAOS.eyebrow}</Eyebrow>
        <motion.h2
          ref={ref}
          variants={container}
          initial="hidden"
          animate={inView ? 'show' : 'hidden'}
          aria-label={label}
          className="font-display text-[30px] font-semibold leading-[1.35] tracking-[-0.025em] text-forest sm:text-[42px] md:text-[52px]"
        >
          <span aria-hidden>
            {beats.map((b, i) => (
              <span key={i} className="sm:block">
                <motion.span variants={item} className={`inline-block ${i > 0 ? 'text-teal' : ''}`}>
                  {b.lead}
                </motion.span>{' '}
                <motion.span variants={item} className="inline-block">
                  {b.tail}
                </motion.span>
                <motion.span variants={chipIn} className="inline-block">
                  {chips[i]}
                </motion.span>{' '}
              </span>
            ))}
          </span>
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-ink-soft md:mt-8 md:text-lg"
        >
          {sub}
        </motion.p>
      </div>
    </section>
  );
}
