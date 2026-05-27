import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import SessionManager from "./components/SessionManager";
import Layout from "./components/Layout";
import ClarityAnalytics from "./components/ClarityAnalytics";
import ThemeToggle from "./components/ThemeToggle";
import Script from 'next/script';
import SbomNavLink from "./components/SbomNavLink";
import "./globals.css";
import Providers from "./components/Providers";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Artifact Explorer",
  description: "A user-friendly explorer for OCI-compatible container registries",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        {/* Inline script to prevent dark mode flash */}
        <script dangerouslySetInnerHTML={{ 
          __html: `
            (function() {
              // Apply theme immediately to prevent flash
              try {
                const storedTheme = localStorage.getItem('artifact-explorer-theme');
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                
                if (storedTheme === 'dark' || (!storedTheme && prefersDark)) {
                  document.documentElement.classList.add('dark');
                  document.documentElement.classList.remove('light');
                } else {
                  document.documentElement.classList.add('light');
                  document.documentElement.classList.remove('dark');
                }
              } catch (e) {
                // Fallback to light mode if localStorage is not available
                document.documentElement.classList.add('light');
              }
            })();
          `
        }} />
        
        {/* Add fix for Next.js development mode 404 errors */}
        {process.env.NODE_ENV === 'development' && (
          <Script id="dev-error-handler" strategy="beforeInteractive">
            {`
              // Try to fix Next.js development server static assets 404 errors
              window.__NEXT_RETRY_COUNT = 0;
              window.__NEXT_MAX_RETRIES = 3;
              
              // Store original createElement to patch script loading
              const originalCreateElement = document.createElement;
              
              // Override createElement for script tags to handle retries
              document.createElement = function() {
                const element = originalCreateElement.apply(document, arguments);
                if (arguments[0] === 'script') {
                  const originalAddEventListener = element.addEventListener;
                  element.addEventListener = function(type, listener, options) {
                    if (type === 'error') {
                      const wrappedListener = function(event) {
                        const src = event.target.src || '';
                        // Only retry for Next.js chunks
                        if (src.includes('/_next/static/chunks/')) {
                          if (window.__NEXT_RETRY_COUNT < window.__NEXT_MAX_RETRIES) {
                            window.__NEXT_RETRY_COUNT++;
                            console.log('Retrying failed Next.js asset:', src);
                            setTimeout(() => {
                              const newScript = document.createElement('script');
                              newScript.src = src + '?retry=' + Date.now();
                              document.head.appendChild(newScript);
                            }, 1000);
                            // Prevent default error handling
                            event.preventDefault();
                            event.stopPropagation();
                            return false;
                          } else if (window.__NEXT_RETRY_COUNT === window.__NEXT_MAX_RETRIES) {
                            window.__NEXT_RETRY_COUNT++;
                            console.log('Max retries reached, reloading page...');
                            setTimeout(() => window.location.reload(), 1000);
                          }
                        }
                        return listener.apply(this, arguments);
                      };
                      return originalAddEventListener.call(this, type, wrappedListener, options);
                    }
                    return originalAddEventListener.apply(this, arguments);
                  };
                }
                return element;
              };
            `}
          </Script>
        )}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}>
        <Providers>
          <ClarityAnalytics />
          <div id="app-container" className="flex flex-col min-h-screen dark:bg-slate-900 dark:text-white" style={{ transition: "background-color 0.3s ease, color 0.3s ease" }}>
            <SessionManager />
            <header className="bg-[#2a446f] text-white p-4 shadow-md dark:bg-slate-800">
              <div className="container mx-auto flex justify-between items-center">
                <div className="flex items-center gap-6">
                  <Link href="/" className="inline-block hover:opacity-90 transition-opacity">
                    <h1 className="text-xl font-bold">Artifact Explorer</h1>
                  </Link>
                  <SbomNavLink />
                </div>
                <ThemeToggle />
              </div>
            </header>
            <Layout>
              {children}
            </Layout>
          </div>
        </Providers>

        {/* Add client-side theme detection script */}
        <Script id="theme-script" strategy="afterInteractive">
          {`
            (function() {
              // Try to get theme from localStorage
              const storedTheme = localStorage.getItem('artifact-explorer-theme');
              
              // Apply theme from localStorage or system preference
              if (storedTheme === 'dark' || 
                  (!storedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark');
                document.documentElement.classList.remove('light');
              } else {
                document.documentElement.classList.add('light');
                document.documentElement.classList.remove('dark');
              }
              
              // Listen for system preference changes
              const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
              mediaQuery.addEventListener('change', (e) => {
                if (localStorage.getItem('artifact-explorer-theme')) return;
                
                if (e.matches) {
                  document.documentElement.classList.add('dark');
                  document.documentElement.classList.remove('light');
                } else {
                  document.documentElement.classList.add('light');
                  document.documentElement.classList.remove('dark');
                }
              });
            })();
          `}
        </Script>
      </body>
    </html>
  );
}
