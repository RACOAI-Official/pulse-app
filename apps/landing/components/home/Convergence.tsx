'use client';

/**
 * SECTION 02 (resolution) — pinned scroll: scattered fragments fly into an
 * organised Pulse workspace while each merchant problem is resolved.
 * Uses the same sticky + scroll-progress mechanics as the original stacks.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, MotionValue, useMotionValue, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Check, BellOff, NotebookPen, UserRound } from 'lucide-react';
import { CHAOS, money } from '@/content/pulse';
import { AITag, Avatar, ChannelIcon, DemoLabel, PulseLogo } from '../ui/primitives';

type Tile = {
  key: string;
  // messy start offset (px) + rotation
  from: { x: number; y: number; r: number };
  messy: React.ReactNode;
  tidy: React.ReactNode;
};

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`flex h-full w-full flex-col justify-center rounded-2xl p-3 sm:p-5 ${className}`}>{children}</div>
);

const TILES: Tile[] = [
  {
    key: 'ig',
    from: { x: -40, y: -150, r: -11 },
    messy: (
      <Card className="bg-white ring-1 ring-line">
        <p className="flex items-center gap-1.5 text-[11px] text-[#9a3b2f]"><ChannelIcon channel="instagram" className="h-3.5 w-3.5" /> Seen 3h ago</p>
        <p className="mt-2 font-display text-[15px] font-medium leading-snug text-forest sm:text-lg">Is this still available??</p>
      </Card>
    ),
    tidy: (
      <Card className="bg-white">
        <p className="flex items-center gap-1.5 text-[11px] text-ink-soft"><ChannelIcon channel="instagram" className="h-3.5 w-3.5" /> Instagram</p>
        <p className="mt-2 text-[13px] font-semibold leading-snug text-forest">Answered with stock & price</p>
        <AITag label="Replied by AI" className="mt-2" />
      </Card>
    ),
  },
  {
    key: 'ms',
    from: { x: 70, y: -190, r: 8 },
    messy: (
      <Card className="bg-white ring-1 ring-line">
        <p className="flex items-center gap-1.5 text-[11px] text-[#9a3b2f]"><ChannelIcon channel="messenger" className="h-3.5 w-3.5" /> Unread</p>
        <p className="mt-2 font-display text-[15px] font-medium leading-snug text-forest sm:text-lg">Delivery charge outside Dhaka?</p>
      </Card>
    ),
    tidy: (
      <Card className="bg-white">
        <p className="flex items-center gap-1.5 text-[11px] text-ink-soft"><ChannelIcon channel="messenger" className="h-3.5 w-3.5" /> Messenger</p>
        <p className="mt-2 text-[13px] font-semibold leading-snug text-forest">Delivery fee shared from your policy</p>
        <AITag label="Replied by AI" className="mt-2" />
      </Card>
    ),
  },
  {
    key: 'missed',
    from: { x: 220, y: -110, r: 12 },
    messy: (
      <Card className="bg-sage">
        <p className="text-[11px] font-medium text-forest">Since 11:00 PM</p>
        <p className="mt-1 font-display text-2xl font-semibold leading-tight text-forest sm:text-3xl">14 unread</p>
      </Card>
    ),
    tidy: (
      <Card className="bg-white">
        <p className="flex items-center gap-1.5 text-[11px] text-ink-soft"><BellOff className="h-3.5 w-3.5" aria-hidden /> Waiting for reply</p>
        <p className="mt-1 font-display text-2xl font-semibold leading-tight text-forest sm:text-3xl">0</p>
        <p className="text-[11px] text-teal">Answered while you slept</p>
      </Card>
    ),
  },
  {
    key: 'product',
    from: { x: -50, y: 150, r: 9 },
    messy: (
      <div className="relative h-full w-full overflow-hidden rounded-2xl">
        <img src="/media/products/tote.webp" alt="" className="h-full w-full object-cover" loading="lazy" />
        <span className="absolute bottom-2 left-2 rounded-lg bg-white/90 px-2 py-1 font-display text-sm font-medium text-forest">price??</span>
      </div>
    ),
    tidy: (
      <Card className="!flex-row items-center gap-3 bg-white">
        <img src="/media/products/tote.webp" alt="" className="h-full max-h-20 w-16 rounded-xl object-cover" loading="lazy" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-forest">Colour Block Tote</p>
          <p className="text-[12px] text-ink-soft">{money(1850)} · 24 in stock</p>
        </div>
      </Card>
    ),
  },
  {
    key: 'order',
    from: { x: 90, y: 190, r: -7 },
    messy: (
      <Card className="bg-[#f7f5ec] ring-1 ring-[#e9e4cf]">
        <p className="flex items-center gap-1.5 text-[11px] text-[#7a6a3f]"><NotebookPen className="h-3.5 w-3.5" aria-hidden /> Notebook</p>
        <p className="mt-2 -rotate-2 font-display text-lg font-medium text-[#4d4430]">2× Tote · COD · Mirpur</p>
      </Card>
    ),
    tidy: (
      <Card className="bg-white">
        <p className="text-[11px] text-ink-soft">Order #PL-1041</p>
        <p className="mt-1 text-[13px] font-semibold text-forest">Colour Block Tote ×2</p>
        <span className="mt-2 inline-block rounded-full bg-sage px-2 py-0.5 text-[10px] font-semibold text-forest">Confirmed · {money(3780)}</span>
      </Card>
    ),
  },
  {
    key: 'customer',
    from: { x: 230, y: 160, r: -12 },
    messy: (
      <Card className="bg-white ring-1 ring-line">
        <p className="text-[11px] text-[#9a3b2f]">Screenshot · gallery</p>
        <p className="mt-2 font-display text-[15px] font-medium leading-snug text-forest sm:text-lg">Who ordered the vase again?</p>
      </Card>
    ),
    tidy: (
      <Card className="!flex-row items-center justify-start gap-3 bg-white">
        <Avatar initials="SA" tone={4} className="h-10 w-10 text-xs" />
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[13px] font-semibold text-forest">Sumaiya A. <UserRound className="h-3 w-3 text-ink-faint" aria-hidden /></p>
          <p className="text-[12px] text-ink-soft">3 orders · full history</p>
        </div>
      </Card>
    ),
  },
];

export default function Convergence() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const fixed = useMotionValue(1);
  const [spread, setSpread] = useState(1);
  useEffect(() => {
    const u = () => setSpread(window.innerWidth < 768 ? 0.45 : 1);
    u();
    window.addEventListener('resize', u);
    return () => window.removeEventListener('resize', u);
  }, []);
  const p = reduce ? fixed : scrollYProgress;

  const frameOpacity = useTransform(p, [0.45, 0.7], [0, 1]);
  const frameScale = useTransform(p, [0.45, 0.7], [0.96, 1]);
  const captionOpacity = useTransform(p, [0.72, 0.85], [0, 1]);
  const captionY = useTransform(p, [0.72, 0.85], [20, 0]);

  return (
    <section ref={ref} aria-label="From chaos to clarity" className={`relative bg-paper ${reduce ? 'py-20' : 'h-[260vh]'}`}>
      <div className={`${reduce ? '' : 'sticky top-0 h-[100svh]'} flex items-center overflow-hidden`}>
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-5 px-5 pt-20 md:gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:px-10 lg:pt-0">
          {/* Problems list */}
          <div>
            <ul className="space-y-2 sm:space-y-4">
              {CHAOS.problems.map((problem, i) => (
                <Problem key={problem} text={problem} p={p} at={0.12 + i * 0.1} />
              ))}
            </ul>
            <motion.p style={{ opacity: captionOpacity, y: captionY }} className="mt-4 max-w-md font-display text-lg font-semibold leading-snug text-teal sm:mt-8 sm:text-2xl">
              {CHAOS.resolved}
            </motion.p>
          </div>

          {/* Converging workspace */}
          <div className="relative mx-auto aspect-square w-full max-w-[340px] sm:aspect-[4/3] sm:max-w-none">
            <motion.div style={{ opacity: frameOpacity, scale: frameScale }} className="absolute -inset-3 rounded-[2rem] bg-mesh-sage shadow-lift ring-1 ring-white sm:-inset-5">
              <div className="flex items-center gap-2 px-5 pt-4">
                <PulseLogo className="[&_svg]:h-7" />
                <span className="ml-auto hidden sm:block"><DemoLabel /></span>
              </div>
            </motion.div>
            <div className="absolute inset-0 grid grid-cols-2 grid-rows-3 gap-2.5 pt-12 sm:grid-cols-3 sm:grid-rows-2 sm:gap-3 sm:pt-14">
              {TILES.map((t, i) => (
                <TileView key={t.key} tile={t} p={p} index={i} spread={spread} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Problem({ text, p, at }: { text: string; p: MotionValue<number>; at: number }) {
  const done = useTransform(p, [at, at + 0.06], [0, 1]);
  const textOpacity = useTransform(done, [0, 1], [1, 0.55]);
  const strikeScale = useTransform(done, [0, 1], [0, 1]);
  return (
    <li className="flex items-start gap-3">
      <span className="relative mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fbe9e5] sm:h-7 sm:w-7">
        <motion.span style={{ opacity: done }} className="absolute inset-0 grid place-items-center rounded-full bg-teal text-white">
          <Check className="h-3.5 w-3.5" aria-hidden />
        </motion.span>
      </span>
      <div className="relative inline-block">
        <motion.span
          style={{ opacity: textOpacity }}
          className="text-[14px] font-medium leading-snug text-forest sm:text-lg"
        >
          {text}
        </motion.span>
        <motion.span
          style={{ scaleX: strikeScale, opacity: done }}
          className="absolute left-0 top-1/2 h-[1.5px] w-full origin-left bg-forest/55 pointer-events-none"
          aria-hidden
        />
      </div>
    </li>
  );
}

function TileView({ tile, p, index, spread }: { tile: Tile; p: MotionValue<number>; index: number; spread: number }) {
  const start = 0.08 + index * 0.05;
  const end = start + 0.32;
  const x = useTransform(p, [start, end], [tile.from.x * spread, 0]);
  const y = useTransform(p, [start, end], [tile.from.y * spread, 0]);
  const rotate = useTransform(p, [start, end], [tile.from.r, 0]);
  const tidy = useTransform(p, [end - 0.08, end], [0, 1]);
  const messy = useTransform(tidy, [0, 1], [1, 0]);
  return (
    <motion.div style={{ x, y, rotate }} className="relative z-10 min-h-0 drop-shadow-[0_14px_24px_rgba(21,59,55,0.12)]">
      <motion.div style={{ opacity: messy }} className="absolute inset-0">{tile.messy}</motion.div>
      <motion.div style={{ opacity: tidy }} className="absolute inset-0">{tile.tidy}</motion.div>
    </motion.div>
  );
}
