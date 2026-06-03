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
          <div className="pb-dock mx-auto w-full max-w-[1320px] px-4 pt-6 md:px-6 md:pt-8 lg:px-8 lg:pt-10">
            {children}
          </div>
        </PageTransition>
        <BottomNav alarmCount={alarmCount} />
      </div>
    </div>
  );
}
