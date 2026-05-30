import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Internal utility — NOT exported from @dxp/ui.
// Portal code should never need this.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
