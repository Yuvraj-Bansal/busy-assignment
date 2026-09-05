// app/(dashboard)/layout.tsx

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";
import { listActiveAlerts } from "@/src/services/registrationService";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/dashboard/TopBar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // Scoped by role inside listActiveAlerts: Organizers see every active
  // alert, Check-in Staff only see alerts for sessions they're assigned to.
  const alerts = await listActiveAlerts(user);

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar alerts={alerts} />
        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
