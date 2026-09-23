import { Camera, CloudOff, Cpu, ImageMinus, Languages, Moon, Save, UserRound } from "lucide-react";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim()) onNameSave(name.trim());
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      onAvatarChange(await readAvatarFile(file));
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo leer la imagen.");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-6 flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><Moon aria-hidden="true" size={18} /></span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan">General</p>
            <h2 className="mt-1 font-bold text-ink">Preferencias de la aplicación</h2>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-line bg-canvas/45 p-4">
            <p className="text-xs font-semibold text-muted">Tema</p>
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink"><Moon aria-hidden="true" className="text-violet" size={16} />Oscuro</div>
          </div>
          <div className="rounded-lg border border-line bg-canvas/45 p-4">
            <p className="text-xs font-semibold text-muted">Idioma</p>
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink"><Languages aria-hidden="true" className="text-cyan" size={16} />Español</div>
          </div>
          <div className="rounded-lg border border-line bg-canvas/45 p-4">
            <p className="text-xs font-semibold text-muted">Inicio automático</p>
            <p className="mt-3 text-sm font-semibold text-muted">Disponible próximamente</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-6 flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-violet/10 text-violet"><UserRound aria-hidden="true" size={18} /></span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet">Perfil</p>
            <h2 className="mt-1 font-bold text-ink">Identidad local</h2>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-4">
            <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-line-bright bg-[var(--gradient-primary)] text-white shadow-glow">
              {profile.avatar ? <img alt="Avatar local" className="h-full w-full object-cover" src={profile.avatar} /> : <UserRound aria-hidden="true" size={28} />}
            </span>
            <div className="space-y-2">
              <input
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="sr-only"
                id={avatarInputId}
                onChange={(event) => void handleAvatarChange(event)}
                type="file"
              />
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line-bright bg-elevated px-3 py-2 text-xs font-semibold text-ink transition hover:border-cyan/50 hover:text-cyan" htmlFor={avatarInputId}>
                <Camera aria-hidden="true" size={15} />Cambiar foto
              </label>
              <Button disabled={!profile.avatar} icon={<ImageMinus aria-hidden="true" size={14} />} onClick={onAvatarRemove} variant="ghost">Quitar foto</Button>
            </div>
          </div>

          <form className="flex items-end gap-3" onSubmit={handleSubmit}>
            <div className="flex-1">
              <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="profile-name">Nombre visible</label>
              <input
                className="h-11 w-full rounded-md border border-line bg-canvas px-3.5 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25"
                id="profile-name"
                maxLength={48}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </div>
            <Button disabled={!name.trim() || name.trim() === profile.name} icon={<Save aria-hidden="true" size={15} />} type="submit">Guardar</Button>
          </form>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary/10 text-cyan"><Cpu aria-hidden="true" size={20} /></span>
            <StatusBadge label="Próximamente" />
          </div>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan">Procesamiento</p>
          <h2 className="mt-1.5 text-lg font-bold text-ink">Motor local</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Se configurará en próximas fases.</p>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-success/10 text-success"><CloudOff aria-hidden="true" size={20} /></span>
            <StatusBadge label="Desactivada" tone="success" />
          </div>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-success">API externa</p>
          <h2 className="mt-1.5 text-lg font-bold text-ink">Integraciones bajo demanda</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Las integraciones externas estarán apagadas por defecto y sólo se utilizarán cuando una función concreta las requiera.
          </p>
        </Card>
      </div>
    </div>
  );
}
