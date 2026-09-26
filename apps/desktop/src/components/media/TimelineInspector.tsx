import { useState } from "react";
import type { CameraDecision, CutDecision } from "../../project/contracts";
import { formatTimecode, parseTimecode } from "../../editor/timecode";
import { editCamera, resizeRange } from "../../editor/timeline";
import { Button } from "../Button";
import { Card } from "../Card";

interface TimelineInspectorProps {
  camera: CameraDecision[];
  cut: CutDecision | null;
  durationUs: number;
  item: CameraDecision | null;
  onApplyCamera: (item: CameraDecision) => void;
  onApplyCut: (item: CutDecision) => void;
  onDelete: () => void;
  onReplaceCamera: (item: CameraDecision, conflictIds: string[]) => void;
}

export function TimelineInspector({
  camera,
  cut,
  durationUs,
  item,
  onApplyCamera,
  onApplyCut,
  onDelete,
  onReplaceCamera,
}: TimelineInspectorProps) {
  const selected = item ?? cut;
  const [start, setStart] = useState(() =>
    selected ? formatTimecode(selected.startUs) : "",
  );
  const [end, setEnd] = useState(() =>
    selected ? formatTimecode(selected.endUs) : "",
  );
  const [zoom, setZoom] = useState(item?.zoom ?? 1);
  const [centerX, setCenterX] = useState((item?.centerX ?? 0.5) * 100);
  const [centerY, setCenterY] = useState((item?.centerY ?? 0.5) * 100);
  const [mode, setMode] = useState(item?.mode ?? "zoom");
  const [easing, setEasing] = useState(item?.easing ?? "ease_in_out");
  const [transitionMs, setTransitionMs] = useState(
    (item?.transitionUs ?? 500_000) / 1000,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!selected) return null;
  const editedCamera = (startUs: number, endUs: number) => item ? editCamera(item, { startUs, endUs, mode, zoom, centerX: centerX / 100, centerY: centerY / 100, easing, transitionUs: Math.max(0, Math.round(transitionMs * 1000)) }) : null;
  const apply = () => {
    const startUs = parseTimecode(start);
    const endUs = parseTimecode(end);
    if (
      startUs === null ||
      endUs === null ||
      startUs < 0 ||
      endUs > durationUs ||
      startUs >= endUs
    ) {
      setError("El rango debe cumplir 0 ≤ inicio < final ≤ duración.");
      return;
    }
    if (item) {
      const conflicts = camera.filter(
        (value) =>
          value.id !== item.id &&
          value.startUs < endUs &&
          value.endUs > startUs,
      );
      const edited = editedCamera(startUs, endUs)!;

      if (conflicts.length > 0) {
        onReplaceCamera(
          edited,
          conflicts.map((value) => value.id),
        );
        setNotice(
          `Se resolvieron automáticamente ${conflicts.length} encuadre(s) solapado(s).`,
        );
      } else {
        onApplyCamera(edited);
        setNotice("Encuadre actualizado.");
      }
    } else if (cut) {
      onApplyCut({
        ...cut,
        ...resizeRange(startUs, endUs, "end", endUs, durationUs),
      });
    }
    setError(null);
  };
  return (
    <Card className="timeline-inspector mb-2 p-2">
      <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
        <div>
          <p className="text-[8px] font-bold uppercase text-cyan">
            Selección de timeline
          </p>
          <h3 className="text-[11px] font-bold text-ink">
            {item ? cameraLabel(mode) : "Corte manual"}
          </h3>
        </div>
        <Button onClick={onDelete} variant="danger">
          Eliminar
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <TimeField label="Inicio" onChange={setStart} value={start} />
        <TimeField label="Final" onChange={setEnd} value={end} />
        <ReadOnly
          label="Duración"
          value={formatTimecode(
            (parseTimecode(end) ?? selected.endUs) -
              (parseTimecode(start) ?? selected.startUs),
          )}
        />
        {item ? (
          <>
            <Field label="Tipo">
              <select onChange={(e) => setMode(e.target.value)} value={mode}>
                <option value="zoom">Zoom</option>
                <option value="focus">Enfoque</option>
                <option value="reset">Restablecer</option>
              </select>
            </Field>
            <NumberField
              label="Zoom"
              max={3}
              min={1}
              onChange={setZoom}
              step={0.01}
              suffix="×"
              value={zoom}
            />
            <NumberField
              label="Centro X"
              max={100}
              min={0}
              onChange={setCenterX}
              step={1}
              suffix="%"
              value={centerX}
            />
            <NumberField
              label="Centro Y"
              max={100}
              min={0}
              onChange={setCenterY}
              step={1}
              suffix="%"
              value={centerY}
            />
            <NumberField
              label="Transición"
              max={10000}
              min={0}
              onChange={setTransitionMs}
              step={10}
              suffix="ms"
              value={transitionMs}
            />
            <Field label="Easing">
              <select
                onChange={(e) => setEasing(e.target.value)}
                value={easing}
              >
                <option value="linear">Lineal</option>
                <option value="ease_in">Entrada suave</option>
                <option value="ease_out">Salida suave</option>
                <option value="ease_in_out">Suave</option>
              </select>
            </Field>
          </>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-[9px] text-danger">{error}</p> : null}
      {notice ? <p className="mt-2 text-[9px] leading-4 text-warning/80">{notice}</p> : null}
      <div className="mt-2 flex justify-end">
        <Button className="timeline-inspector-apply" onClick={apply}>
          Guardar cambios
        </Button>
      </div>
    </Card>
  );
}
function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="min-w-0 text-[8px] font-bold uppercase text-muted">
      {label}
      {children}
    </label>
  );
}
function TimeField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Field label={label}>
      <input
        className="mt-1 w-full border border-line bg-canvas px-1.5 py-1 font-mono text-ink"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </Field>
  );
}
function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <output className="mt-1 block w-full border border-line bg-canvas/50 px-1.5 py-1 font-mono normal-case text-ink">
        {value}
      </output>
    </Field>
  );
}
function NumberField({
  label,
  max,
  min,
  onChange,
  step,
  suffix,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix: string;
  value: number;
}) {
  return (
    <Field label={label}>
      <span className="mt-1 flex border border-line bg-canvas">
        <input
          className="w-full bg-transparent px-1.5 py-1 text-ink"
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={step}
          type="number"
          value={Number.isFinite(value) ? value : 0}
        />
        <i className="px-1 py-1 font-normal normal-case">{suffix}</i>
      </span>
    </Field>
  );
}
function cameraLabel(mode: string) {
  return mode === "reset"
    ? "Restablecer"
    : mode === "focus"
      ? "Enfoque"
      : "Zoom";
}
