import type { PropsWithChildren } from "react";
import { Sidebar } from "@/components/nav/sidebar";
import { Topbar } from "@/components/nav/topbar";
import { BottomNav } from "@/components/nav/bottom-nav";
import { PageTransition } from "@/components/motion/page-transition";
import { countActiveAlarms } from "@/lib/insights";

export default async function AppShellLayout({ children }: PropsWithChildren) {
  const alarmCount = await countActiveAlarms().catch(() => 0);

  return (
    <div className="flex min-h-dvh">
      <Sidebar alarmCount={alarmCount} />
      <div className="flex flex-col flex-1 min-w-0">
        <Topbar alarmCount={alarmCount} />
        <PageTransition>
          <div className="px-4 md:px-6 lg:px-8 py-6 md:py-8 lg:py-10 pb-24 lg:pb-12 max-w-[1320px] w-full mx-auto">
            {children}
          </div>
        </PageTransition>
        <BottomNav alarmCount={alarmCount} />
      </div>
    </div>
  );
}
