import { Link } from 'react-router-dom';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one calculators-page inline link recipe (Wave 18): persistent
 * underline, primary ink, soft hover. Replaces the hover:underline /
 * decoration-dotted drift across cards.
 */
export function InlineLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={cn('text-primary underline underline-offset-4 hover:text-primary/80', className)}
    />
  );
}
