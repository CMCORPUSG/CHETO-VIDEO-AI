import {
  Camera,
  CloudOff,
  Cpu,
  ImageMinus,
  Languages,
  Moon,
  Save,
  UserRound,
} from "lucide-react";
import {
  useId,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button } from "../components/Button";
import { StatusBadge } from "../components/StatusBadge";
import { readAvatarFile } from "../lib/avatar";
import type { LocalProfile } from "../types/profile";

interface SettingsPageProps {
  onAvatarChange: (avatar: string) => void;
  onAvatarRemove: () => void;
  onError: (message: string) => void;
  onNameSave: (name: string) => void;
  profile: LocalProfile;
}

export function SettingsPage({
  onAvatarChange,
  onAvatarRemove,
  onError,
  onNameSave,
  profile,
}: SettingsPageProps) {
  const avatarInputId = useId();
  const [name, setName] = useState(profile.name);

  const handleSubmit = (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (name.trim()) {
      onNameSave(name.trim());
    }
  };

  const handleAvatarChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    try {
      onAvatarChange(await readAvatarFile(file));
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "No se pudo leer la imagen.",
      );
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6">
      <header className="pb-1">
        <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted/40">
          Aplicación
        </p>

        <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-ink">
          Configuración
        </h2>

        <p className="mt-1.5 text-[10px] text-muted/55">
          Preferencias locales de CHETO VIDEO AI.
        </p>
      </header>

      <section>
        <SectionTitle
          description="Preferencias generales del entorno."
          icon={<Moon size={15} />}
          title="General"
        />

        <div className="overflow-hidden rounded-lg bg-[#0a111b] ring-1 ring-white/[0.055]">
          <SettingRow
            icon={<Moon size={15} />}
            label="Tema"
            value="Oscuro"
          />

          <SettingRow
            icon={<Languages size={15} />}
            label="Idioma"
            value="Español"
          />

          <SettingRow
            label="Inicio automático"
            value="Próximamente"
          />
        </div>
      </section>

      <section>
        <SectionTitle
          description="Información utilizada únicamente dentro de la aplicación."
          icon={<UserRound size={15} />}
          title="Perfil local"
        />

        <div className="rounded-lg bg-[#0a111b] p-4 ring-1 ring-white/[0.055]">
          <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
            <div className="flex items-center gap-4">
              <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] text-muted">
                {profile.avatar ? (
                  <img
                    alt="Avatar local"
                    className="h-full w-full object-cover"
                    src={profile.avatar}
                  />
                ) : (
                  <UserRound
                    aria-hidden="true"
                    size={23}
                  />
                )}
              </span>

              <div className="space-y-2">
                <input
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="sr-only"
                  id={avatarInputId}
                  onChange={(event) =>
                    void handleAvatarChange(event)
                  }
                  type="file"
                />

                <label
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[10px] font-medium text-muted transition hover:bg-white/[0.05] hover:text-ink"
                  htmlFor={avatarInputId}
                >
                  <Camera size={13} />
                  Cambiar foto
                </label>

                <Button
                  disabled={!profile.avatar}
                  icon={<ImageMinus size={13} />}
                  onClick={onAvatarRemove}
                  variant="ghost"
                >
                  Quitar
                </Button>
              </div>
            </div>

            <form
              className="flex items-end gap-3"
              onSubmit={handleSubmit}
            >
              <div className="flex-1">
                <label
                  className="mb-2 block text-[10px] font-medium text-muted/70"
                  htmlFor="profile-name"
                >
                  Nombre visible
                </label>

                <input
                  className="cheto-input"
                  id="profile-name"
                  maxLength={48}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  value={name}
                />
              </div>

              <Button
                disabled={
                  !name.trim() ||
                  name.trim() === profile.name
                }
                icon={<Save size={14} />}
                type="submit"
              >
                Guardar
              </Button>
            </form>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle
          description="Servicios utilizados por el editor."
          icon={<Cpu size={15} />}
          title="Procesamiento y privacidad"
        />

        <div className="grid overflow-hidden rounded-lg bg-[#0a111b] ring-1 ring-white/[0.055] lg:grid-cols-2">
          <div className="p-4 lg:border-r lg:border-white/[0.05]">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.035] text-muted/60">
                <Cpu size={15} />
              </span>

              <StatusBadge label="Próximamente" />
            </div>

            <h3 className="mt-4 text-[13px] font-semibold text-ink">
              Motor local
            </h3>

            <p className="mt-1.5 text-[10px] leading-5 text-muted/50">
              Las opciones avanzadas del motor local se incorporarán
              en siguientes fases.
            </p>
          </div>

          <div className="border-t border-white/[0.05] p-4 lg:border-t-0">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-success/[0.06] text-success">
                <CloudOff size={15} />
              </span>

              <StatusBadge
                label="Desactivada"
                tone="success"
              />
            </div>

            <h3 className="mt-4 text-[13px] font-semibold text-ink">
              API externa
            </h3>

            <p className="mt-1.5 text-[10px] leading-5 text-muted/50">
              Las integraciones externas permanecen apagadas y se
              utilizarán únicamente cuando una función las necesite.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({
  description,
  icon,
  title,
}: {
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="mb-2.5 flex items-start gap-2">
      <span className="mt-0.5 text-muted/45">
        {icon}
      </span>

      <div>
        <h3 className="text-[12px] font-semibold text-ink">
          {title}
        </h3>

        <p className="mt-0.5 text-[9px] text-muted/45">
          {description}
        </p>
      </div>
    </div>
  );
}

function SettingRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-[50px] items-center justify-between gap-4 border-b border-white/[0.05] px-4 last:border-b-0">
      <div className="flex items-center gap-3">
        {icon ? (
          <span className="text-muted/45">
            {icon}
          </span>
        ) : (
          <span className="w-[15px]" />
        )}

        <span className="text-[10px] font-medium text-muted/65">
          {label}
        </span>
      </div>

      <span className="text-[10px] font-semibold text-ink/80">
        {value}
      </span>
    </div>
  );
}
