import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { RegisterForm } from './register-form';

export const metadata: Metadata = {
  title: 'Create account',
  description: 'Create a Samadhaan account and start reporting civic problems.',
};

export default function RegisterPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
      <RegisterForm />
    </Suspense>
  );
}
