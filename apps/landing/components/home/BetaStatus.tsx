import React from 'react';
import { Check, Clock } from 'lucide-react';
import { ANCHORS, BETA, LINKS } from '@/content/pulse';
import { CTAButton, Eyebrow } from '../ui/primitives';

/** Honest beta scope: what works today vs. what is still being built. */
export default function BetaStatus() {
  return (
    <section id={ANCHORS.beta} className="relative bg-paper px-5 pb-28 pt-8 sm:pt-16">
      <div className="mx-auto grid max-w-6xl gap-10 rounded-[2.25rem] bg-mesh-sage p-6 ring-1 ring-white sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:p-14">
        <div>
          <Eyebrow>Beta</Eyebrow>
          <h2 className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-forest md:text-5xl">{BETA.title}</h2>
          <p className="mt-4 max-w-sm text-base leading-relaxed text-ink-soft">{BETA.body}</p>
          <div className="mt-8">
            <CTAButton href={LINKS.requestAccess}>Request beta access</CTAButton>
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-3xl bg-white/80 p-6 shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">Available today</p>
            <ul className="mt-4 space-y-3">
              {BETA.available.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-[15px] text-forest">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal text-white">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-dashed border-forest/20 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-soft">In development</p>
            <ul className="mt-4 space-y-3">
              {BETA.comingLater.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-[15px] text-ink-soft">
                  <Clock className="mt-0.5 h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-forest/10 pt-4 text-[13px] leading-relaxed text-ink-soft">{BETA.note}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
