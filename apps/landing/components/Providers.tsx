'use client';

import { MotionConfig } from 'framer-motion';

/** reducedMotion="user" makes framer-motion animations respect the OS setting. */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
