import { Camera, ImageMinus, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { cn } from "../lib/cn";

const avatarStorageKey = "cheto-video-ai.profile-avatar";
const maximumAvatarBytes = 2 * 1024 * 1024;

export function UserProfile() {
  const fileInputId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const [avatar, setAvatar] = useState<string | null>(() => localStorage.getItem(avatarStorageKey));
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [message, setMessage] = useState("");

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

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMessage("Selecciona una imagen válida.");
      return;
    }
    if (file.size > maximumAvatarBytes) {
      setMessage("La imagen debe pesar menos de 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return;
      localStorage.setItem(avatarStorageKey, reader.result);
      setAvatar(reader.result);
      setMessage("Foto actualizada.");
      setIsMenuOpen(false);
    });
    reader.addEventListener("error", () => setMessage("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    localStorage.removeItem(avatarStorageKey);
    setAvatar(null);
    setMessage("Foto eliminada.");
    setIsMenuOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <input
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="sr-only"
        id={fileInputId}
        onChange={handlePhotoChange}
        type="file"
      />

      {isMenuOpen ? (
        <div className="absolute bottom-[calc(100%+0.75rem)] left-0 z-40 w-56 rounded-lg border border-line-bright bg-elevated p-2 shadow-modal" role="menu">
          <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Perfil local
          </p>
          <label
            className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2.5 text-sm text-ink transition hover:bg-primary/10 hover:text-cyan"
            htmlFor={fileInputId}
            role="menuitem"
          >
            <Camera aria-hidden="true" size={17} />
            Cambiar foto
          </label>
          <button
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left text-sm text-muted transition hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!avatar}
            onClick={removePhoto}
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
          "group flex w-full items-center justify-center gap-3 rounded-lg border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan md:justify-start",
          isMenuOpen
            ? "border-primary/60 bg-primary/10"
            : "border-line bg-card/70 hover:border-line-bright hover:bg-elevated",
        )}
        onClick={() => setIsMenuOpen((current) => !current)}
        title="Perfil de usuario"
        type="button"
      >
        <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-line-bright bg-[var(--gradient-primary)] text-white shadow-glow">
          {avatar ? (
            <img alt="Foto de perfil" className="h-full w-full object-cover" src={avatar} />
          ) : (
            <UserRound aria-hidden="true" size={19} />
          )}
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card bg-success" />
        </span>
        <span className="hidden min-w-0 flex-1 md:block">
          <span className="block truncate text-sm font-semibold text-ink">Usuario local</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted">Editor local</span>
        </span>
        <span className="hidden h-1.5 w-1.5 rounded-full bg-muted/50 transition group-hover:bg-cyan md:block" />
      </button>
      <span className="sr-only" role="status">{message}</span>
    </div>
  );
}
