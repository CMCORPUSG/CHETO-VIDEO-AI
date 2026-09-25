import type { ReactNode } from "react";
import type { PageId } from "../types/navigation";
import type { LocalProfile } from "../types/profile";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  activePage: PageId;
  children: ReactNode;
  onNavigate: (page: PageId) => void;
  onProfileAvatarChange: (avatar: string) => void;
  onProfileAvatarRemove: () => void;
  onProfileEdit: () => void;
  onProfileError: (message: string) => void;
  profile: LocalProfile;
  title: string;
}

export function AppShell({
  activePage,
  children,
  onNavigate,
  onProfileAvatarChange,
  onProfileAvatarRemove,
  onProfileEdit,
  onProfileError,
  profile,
  title,
}: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-transparent text-ink">
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        onProfileAvatarChange={onProfileAvatarChange}
        onProfileAvatarRemove={onProfileAvatarRemove}
        onProfileEdit={onProfileEdit}
        onProfileError={onProfileError}
        profile={profile}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="page-enter w-full max-w-none p-2 sm:p-2 lg:p-3" key={activePage}>{children}</div>
        </main>
      </div>
    </div>
  );
}

