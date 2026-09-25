import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Camera,
  ChevronUp,
  ImageMinus,
  Pencil,
  UserRound,
} from "lucide-react";
import {
  useRef,
  type ChangeEvent,
} from "react";
import { readAvatarFile } from "../lib/avatar";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const avatar = await readAvatarFile(file);
      onAvatarChange(avatar);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "No se pudo leer la imagen.",
      );
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="sr-only"
        onChange={(event) => void handlePhotoChange(event)}
        type="file"
      />

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label="Abrir perfil local"
            className="group flex h-[52px] w-full items-center justify-center gap-2.5 rounded-lg bg-white/[0.025] px-2 ring-1 ring-white/[0.055] transition-[background-color,box-shadow] duration-150 hover:bg-white/[0.045] hover:ring-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/55 md:justify-start"
            type="button"
          >
            <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white/[0.04] text-muted ring-1 ring-white/[0.06]">
              {profile.avatar ? (
                <img
                  alt="Foto de perfil"
                  className="h-full w-full object-cover"
                  src={profile.avatar}
                />
              ) : (
                <UserRound
                  aria-hidden="true"
                  size={16}
                  strokeWidth={1.8}
                />
              )}

              <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-success ring-2 ring-[#080f19]" />
            </span>

            <span className="hidden min-w-0 flex-1 text-left md:block">
              <span className="block truncate text-[11px] font-semibold text-ink">
                {profile.name}
              </span>

              <span className="mt-0.5 block truncate text-[9px] text-muted/50">
                Editor local
              </span>
            </span>

            <ChevronUp
              aria-hidden="true"
              className="hidden shrink-0 text-muted/35 transition-colors group-hover:text-muted md:block"
              size={13}
              strokeWidth={1.8}
            />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            side="top"
            sideOffset={8}
            className="menu-enter z-[100] min-w-[210px] rounded-lg border border-white/[0.08] bg-[#0d1623] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.45)]"
          >
            <div className="px-2.5 pb-2 pt-1.5">
              <p className="truncate text-[11px] font-semibold text-ink">
                {profile.name}
              </p>

              <p className="mt-0.5 text-[9px] text-muted/45">
                Perfil local
              </p>
            </div>

            <DropdownMenu.Separator className="my-1 h-px bg-white/[0.06]" />

            <DropdownMenu.Item
              className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] text-muted outline-none transition-colors data-[highlighted]:bg-white/[0.055] data-[highlighted]:text-ink"
              onSelect={() => {
                fileInputRef.current?.click();
              }}
            >
              <Camera
                aria-hidden="true"
                size={15}
                strokeWidth={1.8}
              />

              Cambiar foto
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] text-muted outline-none transition-colors data-[highlighted]:bg-white/[0.055] data-[highlighted]:text-ink"
              onSelect={onEditName}
            >
              <Pencil
                aria-hidden="true"
                size={15}
                strokeWidth={1.8}
              />

              Editar nombre
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-white/[0.06]" />

            <DropdownMenu.Item
              className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] text-muted outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-30 data-[highlighted]:bg-danger/10 data-[highlighted]:text-danger"
              disabled={!profile.avatar}
              onSelect={onAvatarRemove}
            >
              <ImageMinus
                aria-hidden="true"
                size={15}
                strokeWidth={1.8}
              />

              Quitar foto
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
