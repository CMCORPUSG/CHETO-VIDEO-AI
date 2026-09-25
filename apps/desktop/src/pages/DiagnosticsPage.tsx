import {
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileWarning,
  ScanSearch,
  TerminalSquare,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { StatusBadge } from "../components/StatusBadge";
import { cn } from "../lib/cn";
import {
  formatLogTime,
  getOperatingSystem,
} from "../lib/format";
import type {
  DiagnosticEvent,
  LogLevel,
  MediaDiagnosticState,
} from "../types/diagnostics";
import type { ToastTone } from "../types/toast";

type LogFilter = "all" | LogLevel;

interface DiagnosticsPageProps {
  events: DiagnosticEvent[];
  media: MediaDiagnosticState;
  onNotify: (
    message: string,
    tone?: ToastTone,
  ) => void;
}

const filters: Array<{
  id: LogFilter;
  label: string;
}> = [
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

function formatEvent(
  event: DiagnosticEvent,
): string {
  return `${formatLogTime(
    event.timestamp,
  )} [${event.level.toUpperCase()}] ${
    event.message
  }`;
}

function diagnosticFileName(
  date: Date,
): string {
  const digits = (value: number) =>
    String(value).padStart(2, "0");

  return `diagnostico_CHETO_${date.getFullYear()}${digits(
    date.getMonth() + 1,
  )}${digits(date.getDate())}_${digits(
    date.getHours(),
  )}${digits(date.getMinutes())}${digits(
    date.getSeconds(),
  )}.txt`;
}

export function DiagnosticsPage({
  events,
  media,
  onNotify,
}: DiagnosticsPageProps) {
  const [activeFilter, setActiveFilter] =
    useState<LogFilter>("all");

  const filteredEvents = useMemo(
    () =>
      activeFilter === "all"
        ? events
        : events.filter(
            (event) =>
              event.level === activeFilter,
          ),
    [activeFilter, events],
  );

  const copyEvents = async (
    selectedEvents: DiagnosticEvent[],
    limit: number,
  ) => {
    const text = selectedEvents
      .slice(-limit)
      .map(formatEvent)
      .join("\n");

    if (!text) {
      onNotify(
        "No hay eventos para copiar",
        "info",
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(text);

      onNotify(
        "Copiado al portapapeles",
        "success",
      );
    } catch {
      onNotify(
        "No se pudo acceder al portapapeles",
        "error",
      );
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
      `FFprobe: ${
        media.ffprobeAvailable
          ? media.ffprobeVersion ??
            "Detectado"
          : "No disponible"
      }`,
      `Última lectura: ${
        media.lastProbeMs === null
          ? "No disponible"
          : `${(
              media.lastProbeMs / 1_000
            ).toFixed(2)} s`
      }`,
      `Último archivo: ${
        media.lastFileName ??
        "No disponible"
      }`,
      "",
      "Eventos:",
      ...(events.length
        ? events.map(formatEvent)
        : ["Sin eventos registrados."]),
    ].join("\n");

    const blob = new Blob([content], {
      type: "text/plain;charset=utf-8",
    });

    const url =
      URL.createObjectURL(blob);

    const anchor =
      document.createElement("a");

    anchor.href = url;
    anchor.download =
      diagnosticFileName(now);

    anchor.click();

    URL.revokeObjectURL(url);

    onNotify(
      "Diagnóstico exportado",
      "success",
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-6">
      <header className="border-b border-white/[0.055] pb-5">
        <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted/40">
          Sistema
        </p>

        <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-ink">
          Diagnóstico
        </h2>

        <p className="mt-2 text-[11px] text-muted/55">
          Estado del entorno local y registro
          técnico de la aplicación.
        </p>
      </header>

      <section className="grid overflow-hidden rounded-xl border border-white/[0.06] bg-[#090f18] lg:grid-cols-2">
        <article className="p-5 lg:border-r lg:border-white/[0.05]">
          <div className="flex items-start justify-between gap-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-success/[0.07] text-success">
              <CheckCircle2
                aria-hidden="true"
                size={16}
              />
            </span>

            <StatusBadge
              label="Operativa"
              tone="success"
            />
          </div>

          <p className="mt-4 text-[9px] font-medium uppercase tracking-[0.12em] text-muted/40">
            Aplicación
          </p>

          <h3 className="mt-1 text-[13px] font-semibold text-ink">
            CHETO funcionando correctamente
          </h3>

          <p className="mt-1.5 text-[10px] leading-5 text-muted/50">
            No existen errores activos que
            impidan utilizar el workspace.
          </p>
        </article>

        <article className="border-t border-white/[0.05] p-5 lg:border-t-0">
          <div className="flex items-start justify-between gap-4">
            <span
              className={cn(
                "grid h-9 w-9 place-items-center rounded-lg",
                media.ffprobeAvailable
                  ? "bg-success/[0.07] text-success"
                  : "bg-warning/[0.07] text-warning",
              )}
            >
              <ScanSearch
                aria-hidden="true"
                size={16}
              />
            </span>

            <StatusBadge
              label={
                media.ffprobeAvailable
                  ? "Disponible"
                  : "No disponible"
              }
              tone={
                media.ffprobeAvailable
                  ? "success"
                  : "warning"
              }
            />
          </div>

          <p className="mt-4 text-[9px] font-medium uppercase tracking-[0.12em] text-muted/40">
            Motor multimedia
          </p>

          <h3 className="mt-1 text-[13px] font-semibold text-ink">
            FFprobe
          </h3>

          <p className="mt-1.5 truncate text-[10px] text-muted/50">
            {media.ffprobeVersion ??
              media.ffprobeDetail ??
              "Sin información de versión"}
          </p>

          <div className="mt-4 flex gap-6 border-t border-white/[0.05] pt-3">
            <div>
              <p className="text-[8px] uppercase tracking-[0.08em] text-muted/35">
                Última lectura
              </p>

              <p className="mt-1 font-mono text-[10px] text-ink/75">
                {media.lastProbeMs === null
                  ? "—"
                  : `${(
                      media.lastProbeMs /
                      1_000
                    ).toFixed(2)} s`}
              </p>
            </div>

            <div className="min-w-0">
              <p className="text-[8px] uppercase tracking-[0.08em] text-muted/35">
                Archivo
              </p>

              <p
                className="mt-1 max-w-[230px] truncate text-[10px] text-ink/75"
                title={
                  media.lastFileName ??
                  undefined
                }
              >
                {media.lastFileName ?? "—"}
              </p>
            </div>
          </div>
        </article>
      </section>

      <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#090f18]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted/40">
              Registro local
            </p>

            <h3 className="mt-1 text-[13px] font-semibold text-ink">
              Eventos de aplicación
            </h3>
          </div>

          <span className="font-mono text-[9px] text-muted/40">
            {events.length} eventos
          </span>
        </header>

        <div className="flex items-center gap-1.5 border-b border-white/[0.05] px-5 py-2.5">
          {filters.map((filter) => (
            <button
              aria-pressed={
                activeFilter === filter.id
              }
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-[9px] font-medium transition",
                activeFilter === filter.id
                  ? filter.id === "error"
                    ? "border-danger/20 bg-danger/[0.08] text-danger"
                    : filter.id === "warning"
                      ? "border-warning/20 bg-warning/[0.08] text-warning"
                      : "border-cyan/20 bg-cyan/[0.07] text-cyan"
                  : "border-transparent text-muted/50 hover:bg-white/[0.04] hover:text-ink",
              )}
              key={filter.id}
              onClick={() =>
                setActiveFilter(
                  filter.id,
                )
              }
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div
          aria-label="Registro de diagnóstico"
          className="min-h-[300px] max-h-[440px] overflow-auto bg-[#05090e] p-4 font-mono text-[9px] leading-6"
        >
          {filteredEvents.length ? (
            filteredEvents.map(
              (event, index) => (
                <div
                  className="grid grid-cols-[26px_62px_58px_1fr] gap-2 border-b border-white/[0.025]"
                  key={event.id}
                >
                  <span className="select-none text-muted/20">
                    {String(
                      index + 1,
                    ).padStart(2, "0")}
                  </span>

                  <span className="text-muted/45">
                    {formatLogTime(
                      event.timestamp,
                    )}
                  </span>

                  <span
                    className={cn(
                      "font-semibold",
                      levelStyles[
                        event.level
                      ],
                    )}
                  >
                    {event.level.toUpperCase()}
                  </span>

                  <span className="text-muted/65">
                    {event.message}
                  </span>
                </div>
              ),
            )
          ) : (
            <div className="flex min-h-[250px] flex-col items-center justify-center text-center">
              <TerminalSquare
                className="text-muted/30"
                size={25}
              />

              <p className="mt-3 font-sans text-[11px] font-medium text-ink/80">
                No hay eventos en este filtro
              </p>

              <p className="mt-1 font-sans text-[9px] text-muted/40">
                Los eventos aparecerán aquí.
              </p>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-white/[0.05] px-5 py-3">
          <Button
            icon={
              <ClipboardCopy size={13} />
            }
            onClick={() =>
              void copyEvents(events, 100)
            }
            variant="secondary"
          >
            Copiar 100
          </Button>

          <Button
            icon={
              <ClipboardCopy size={13} />
            }
            onClick={() =>
              void copyEvents(events, 200)
            }
            variant="secondary"
          >
            Copiar 200
          </Button>

          <Button
            icon={
              <FileWarning size={13} />
            }
            onClick={() =>
              void copyEvents(
                events.filter(
                  (event) =>
                    event.level ===
                    "error",
                ),
                200,
              )
            }
            variant="secondary"
          >
            Solo errores
          </Button>

          <div className="ml-auto">
            <Button
              icon={<Download size={13} />}
              onClick={
                exportDiagnostics
              }
            >
              Exportar diagnóstico
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
