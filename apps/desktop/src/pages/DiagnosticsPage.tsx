import { ClipboardCopy, Download, FileWarning, ListFilter } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";

const startupLogs = [
  "[INFO] Interfaz de escritorio iniciada.",
  "[INFO] Workspace local preparado.",
  "[INFO] Motor de procesamiento no iniciado.",
  "[INFO] Integraciones externas desactivadas.",
];

export function DiagnosticsPage() {
  const [feedback, setFeedback] = useState("");

  const copyLogs = async (limit: number) => {
    await navigator.clipboard.writeText(startupLogs.slice(-limit).join("\n"));
    setFeedback(`Se copiaron ${Math.min(limit, startupLogs.length)} líneas.`);
  };

  const exportLogs = () => {
    const blob = new Blob([startupLogs.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cheto-video-ai-diagnostico.txt";
    anchor.click();
    URL.revokeObjectURL(url);
    setFeedback("Diagnóstico exportado.");
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-ink">Resumen de ejecución</h2>
            <p className="mt-1 text-sm text-muted">Información local de esta sesión de interfaz.</p>
          </div>
          <StatusBadge label="Sin errores detectados" tone="success" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold text-ink">Registro de aplicación</h2>
            <p className="mt-1 text-xs text-muted">Preparado para futuras líneas del worker y los motores.</p>
          </div>
          <span className="font-mono text-xs text-muted">{startupLogs.length} líneas</span>
        </div>

        <div className="min-h-72 bg-canvas p-5 font-mono text-sm leading-7" aria-label="Registro de diagnóstico">
          {startupLogs.map((line, index) => (
            <div className="flex gap-4" key={line}>
              <span className="select-none text-muted/50">{String(index + 1).padStart(2, "0")}</span>
              <span className="text-muted">{line}</span>
            </div>
          ))}
          <div className="mt-2 flex items-center gap-2 text-cyan">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan" />
            <span>Esperando actividad</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface px-5 py-4">
          <Button icon={<ClipboardCopy aria-hidden="true" size={16} />} onClick={() => void copyLogs(100)} variant="secondary">
            Copiar últimas 100
          </Button>
          <Button icon={<ListFilter aria-hidden="true" size={16} />} onClick={() => void copyLogs(200)} variant="secondary">
            Copiar últimas 200
          </Button>
          <Button disabled icon={<FileWarning aria-hidden="true" size={16} />} variant="secondary">
            Copiar errores
          </Button>
          <Button icon={<Download aria-hidden="true" size={16} />} onClick={exportLogs} variant="secondary">
            Exportar diagnóstico
          </Button>
          {feedback ? <span className="ml-auto text-xs text-success" role="status">{feedback}</span> : null}
        </div>
      </Card>
    </div>
  );
}
