import React, { useState } from 'react';

export interface GalleryImage {
  src: string;
  alt: string;
  caption?: string;
}

export interface ImageGalleryProps {
  images: GalleryImage[];
  columns?: 2 | 3 | 4;
}

export function ImageGallery({ images, columns = 3 }: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const gridCols = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

  return (
    <>
      <div className={`grid ${gridCols[columns]} gap-3`}>
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => setSelectedIndex(i)}
            className="relative overflow-hidden rounded-[var(--dxp-radius)] border border-[var(--dxp-border)] group aspect-square"
          >
            <img src={img.src} alt={img.alt} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
            {img.caption && (
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs text-white">{img.caption}</p>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {selectedIndex !== null && (
        <>
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={() => setSelectedIndex(null)}>
            <div className="relative max-w-4xl max-h-[90vh] mx-4" onClick={(e) => e.stopPropagation()}>
              <img src={images[selectedIndex].src} alt={images[selectedIndex].alt} className="max-w-full max-h-[85vh] object-contain rounded-lg" />
              {images[selectedIndex].caption && (
                <p className="text-center text-sm text-white/80 mt-3">{images[selectedIndex].caption}</p>
              )}
              <button onClick={() => setSelectedIndex(null)} className="absolute -top-10 right-0 text-white/60 hover:text-white text-sm">Close</button>
              {selectedIndex > 0 && (
                <button onClick={() => setSelectedIndex(selectedIndex - 1)} className="absolute left-0 top-1/2 -translate-y-1/2 -ml-12 text-white/60 hover:text-white p-2">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
              )}
              {selectedIndex < images.length - 1 && (
                <button onClick={() => setSelectedIndex(selectedIndex + 1)} className="absolute right-0 top-1/2 -translate-y-1/2 -mr-12 text-white/60 hover:text-white p-2">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
