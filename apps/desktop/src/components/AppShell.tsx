import type { ReactNode } from "react";
import type { PageId } from "../types/navigation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  activePage: PageId;
  children: ReactNode;
  onNavigate: (page: PageId) => void;
  title: string;
}

export function AppShell({ activePage, children, onNavigate, title }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <Sidebar activePage={activePage} onNavigate={onNavigate} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1440px] p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
