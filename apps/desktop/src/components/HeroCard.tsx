import { ArrowUpRight, Film, Play, Plus, ScanLine, WandSparkles } from "lucide-react";
import { Button } from "./Button";

interface HeroCardProps {
  onNewProject: () => void;
}

const waveform = [30, 54, 38, 78, 48, 88, 44, 68, 32, 76, 46, 86, 56, 72, 40, 62, 34, 52];

export function HeroCard({ onNewProject }: HeroCardProps) {
  return (
    <section className="hero-grid surface-shine relative grid min-h-[390px] overflow-hidden rounded-xl border border-line-bright/70 shadow-card lg:grid-cols-[1.06fr_0.94fr]">
      <div className="relative z-10 flex flex-col justify-center px-7 py-10 lg:px-10 xl:px-12">
        <div className="mb-6 flex items-center gap-3">
          <span className="h-px w-9 bg-cyan" />
          <p className="text-xs font-bold uppercase tracking-[0.23em] text-cyan">CHETO VIDEO AI</p>
        </div>
        <h2 className="max-w-2xl text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-ink sm:text-5xl">
          Convierte material largo en una edición con intención.
        </h2>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted">
          Tu espacio local para organizar, revisar y preparar decisiones de edición inteligentes, con control antes de cada render.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button className="min-h-12 px-5" icon={<Plus aria-hidden="true" size={18} />} onClick={onNewProject}>
            Nuevo proyecto
          </Button>
          <div className="flex items-center gap-2 text-xs font-medium text-muted">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-line-bright bg-card text-success">
              <Film aria-hidden="true" size={13} />
            </span>
            Flujo 100% local
          </div>
        </div>
      </div>

      <div className="relative hidden min-h-[390px] items-center justify-center overflow-hidden lg:flex">
        <div className="absolute h-72 w-72 rounded-full bg-primary/20 blur-[70px]" />
        <div className="absolute right-9 top-9 flex items-center gap-2 rounded-full border border-white/10 bg-canvas/45 px-3 py-1.5 text-[11px] font-semibold text-muted backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_12px_var(--color-secondary)]" />
          Preview de edición
        </div>

        <div className="relative w-[82%] max-w-md -rotate-1 rounded-xl border border-line-bright bg-canvas/70 p-3 shadow-modal backdrop-blur-sm">
          <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-[linear-gradient(145deg,#172d4b,#0b1628)]">
            <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(0,213,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(0,213,255,.12)_1px,transparent_1px)] [background-size:28px_28px]" />
            <div className="absolute inset-x-[16%] inset-y-[17%] rounded-md border border-cyan/70 shadow-[0_0_24px_rgba(0,213,255,.16)]">
              <span className="absolute -left-1 -top-1 h-2 w-2 bg-cyan" />
              <span className="absolute -right-1 -top-1 h-2 w-2 bg-cyan" />
              <span className="absolute -bottom-1 -left-1 h-2 w-2 bg-cyan" />
              <span className="absolute -bottom-1 -right-1 h-2 w-2 bg-cyan" />
            </div>
            <div className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-primary/90 text-white shadow-glow">
              <Play aria-hidden="true" className="ml-0.5" fill="currentColor" size={17} />
            </div>
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md border border-white/10 bg-canvas/70 px-2.5 py-1.5 font-mono text-[10px] text-cyan">
              <ScanLine aria-hidden="true" size={12} />
              00:18:42
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-line bg-surface/90 p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-ink">
                <WandSparkles aria-hidden="true" className="text-violet" size={14} />
                Plan de edición
              </div>
              <ArrowUpRight aria-hidden="true" className="text-muted" size={14} />
            </div>
            <div className="flex h-9 items-center gap-1">
              {waveform.map((height, index) => (
                <span
                  className={index > 10 ? "flex-1 rounded-full bg-violet/65" : "flex-1 rounded-full bg-cyan/70"}
                  key={`${height}-${index}`}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
            <div className="mt-2 flex gap-1">
              <span className="h-1.5 w-[28%] rounded-full bg-primary" />
              <span className="h-1.5 w-[18%] rounded-full bg-cyan" />
              <span className="h-1.5 flex-1 rounded-full bg-violet/70" />
              <span className="h-1.5 w-[12%] rounded-full bg-accent/80" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
