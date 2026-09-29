import { open } from "@tauri-apps/plugin-dialog";
import { Camera, CloudOff, Cpu, FolderOpen, ImageMinus, Moon, UserRound } from "lucide-react";
import { useEffect, useId, useState, type ChangeEvent } from "react";
import { Button } from "../components/Button";
import { detectHardwareProfile, type HardwareProfile } from "../hardware/profile";
import { formatFileSize } from "../lib/format";
import { readAvatarFile } from "../lib/avatar";
import type { LocalProfile } from "../types/profile";
import { AUDIO_AI_SETTING, audioIntelligenceEnabled } from "../editor/audio-intelligence";

interface SettingsPageProps {
  onAvatarChange: (avatar: string) => void;
  onAvatarRemove: () => void;
  onError: (message: string) => void;
  onNameSave: (name: string) => void;
  onProfileChange: (changes: Partial<LocalProfile>) => void;
  profile: LocalProfile;
}

const locales = [
  ["es-PE", "Español (Perú)"], ["es-MX", "Español (México)"], ["es-ES", "Español (España / Castellano)"],
  ["es-AR", "Español (Argentina)"], ["es-CL", "Español (Chile)"], ["es-CO", "Español (Colombia)"],
  ["es-EC", "Español (Ecuador)"], ["es-BO", "Español (Bolivia)"], ["es-UY", "Español (Uruguay)"],
  ["es-PY", "Español (Paraguay)"], ["es-VE", "Español (Venezuela)"], ["es-US", "Español (Estados Unidos)"],
] as const;
const zones = ["America/Lima", "America/Mexico_City", "Europe/Madrid", "America/Argentina/Buenos_Aires", "America/Santiago", "America/Bogota", "America/Guayaquil", "America/La_Paz", "America/Montevideo", "America/Asuncion", "America/Caracas", "America/New_York", "UTC"];
const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function datePreview(profile: LocalProfile) {
  const date = new Date();
  const zone = profile.timezone && profile.timezone !== "auto" ? profile.timezone : systemZone;
  const locale = profile.locale || "es-PE";
  const parts = new Intl.DateTimeFormat(locale, { timeZone: zone, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const dateText = profile.dateFormat === "iso" ? `${value("year")}-${value("month")}-${value("day")}` : profile.dateFormat === "mdy" ? `${value("month")}/${value("day")}/${value("year")}` : `${value("day")}/${value("month")}/${value("year")}`;
  const timeText = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: profile.timeFormat === "12" }).format(date);
  return `${dateText} · ${timeText}`;
}

