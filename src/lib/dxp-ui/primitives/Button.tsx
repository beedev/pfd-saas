import React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--dxp-brand)] text-white hover:bg-[var(--dxp-brand-dark)] focus-visible:ring-[var(--dxp-brand)]',
        secondary: 'border border-[var(--dxp-border)] bg-[var(--dxp-surface)] text-[var(--dxp-text)] hover:bg-[var(--dxp-border-light)]',
        danger: 'bg-[var(--dxp-danger)] text-white hover:bg-red-700 focus-visible:ring-[var(--dxp-danger)]',
        ghost: 'text-[var(--dxp-text-secondary)] hover:bg-[var(--dxp-border-light)] hover:text-[var(--dxp-text)]',
        link: 'text-[var(--dxp-brand)] underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 gap-1.5 rounded-[var(--dxp-radius)] px-3 text-xs',
        md: 'h-9 gap-2 rounded-[var(--dxp-radius)] px-4 text-sm',
        lg: 'h-11 gap-2 rounded-[var(--dxp-radius)] px-6 text-base',
        icon: 'h-9 w-9 rounded-[var(--dxp-radius)]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';
