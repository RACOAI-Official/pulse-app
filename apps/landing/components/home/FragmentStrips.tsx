'use client';

/**
 * SECTION 02 (strips) — preserved infinite two-row marquee (opposite
 * directions). The images are now the "chaos" of social selling:
 * scattered DMs, product shots, hand-written orders and missed enquiries.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { NotebookPen, BellDot } from 'lucide-react';
import { CHAOS } from '@/content/pulse';
import { ChannelIcon } from '../ui/primitives';

type Fragment = (typeof CHAOS.fragments)[number];

function FragmentCard({ f }: { f: Fragment }) {
  const base = 'relative h-[150px] w-[230px] shrink-0 overflow-hidden rounded-3xl sm:h-[190px] sm:w-[290px] md:h-[220px] md:w-[330px]';
  if (f.kind === 'img') {
    return (
      <div className={base}>
        <img src={f.src} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" />
        <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-forest">{f.label}</span>
      </div>
    );
  }
  if (f.kind === 'msg') {
    return (
      <div className={`${base} flex flex-col justify-between bg-white p-5 ring-1 ring-line`}>
        <span className="flex items-center gap-2 text-[11px] font-medium text-ink-soft">
          <ChannelIcon channel={f.channel as 'instagram' | 'messenger'} className="h-4 w-4" />
          {f.channel === 'instagram' ? 'Instagram DM' : 'Messenger'}
          <span className="ml-auto rounded-full bg-[#fbe9e5] px-2 py-0.5 text-[10px] font-semibold text-[#9a3b2f]">Unread</span>
        </span>
        <p className="w-fit rounded-2xl rounded-bl-md bg-paper px-4 py-3 font-display text-lg font-medium leading-snug text-forest ring-1 ring-line sm:text-xl">{f.text}</p>
      </div>
    );
  }
  if (f.kind === 'order') {
    return (
      <div className={`${base} flex flex-col justify-between bg-[#f7f5ec] p-5 ring-1 ring-[#e9e4cf]`}>
        <span className="flex items-center gap-2 text-[11px] font-medium text-[#7a6a3f]">
          <NotebookPen className="h-4 w-4" aria-hidden /> {f.label}
        </span>
        <p className="-rotate-2 font-display text-xl font-medium text-[#4d4430] underline decoration-[#d9cfa7] decoration-2 underline-offset-8 sm:text-2xl">{f.text}</p>
      </div>
    );
  }
  return (
    <div className={`${base} flex flex-col justify-between bg-sage/70 p-5`}>
      <span className="flex items-center gap-2 text-[11px] font-medium text-forest">
        <BellDot className="h-4 w-4" aria-hidden /> {f.label}
      </span>
      <p className="font-display text-3xl font-semibold leading-tight text-forest sm:text-4xl">{f.text}</p>
    </div>
  );
}

export default function FragmentStrips() {
  const half = Math.ceil(CHAOS.fragments.length / 2);
  const rowA = CHAOS.fragments.slice(0, half);
  const rowB = CHAOS.fragments.slice(half);
  const rows = [
    { items: [...rowA, ...rowA], from: '0%', to: '-50%' },
    { items: [...rowB, ...rowB], from: '-50%', to: '0%' },
  ];
  return (
    <section aria-label="The everyday chaos of selling in DMs" className="relative overflow-hidden bg-paper py-10 sm:py-16">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-paper to-transparent sm:w-40" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-paper to-transparent sm:w-40" />
      <div className="flex flex-col gap-5 sm:gap-7" aria-hidden>
        {rows.map((row, r) => (
          <div key={r} className="flex w-full overflow-hidden">
            <motion.div
              className="flex min-w-full flex-nowrap gap-5 pr-5 sm:gap-7 sm:pr-7"
              initial={{ x: row.from }}
              animate={{ x: row.to }}
              transition={{ repeat: Infinity, ease: 'linear', duration: 42 + r * 6 }}
            >
              {row.items.map((f, i) => (
                <FragmentCard key={`${r}-${i}`} f={f} />
              ))}
            </motion.div>
          </div>
        ))}
      </div>
    </section>
  );
}