export function SettingsPage({ onAvatarChange, onAvatarRemove, onError, onNameSave, onProfileChange, profile }: SettingsPageProps) {
  const avatarInputId = useId();
  const [name, setName] = useState(profile.name);
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [hardwareError, setHardwareError] = useState(false);
  const [audioAiEnabled, setAudioAiEnabled] = useState(audioIntelligenceEnabled);
  useEffect(() => {
    let active = true;
    void detectHardwareProfile().then(value => { if (active) setHardware(value); }).catch(() => { if (active) setHardwareError(true); });
    return () => { active = false; };
  }, []);

  const avatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { onAvatarChange(await readAvatarFile(file)); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "No se pudo leer la imagen."); }
  };

  const chooseFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && !Array.isArray(selected)) onProfileChange({ defaultExportFolder: selected });
    } catch { onError("No se pudo elegir la carpeta de exportación."); }
  };

  return <div className="settings-page mx-auto w-full max-w-[1080px] space-y-5 pb-8">
    <header><p className="text-[9px] uppercase tracking-[0.16em] text-muted">Aplicación</p><h2 className="mt-1 text-[18px] font-semibold text-ink">Configuración</h2><p className="text-[10px] text-muted">Preferencias y perfil guardados en este equipo.</p></header>
    <section className="settings-section"><h3><Moon size={14}/> General</h3><div className="settings-grid">
      <Field label="Tema"><select className="cheto-input" onChange={event => onProfileChange({ theme: event.target.value as LocalProfile["theme"] })} value={profile.theme ?? "dark"}><option value="dark">Oscuro</option><option value="light">Claro</option><option value="system">Sistema</option></select></Field>
      <Field label="Idioma y región"><select className="cheto-input" onChange={event => onProfileChange({ locale: event.target.value })} value={profile.locale ?? "es-PE"}>{locales.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></Field>
      <Field label="Zona horaria"><select className="cheto-input" onChange={event => onProfileChange({ timezone: event.target.value })} value={profile.timezone ?? "auto"}><option value="auto">Automática · {systemZone}</option>{!zones.includes(systemZone) ? <option value={systemZone}>{systemZone}</option> : null}{zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</select></Field>
      <Field label="Formato de fecha"><select className="cheto-input" onChange={event => onProfileChange({ dateFormat: event.target.value as LocalProfile["dateFormat"] })} value={profile.dateFormat ?? "dmy"}><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option><option value="iso">YYYY-MM-DD</option></select></Field>
      <Field label="Formato de hora"><select className="cheto-input" onChange={event => onProfileChange({ timeFormat: event.target.value as LocalProfile["timeFormat"] })} value={profile.timeFormat ?? "24"}><option value="24">24 horas</option><option value="12">12 horas</option></select></Field>
      <div className="settings-preview"><span>Vista previa</span><strong>{datePreview(profile)}</strong></div>
    </div></section>
    <section className="settings-section"><h3><UserRound size={14}/> Perfil local</h3><div className="settings-profile">
      <div className="settings-avatar"><span>{profile.avatar ? <img alt="Foto de perfil" src={profile.avatar}/> : <UserRound size={24}/>}</span><div><input accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="sr-only" id={avatarInputId} onChange={event => void avatarChange(event)} type="file"/><label className="settings-file-button" htmlFor={avatarInputId}><Camera size={12}/> Cambiar foto</label><Button disabled={!profile.avatar} icon={<ImageMinus size={12}/>} onClick={onAvatarRemove} variant="ghost">Quitar</Button></div></div>
      <div className="settings-grid"><Field label="Nombre visible"><input className="cheto-input" maxLength={48} onBlur={() => { if (name.trim() && name.trim() !== profile.name) onNameSave(name.trim()); }} onChange={event => setName(event.target.value)} value={name}/></Field><Field label="Username"><input className="cheto-input" maxLength={32} onChange={event => onProfileChange({ username: event.target.value.replace(/[^\w.-]/g, "") })} value={profile.username ?? ""}/></Field><Field label="Canal o estudio"><input className="cheto-input" maxLength={64} onChange={event => onProfileChange({ studio: event.target.value })} value={profile.studio ?? ""}/></Field><Field label="Carpeta de exportación"><div className="flex gap-1"><output className="cheto-input flex-1 truncate" title={profile.defaultExportFolder || "Junto al video fuente"}>{profile.defaultExportFolder || "Junto al video fuente"}</output><Button aria-label="Elegir carpeta predeterminada" icon={<FolderOpen size={13}/>} onClick={() => void chooseFolder()} variant="secondary">Elegir</Button></div></Field></div>
    </div></section>
    <section className="settings-section"><h3><Cpu size={14}/> Mi PC</h3>{hardware ? <><div className="settings-hardware-grid"><Info label="Sistema" value={`${hardware.osName} ${hardware.osVersion} · ${hardware.architecture}`}/><Info label="CPU" value={hardware.cpu} detail={`${hardware.physicalCores} núcleos · ${hardware.logicalCores} hilos`}/><Info label="RAM" value={formatFileSize(hardware.ramTotalBytes)} detail={`${formatFileSize(hardware.ramAvailableBytes)} disponibles`}/><Info label="GPU" value={hardware.gpuAdapters[0]?.name ?? "No detectada"} detail={hardware.gpuAdapters[0] ? `${formatFileSize(hardware.gpuAdapters[0].dedicatedVideoMemoryBytes)} VRAM` : undefined}/><Info label="Aceleración" value={hardware.nvencAvailable ? "NVENC disponible" : "CPU disponible"} detail={hardware.nvencAvailable ? "Codificación de prueba validada" : "Exportación por CPU"}/><Info label="Disco" value={formatFileSize(hardware.diskFreeBytes)} detail={`Libres en ${hardware.diskMount}`}/></div><details className="settings-details"><summary>Ver detalles técnicos</summary><p>FFmpeg: {hardware.ffmpegVersion ?? "No disponible"}</p><p>FFprobe: {hardware.ffprobeVersion ?? "No disponible"}</p><p>Proyectos: {hardware.projectsPath}</p><p>Temporal: {hardware.tempPath}</p><p>Exportación: {profile.defaultExportFolder || "Junto al video fuente"}</p><p>GPU: {hardware.gpuAdapters.map(adapter => `${adapter.vendor} ${adapter.name}`).join(", ") || "Sin datos"}</p></details><p className="settings-status">{hardware.ffmpegVersion && hardware.ffprobeVersion ? "✓ Equipo compatible · FFmpeg disponible" : "⚠ Comprueba FFmpeg y FFprobe"}{hardware.nvencAvailable ? " · Aceleración disponible" : " · Exportación por CPU"}</p></> : <p className="text-[10px] text-muted">{hardwareError ? "El perfil de hardware no está disponible en esta sesión." : "Detectando hardware…"}</p>}</section>
    <section className="settings-section"><h3><CloudOff size={14}/> Privacidad y procesamiento</h3><p className="text-[10px] leading-5 text-muted">El perfil, las rutas, el hardware y las recomendaciones permanecen en este equipo. FFmpeg procesa tus archivos localmente. La API externa está desactivada.</p><label className="mt-3 flex items-center gap-2 text-[10px] text-ink"><input checked={audioAiEnabled} onChange={event => { const enabled = event.currentTarget.checked; setAudioAiEnabled(enabled); localStorage.setItem(AUDIO_AI_SETTING, String(enabled)); }} type="checkbox"/>Inteligencia de audio local</label><p className="mt-1 text-[9px] text-muted">Se ejecuta solo al pulsar «Analizar audio». No envía audio a la nube.</p></section>
  </div>;
}

function Field({ children, label }: { children: React.ReactNode; label: string }) { return <label className="settings-field"><span>{label}</span>{children}</label>; }
function Info({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="settings-info"><span>{label}</span><strong title={value}>{value}</strong>{detail ? <small>{detail}</small> : null}</div>; }
