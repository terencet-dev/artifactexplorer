'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RepositoryProvider } from '@/app/contexts/RepositoryContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  // Create a client in the component to ensure it's created for each request
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 30 * 60 * 1000, // 30 minutes
        retry: 2,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider>
        {children}
      </RepositoryProvider>
    </QueryClientProvider>
  );
} 