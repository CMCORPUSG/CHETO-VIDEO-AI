import { AlertTriangle, CheckCircle2, Cpu, Film, Gauge, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatFileSize } from "../../lib/format";
import type { ProjectBundle } from "../../project/contracts";
import type { LogLevel } from "../../types/diagnostics";
import { preferredPlaybackKind, type PlaybackPreference, type PlaybackSource, type ProxyStatus } from "../../playback/models";
import { cancelProxy, createProxy, getProxyStatus, onProxyDiagnostic, onProxyProgress, playbackErrorMessage, resolvePlaybackSource } from "../../playback/service";
import { Button } from "../Button";
import { Card } from "../Card";
import { SmartCutWorkspace } from "./SmartCutWorkspace";
import { VideoPlayer } from "./VideoPlayer";
import { TranscriptionWorkspace } from "./TranscriptionWorkspace";

interface MediaWorkspaceProps {
  bundle: ProjectBundle;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}

const initialStatus: ProxyStatus = { message: null, metadata: null, processedUs: null, progress: null, state: "not_created" };

export function MediaWorkspace({ bundle, onLog, onNotify }: MediaWorkspaceProps) {
  const projectId = bundle.project.projectId;
  const [status, setStatus] = useState<ProxyStatus>(initialStatus);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestedSeekUs, setRequestedSeekUs] = useState<number | null>(null);
  const progressBucket = useRef(-1);

  const resolveSource = useCallback(async (nextPreference: PlaybackPreference, currentStatus?: ProxyStatus) => {
    try {
      const effective = nextPreference === "proxy" && currentStatus && preferredPlaybackKind(currentStatus, nextPreference) === "original" ? "original" : nextPreference;
      const resolved = await resolvePlaybackSource(projectId, effective);
      setSource(resolved);
      setError(null);
    } catch (reason) {
      const message = playbackErrorMessage(reason);
      setError(message);
      onLog("PLAYBACK_ERROR", "error");
    }
  }, [onLog, projectId]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void)[] = [];
    void Promise.all([
      onProxyProgress((progress) => {
        if (progress.projectId !== projectId) return;
        setStatus((current) => ({ ...current, state: progress.status, progress: progress.progress, processedUs: progress.processedUs }));
        const bucket = Math.floor(progress.progress / 25);
        if (bucket > progressBucket.current && progress.status === "generating") {
          progressBucket.current = bucket;
          onLog("PROXY_PROGRESS");
        }
      }),
      onProxyDiagnostic((diagnostic) => {
        if (diagnostic.projectId === projectId) onLog(diagnostic.event, diagnostic.event.includes("FAILED") ? "error" : diagnostic.event.includes("FALLBACK") || diagnostic.event.includes("STALE") ? "warning" : "info");
      }),
    ]).then((unlisteners) => {
      if (disposed) unlisteners.forEach((unlisten) => unlisten());
      else cleanup = unlisteners;
    });
    void getProxyStatus(projectId).then((next) => {
      if (disposed) return;
      setStatus(next);
      if (next.state === "stale") onLog("PROXY_STALE", "warning");
      return resolveSource("auto", next);
    }).catch((reason) => {
      if (!disposed) setError(playbackErrorMessage(reason));
    });
    return () => { disposed = true; cleanup.forEach((unlisten) => unlisten()); };
  }, [onLog, projectId, resolveSource]);

  const startProxy = async () => {
    setError(null);
    setStatus((current) => ({ ...current, state: "preparing", progress: 0 }));
    progressBucket.current = -1;
    try {
      const next = await createProxy(projectId);
      setStatus(next);
      if (next.state === "available") {
        await resolveSource("proxy", next);
        onNotify("Proxy de trabajo disponible");
      }
    } catch (reason) {
      const message = playbackErrorMessage(reason);
      setStatus((current) => ({ ...current, message, state: "error" }));
      setError(message);
      onNotify(message, "error");
    }
  };

  const stopProxy = async () => {
    try { setStatus(await cancelProxy(projectId)); onNotify("Cancelación solicitada", "info"); }
    catch (reason) { onNotify(playbackErrorMessage(reason), "error"); }
  };

  const durationUs = bundle.source.durationUs ?? 0;
  const recommend = durationUs >= 30 * 60 * 1_000_000 || bundle.source.fileSizeBytes >= 1_000_000_000;
  const isGenerating = status.state === "preparing" || status.state === "generating";
  const proxyAvailable = status.state === "available";
  const proxy = status.metadata?.proxy;

  return (
    <div className="space-y-5">
      <Card className="surface-shine p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Preview multimedia</p><h3 className="mt-1 text-lg font-bold text-ink">Reproductor del proyecto</h3></div>
          <span className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[10px] font-bold tracking-[0.15em] text-ink">{source?.kind.toUpperCase() ?? "CARGANDO"}</span>
        </div>
        {source ? <VideoPlayer durationUs={source.durationUs} key={source.path} kind={source.kind} onError={(message) => { setError(message); onLog("PLAYBACK_ERROR", "error"); }} path={source.path} seekToUs={requestedSeekUs} /> : <div className="grid aspect-video place-items-center rounded-xl border border-line bg-black"><LoaderCircle className="animate-spin text-cyan" size={26} /></div>}
        {error ? <p className="mt-3 flex items-start gap-2 text-sm text-danger"><AlertTriangle className="mt-0.5 shrink-0" size={16} />{error}</p> : null}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><Film size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Proxy de trabajo</p><h3 className="mt-1 font-bold text-ink">{proxyStateLabel(status.state)}</h3></div></div>
          <div className="flex flex-wrap gap-2">
            {!isGenerating && !proxyAvailable ? <Button onClick={() => void startProxy()}>{status.state === "stale" || status.state === "error" ? "Regenerar" : "Crear proxy"}</Button> : null}
            {isGenerating ? <Button onClick={() => void stopProxy()} variant="secondary">Cancelar</Button> : null}
            {source?.kind === "proxy" ? <Button onClick={() => void resolveSource("original")} variant="secondary">Usar original</Button> : null}
            {proxyAvailable && source?.kind !== "proxy" ? <Button onClick={() => void resolveSource("proxy", status)} variant="secondary">Usar proxy</Button> : null}
          </div>
        </div>
        {isGenerating ? <div className="mt-5"><div className="mb-2 flex justify-between text-xs font-semibold text-muted"><span>{status.state === "preparing" ? "Preparando" : "Generando"}</span><span>{status.progress === null ? "—" : `${Math.floor(status.progress)} %`}</span></div><div className="h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-cyan transition-[width]" style={{ width: `${status.progress ?? 0}%` }} /></div></div> : null}
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ProxyDetail icon={<CheckCircle2 size={15} />} label="Estado" value={proxyStateLabel(status.state)} />
          <ProxyDetail icon={<Gauge size={15} />} label="Resolución" value={proxy ? `${proxy.width} × ${proxy.height}` : "—"} />
          <ProxyDetail icon={<Cpu size={15} />} label="Encoder" value={proxy?.encoder ?? "—"} />
          <ProxyDetail icon={<Film size={15} />} label="Tamaño" value={proxy ? formatFileSize(proxy.fileSizeBytes) : "—"} />
        </div>
        <p className="mt-5 text-xs text-muted">{recommend ? "Crear un proxy de trabajo puede mejorar la fluidez de edición." : "El archivo original puede reproducirse directamente."} El original siempre permanece como fuente maestra.</p>
      </Card>

      <TranscriptionWorkspace bundle={bundle} onLog={onLog} onNotify={onNotify} onSeek={(timeUs) => setRequestedSeekUs(timeUs)} />
      <SmartCutWorkspace bundle={bundle} onLog={onLog} onNotify={onNotify} onSeek={(timeUs) => setRequestedSeekUs(timeUs)} />
    </div>
  );
}

function proxyStateLabel(state: ProxyStatus["state"]): string {
  return { available: "Disponible", cancelled: "Cancelado", error: "Error", generating: "Generando", not_created: "No creado", preparing: "Preparando", stale: "Desactualizado" }[state];
}

function ProxyDetail({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-lg border border-line bg-canvas/55 p-3"><div className="flex items-center gap-2 text-muted">{icon}<p className="text-[10px] font-bold uppercase tracking-[0.12em]">{label}</p></div><p className="mt-2 truncate text-sm font-semibold text-ink">{value}</p></div>;
}
