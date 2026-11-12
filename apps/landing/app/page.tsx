import Navbar from '@/components/home/Navbar';
import Hero from '@/components/home/Hero';
import IntroReveal from '@/components/home/IntroReveal';
import FragmentStrips from '@/components/home/FragmentStrips';
import Convergence from '@/components/home/Convergence';
import ProductShowcase from '@/components/home/ProductShowcase';
import OrderWorkflow from '@/components/home/OrderWorkflow';
import UseCases from '@/components/home/UseCases';
import ClosingCTA from '@/components/home/ClosingCTA';
import BetaStatus from '@/components/home/BetaStatus';
import Footer from '@/components/home/Footer';

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-[100] rounded-full bg-forest px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Navbar />
      <main id="main" className="relative w-full">
        {/* 01 — Signature hero */}
        <Hero />
        {/* 02 — From chaos to clarity */}
        <IntroReveal />
        <FragmentStrips />
        <Convergence />
        {/* 03 — Interactive product showcase */}
        <ProductShowcase />
        {/* 04 — One conversation, one order */}
        <OrderWorkflow />
        {/* 05 — Built for real merchants */}
        <UseCases />
        {/* 06 — Closing CTA */}
        <ClosingCTA />
        <BetaStatus />
      </main>
      <Footer />
    </>
  );
}
