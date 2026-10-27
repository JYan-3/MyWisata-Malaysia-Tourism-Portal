import VendorSidebar from '@/components/layout/vendor-sidebar';
import VendorHeader from '@/components/layout/vendor-header';
import VendorAccessGate from '@/components/layout/vendor-access-gate';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SupportChatProvider } from '@/components/providers/support-chat';
import { ChatbotWidget } from '@/components/shared/chatbot-widget';

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');

  return (
    <>
      <style>{'html:has(.vendor-portal), body:has(.vendor-portal) { overflow-x: hidden; }'}</style>
      <div className="vendor-portal min-h-screen overflow-x-hidden bg-background">
        <VendorSidebar />
        <main className="ml-0 min-w-0 overflow-x-hidden lg:ml-60">
          <VendorHeader />
          {/* Extra bottom room on phones so the floating support chat button never covers the last content. */}
          <div className="w-full px-4 pt-6 pb-24 sm:px-6 sm:pt-8 lg:pb-8 xl:px-8">
            <VendorAccessGate>{children}</VendorAccessGate>
          </div>
        </main>
        {/* P4: the support chatbot (with its FAQ shortcuts) for vendors too —
            POST /api/chatbot/ask is role-agnostic, and the KB already carries
            vendor-facing entries. Its own SupportChatProvider instance: the
            provider is just local open/close state, and a vendor's chatbot
            has no relationship to a customer session's. */}
        <SupportChatProvider>
          <ChatbotWidget />
        </SupportChatProvider>
      </div>
    </>
  );
}
