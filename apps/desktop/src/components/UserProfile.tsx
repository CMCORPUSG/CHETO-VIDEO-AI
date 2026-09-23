import { Camera, ImageMinus, Pencil, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { readAvatarFile } from "../lib/avatar";
import { cn } from "../lib/cn";
import type { LocalProfile } from "../types/profile";

interface UserProfileProps {
  onAvatarChange: (avatar: string) => void;
  onAvatarRemove: () => void;
  onEditName: () => void;
  onError: (message: string) => void;
  profile: LocalProfile;
}

export function UserProfile({
  onAvatarChange,
  onAvatarRemove,
  onEditName,
  onError,
  profile,
}: UserProfileProps) {
  const fileInputId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen]);

  const handlePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const avatar = await readAvatarFile(file);
      onAvatarChange(avatar);
      setIsMenuOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo leer la imagen.");
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <input
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="sr-only"
        id={fileInputId}
        onChange={(event) => void handlePhotoChange(event)}
        type="file"
      />

      {isMenuOpen ? (
        <div className="menu-enter absolute bottom-[calc(100%+0.75rem)] left-0 z-40 w-56 rounded-lg border border-line-bright bg-elevated p-2 shadow-modal" role="menu">
          <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Perfil local</p>
          <label
            className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2.5 text-sm text-ink transition hover:bg-primary/10 hover:text-cyan"
            htmlFor={fileInputId}
            role="menuitem"
          >
            <Camera aria-hidden="true" size={17} />
            Cambiar foto
          </label>
          <button
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left text-sm text-ink transition hover:bg-primary/10 hover:text-cyan"
            onClick={() => {
              setIsMenuOpen(false);
              onEditName();
            }}
            role="menuitem"
            type="button"
          >
            <Pencil aria-hidden="true" size={17} />
            Editar nombre
          </button>
          <button
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left text-sm text-muted transition hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!profile.avatar}
            onClick={() => {
              setIsMenuOpen(false);
              onAvatarRemove();
            }}
            role="menuitem"
            type="button"
          >
            <ImageMinus aria-hidden="true" size={17} />
            Quitar foto
          </button>
        </div>
      ) : null}

      <button
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        className={cn(
          "group flex w-full items-center justify-center gap-3 rounded-lg border p-2 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan md:justify-start",
          isMenuOpen
            ? "border-primary/60 bg-primary/10"
            : "border-line bg-card/70 hover:border-line-bright hover:bg-elevated",
        )}
        onClick={() => setIsMenuOpen((current) => !current)}
        title="Perfil de usuario"
        type="button"
      >
        <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-line-bright bg-[var(--gradient-primary)] text-white shadow-glow">
          {profile.avatar ? (
            <img alt="Foto de perfil" className="h-full w-full object-cover" src={profile.avatar} />
          ) : (
            <UserRound aria-hidden="true" size={19} />
          )}
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card bg-success" />
        </span>
        <span className="hidden min-w-0 flex-1 md:block">
          <span className="block truncate text-sm font-semibold text-ink">{profile.name}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted">Editor local</span>
        </span>
        <span className="hidden h-1.5 w-1.5 rounded-full bg-muted/50 transition group-hover:bg-cyan md:block" />
      </button>
    </div>
  );
}
