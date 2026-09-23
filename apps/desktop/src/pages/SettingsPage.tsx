import { CloudOff, SlidersHorizontal } from "lucide-react";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";

export function SettingsPage() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-6">
        <div className="grid h-11 w-11 place-items-center rounded-md bg-primary/10 text-cyan">
          <SlidersHorizontal aria-hidden="true" size={20} />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-ink">Preferencias de edición</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Disponible en próximas fases.</p>
      </Card>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-md bg-card text-muted">
            <CloudOff aria-hidden="true" size={20} />
          </div>
          <StatusBadge label="Desactivada" tone="success" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-ink">API externa</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          No hay proveedores configurados, llamadas en segundo plano ni consumo externo.
        </p>
      </Card>
    </div>
  );
}
