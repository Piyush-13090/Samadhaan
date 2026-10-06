import type { ComponentProps } from 'react';
import { controlBaseClasses } from '@/components/ui/input';
import { useFieldControl } from '@/components/ui/field';
import { cn } from '@/lib/cn';

/** A styled native `<select>`: full keyboard and screen-reader support for free. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  const fieldProps = useFieldControl();
  return (
    <select
      className={cn(controlBaseClasses, 'h-10 px-3 type-body-sm', className)}
      {...fieldProps}
      {...props}
    />
  );
}
