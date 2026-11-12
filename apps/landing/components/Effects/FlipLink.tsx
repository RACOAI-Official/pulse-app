'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

const FlipLink = ({ 
  children, 
  hasDropdown, 
  isActive 
}: { 
  children: string; 
  hasDropdown?: boolean; 
  isActive?: boolean; 
}) => {
  // 1. Track local hover state manually to avoid conflict with parent animations
  const [isHovered, setIsHovered] = useState(false);

  // 2. Determine final state
  const shouldFlip = isHovered;
  const shouldFlipChevron = isActive || isHovered;

  // 3. Define unique variant names to prevent propagation issues
  const textVariants = {
    initial: { y: 0 },
    flipped: { y: "-100%" },
  };

  const bottomTextVariants = {
    initial: { y: "100%" },
    flipped: { y: 0 },
  };

  const arrowVariants = {
    initial: { rotate: 0 },
    flipped: { rotate: 180 },
  };

  return (
    <motion.div
      // Use local state handlers instead of whileHover
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      className="relative flex items-center gap-1 cursor-pointer overflow-hidden py-1.5"
    >
      <span className="sr-only">{children}</span>
      <div aria-hidden className="relative overflow-hidden text-forest font-medium text-[15px]">
        {/* Top Text (Visible initially) */}
        <div className="flex">
          {children.split("").map((l, i) => (
            <motion.span
              key={i}
              variants={textVariants}
              animate={shouldFlip ? "flipped" : "initial"} // Explicitly controlled
              transition={{ duration: 0.25, ease: "easeInOut", delay: 0.02 * i }}
              className="inline-block"
            >
              {l === " " ? "\u00A0" : l}
            </motion.span>
          ))}
        </div>
        
        {/* Bottom Text (Hidden/Slide Up) */}
        <div className="absolute inset-0 flex">
          {children.split("").map((l, i) => (
            <motion.span
              key={i}
              variants={bottomTextVariants}
              animate={shouldFlip ? "flipped" : "initial"} // Explicitly controlled
              transition={{ duration: 0.25, ease: "easeInOut", delay: 0.02 * i }}
              className="inline-block"
            >
              {l === " " ? "\u00A0" : l}
            </motion.span>
          ))}
        </div>
      </div>

      {hasDropdown && (
        <motion.div
          aria-hidden
          variants={arrowVariants}
          animate={shouldFlipChevron ? "flipped" : "initial"} // Explicitly controlled
          transition={{ duration: 0.3 }}
        >
          <ChevronDown className="w-4 h-4 text-ink-soft" />
        </motion.div>
      )}
    </motion.div>
  );
};

export default FlipLink;