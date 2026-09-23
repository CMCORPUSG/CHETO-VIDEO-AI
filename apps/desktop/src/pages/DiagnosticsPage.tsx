import { CheckCircle2, ClipboardCopy, Download, FileWarning, ListFilter, ScanSearch, TerminalSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { cn } from "../lib/cn";
import { formatLogTime, getOperatingSystem } from "../lib/format";
import type { DiagnosticEvent, LogLevel, MediaDiagnosticState } from "../types/diagnostics";
import type { ToastTone } from "../types/toast";

type LogFilter = "all" | LogLevel;

interface DiagnosticsPageProps {
  events: DiagnosticEvent[];
  media: MediaDiagnosticState;
  onNotify: (message: string, tone?: ToastTone) => void;
}

const filters: Array<{ id: LogFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "info", label: "Info" },
  { id: "warning", label: "Warning" },
  { id: "error", label: "Error" },
];

const levelStyles: Record<LogLevel, string> = {
  info: "text-cyan",
  warning: "text-warning",
  error: "text-danger",
};

function formatEvent(event: DiagnosticEvent): string {
  return `${formatLogTime(event.timestamp)} [${event.level.toUpperCase()}] ${event.message}`;
}

function diagnosticFileName(date: Date): string {
  const digits = (value: number) => String(value).padStart(2, "0");
  return `diagnostico_CHETO_${date.getFullYear()}${digits(date.getMonth() + 1)}${digits(date.getDate())}_${digits(date.getHours())}${digits(date.getMinutes())}${digits(date.getSeconds())}.txt`;
}

export function DiagnosticsPage({ events, media, onNotify }: DiagnosticsPageProps) {
  const [activeFilter, setActiveFilter] = useState<LogFilter>("all");
  const filteredEvents = useMemo(
    () => activeFilter === "all" ? events : events.filter((event) => event.level === activeFilter),
    [activeFilter, events],
  );

  const copyEvents = async (selectedEvents: DiagnosticEvent[], limit: number) => {
    const text = selectedEvents.slice(-limit).map(formatEvent).join("\n");
    if (!text) {
      onNotify("No hay eventos para copiar", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      onNotify("Copiado al portapapeles", "success");
    } catch {
      onNotify("No se pudo acceder al portapapeles", "error");
    }
  };

  const exportDiagnostics = () => {
    const now = new Date();
    const content = [
      "CHETO VIDEO AI — Diagnóstico local",
      "Versión interna: 0.2.0",
      `Sistema operativo: ${getOperatingSystem()}`,
      `Fecha: ${now.toLocaleString("es-PE")}`,
      "Tema: Oscuro",
      "Idioma: Español",
      "API externa: Desactivada",
      `FFprobe: ${media.ffprobeAvailable ? media.ffprobeVersion ?? "Detectado" : "No disponible"}`,
      `Última lectura: ${media.lastProbeMs === null ? "No disponible" : `${(media.lastProbeMs / 1_000).toFixed(2)} s`}`,
      `Último archivo: ${media.lastFileName ?? "No disponible"}`,
      "",
      "Eventos:",
      ...(events.length ? events.map(formatEvent) : ["Sin eventos registrados."]),
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = diagnosticFileName(now);
    anchor.click();
    URL.revokeObjectURL(url);
    onNotify("Diagnóstico exportado", "success");
  };

  return (
    <div className="space-y-6">
      <Card className="surface-shine p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-lg border border-success/25 bg-success/10 text-success">
              <CheckCircle2 aria-hidden="true" size={20} />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Estado</p>
              <h2 className="mt-1 font-bold text-ink">Aplicación operativa</h2>
            </div>
          </div>
          <StatusBadge label="Sin errores activos" tone="success" />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className={`grid h-11 w-11 place-items-center rounded-lg border ${media.ffprobeAvailable ? "border-success/25 bg-success/10 text-success" : "border-warning/25 bg-warning/10 text-warning"}`}><ScanSearch aria-hidden="true" size={20} /></span>
            <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Motor multimedia</p><h2 className="mt-1 font-bold text-ink">FFprobe · {media.ffprobeAvailable ? "Detectado" : "No disponible"}</h2><p className="mt-1 text-xs text-muted">{media.ffprobeVersion ?? media.ffprobeDetail ?? "Sin información de versión"}</p></div>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-right">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted/70">Última lectura</p><p className="mt-1 text-sm font-semibold text-ink">{media.lastProbeMs === null ? "—" : `${(media.lastProbeMs / 1_000).toFixed(2)} s`}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted/70">Archivo</p><p className="mt-1 max-w-44 truncate text-sm font-semibold text-ink" title={media.lastFileName ?? undefined}>{media.lastFileName ?? "—"}</p></div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan">Log local</p>
            <h2 className="mt-1.5 font-bold text-ink">Eventos de la aplicación</h2>
          </div>
          <span className="font-mono text-xs text-muted">{events.length} eventos reales</span>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-line bg-surface px-5 py-3">
          {filters.map((filter) => (
            <button
              aria-pressed={activeFilter === filter.id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
                activeFilter === filter.id
                  ? "border-primary/60 bg-primary/15 text-cyan"
                  : "border-line bg-card/50 text-muted hover:border-line-bright hover:text-ink",
              )}
              key={filter.id}
              onClick={() => setActiveFilter(filter.id)}
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="min-h-80 max-h-[440px] overflow-auto bg-canvas p-5 font-mono text-xs leading-7" aria-label="Registro de diagnóstico">
          {filteredEvents.length ? filteredEvents.map((event, index) => (
            <div className="grid grid-cols-[2rem_4.5rem_4.5rem_1fr] gap-2" key={event.id}>
              <span className="select-none text-muted/35">{String(index + 1).padStart(2, "0")}</span>
              <span className="text-muted/70">{formatLogTime(event.timestamp)}</span>
              <span className={cn("font-bold", levelStyles[event.level])}>[{event.level.toUpperCase()}]</span>
              <span className="text-muted">{event.message}</span>
            </div>
          )) : (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <TerminalSquare aria-hidden="true" className="text-muted/60" size={28} />
              <p className="mt-3 font-sans text-sm font-semibold text-ink">No hay eventos en este filtro</p>
              <p className="mt-1 font-sans text-xs text-muted">Los eventos reales aparecerán aquí.</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface px-5 py-4">
          <Button icon={<ClipboardCopy aria-hidden="true" size={16} />} onClick={() => void copyEvents(events, 100)} variant="secondary">
            Copiar 100
          </Button>
          <Button icon={<ListFilter aria-hidden="true" size={16} />} onClick={() => void copyEvents(events, 200)} variant="secondary">
            Copiar 200
          </Button>
          <Button icon={<FileWarning aria-hidden="true" size={16} />} onClick={() => void copyEvents(events.filter((event) => event.level === "error"), 200)} variant="secondary">
            Copiar errores
          </Button>
          <Button icon={<Download aria-hidden="true" size={16} />} onClick={exportDiagnostics} variant="secondary">
            Exportar diagnóstico
          </Button>
        </div>
      </Card>
    </div>
  );
}
