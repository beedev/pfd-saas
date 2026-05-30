import React, { useRef, useState } from 'react';
import { Button } from '../primitives/Button';

export interface CarouselItem {
  id: string;
  content: React.ReactNode;
}

export interface ItemCarouselProps {
  items: CarouselItem[];
  title?: string;
  itemWidth?: number;
  gap?: number;
}

export function ItemCarousel({ items, title, itemWidth = 280, gap = 16 }: ItemCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  };

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = itemWidth + gap;
    scrollRef.current.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
    setTimeout(updateScroll, 300);
  };

  return (
    <div>
      {title && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-[var(--dxp-text)]">{title}</h3>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => scroll('left')} disabled={!canScrollLeft}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => scroll('right')} disabled={!canScrollRight}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Button>
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={updateScroll}
        className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory"
        style={{ gap: `${gap}px`, scrollbarWidth: 'none' }}
      >
        {items.map((item) => (
          <div key={item.id} className="flex-shrink-0 snap-start" style={{ width: `${itemWidth}px` }}>
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}
