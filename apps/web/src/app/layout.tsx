import type { Metadata } from 'next';
import './globals.css';
import { LanguageProvider } from '@/i18n';
import { ToastProvider } from '@/components/toast';

export const metadata: Metadata = {
  title: 'Self-Hosted Panel',
  description: 'Deploy your SaaS projects from git into Docker.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="relative min-h-screen overflow-x-hidden font-sans">
        {/* Fluid animated background */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -left-40 -top-40 h-[42rem] w-[42rem] animate-blob-1 rounded-full bg-indigo-600/25 blur-[120px]" />
          <div className="absolute -right-40 top-10 h-[38rem] w-[38rem] animate-blob-2 rounded-full bg-cyan-500/20 blur-[120px]" />
          <div className="absolute bottom-[-12rem] left-1/3 h-[40rem] w-[40rem] animate-blob-3 rounded-full bg-fuchsia-600/20 blur-[120px]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(7,10,18,0.6))]" />
        </div>
        <LanguageProvider>
          <ToastProvider>{children}</ToastProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
