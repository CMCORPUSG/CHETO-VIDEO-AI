import {
  ArrowRight,
  Film,
  Play,
  Plus,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import { Button } from "./Button";

interface HeroCardProps {
  onNewProject: () => void;
}

export function HeroCard({
  onNewProject,
}: HeroCardProps) {
  return (
    <section className="relative grid min-h-[310px] overflow-hidden rounded-2xl border border-white/[0.07] bg-[#090f18] lg:grid-cols-[1.05fr_.95fr]">
      <div className="relative z-10 flex flex-col justify-center px-8 py-10 lg:px-10 xl:px-12">
        <div className="flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.16em] text-muted/45">
          <WandSparkles
            aria-hidden="true"
            className="text-cyan/80"
            size={13}
          />

          Workspace creativo local
        </div>

        <h2 className="mt-5 max-w-2xl text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink xl:text-[36px]">
          Edita con precisión.
          <span className="block text-muted/55">
            Mantén el control.
          </span>
        </h2>

        <p className="mt-5 max-w-xl text-[12px] leading-6 text-muted/65">
          Organiza tus videos, analiza cortes y encuadres,
          revisa cada decisión y exporta únicamente cuando
          el resultado esté listo.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button
            icon={<Plus aria-hidden="true" size={15} />}
            onClick={onNewProject}
          >
            Nuevo proyecto
          </Button>

          <div className="flex items-center gap-2 px-2 text-[10px] text-muted/55">
            <ShieldCheck
              aria-hidden="true"
              className="text-success"
              size={13}
            />

            Procesamiento local
          </div>
        </div>
      </div>

      <div className="relative hidden items-center justify-center overflow-hidden border-l border-white/[0.05] bg-[#070c13] p-8 lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(0,200,239,.07),transparent_48%)]" />

        <div className="relative w-full max-w-[430px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c131e] shadow-[0_30px_70px_rgba(0,0,0,.36)]">
          <div className="flex h-9 items-center justify-between border-b border-white/[0.06] px-3">
            <div className="flex items-center gap-2">
              <Film
                aria-hidden="true"
                className="text-muted/60"
                size={13}
              />

              <span className="text-[9px] font-medium text-muted/60">
                Preview
              </span>
            </div>

            <span className="flex items-center gap-1.5 text-[8px] text-success/80">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Local
            </span>
          </div>

          <div className="relative aspect-video bg-[#020407]">
            <div className="absolute inset-[11%] overflow-hidden rounded-md border border-white/[0.06] bg-[linear-gradient(145deg,#172435,#08101a)]">
              <div className="absolute left-[18%] top-[17%] h-[55%] w-[55%] border border-cyan/35" />

              <div className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[#07111f]">
                <Play
                  aria-hidden="true"
                  className="ml-0.5"
                  fill="currentColor"
                  size={14}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.06] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-medium text-muted/55">
                Timeline
              </span>

              <ArrowRight
                aria-hidden="true"
                className="text-muted/40"
                size={13}
              />
            </div>

            <div className="mt-3 space-y-2">
              <div className="h-2.5 overflow-hidden rounded-sm bg-white/[0.035]">
                <div className="h-full w-[72%] bg-[#314866]" />
              </div>

              <div className="flex gap-1">
                <span className="h-2.5 w-[28%] rounded-sm bg-[#63353e]" />
                <span className="h-2.5 w-[18%] rounded-sm bg-[#164b58]" />
                <span className="h-2.5 w-[30%] rounded-sm bg-[#164b58]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
