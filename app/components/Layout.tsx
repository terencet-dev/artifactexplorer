'use client';

import React from 'react';
import Footer from './Footer';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="flex flex-col flex-grow">
      <main className="flex-grow flex flex-col py-4">
        {children}
      </main>
      <Footer />
    </div>
  );
} 