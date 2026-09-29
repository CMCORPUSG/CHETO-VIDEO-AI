import type { CSSProperties, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import type { TitleDecision } from "../../project/contracts";
import { titleFrame, titlePositionForAspect } from "../../visual/titles";
import { resolveTemplateInstance } from "../../templates/engine";
import { layerForParameter, layerText, resolveLayerLayout, applyTextCase } from "../../templates/layers";

export function TitlePreview({ title: inputTitle, timeUs, aspectRatio = 16/9, interactive = false, onLayerPointerDown, onLayerDoubleClick }: { title: TitleDecision | null; timeUs: number; aspectRatio?: number; interactive?: boolean; onLayerPointerDown?: (layerId: string, event: ReactPointerEvent<HTMLDivElement>) => void; onLayerDoubleClick?: (layerId: string, event: ReactMouseEvent<HTMLDivElement>) => void }) {
  if (!inputTitle) return null;
  const primaryId = layerForParameter(inputTitle, "text")?.layerId ?? "headline";
  const secondaryId = layerForParameter(inputTitle, "secondaryText")?.layerId;
  const mainOverride = inputTitle.layerOverrides?.[primaryId];
  const secondaryOverride = secondaryId ? inputTitle.layerOverrides?.[secondaryId] : undefined;
  const title = { ...inputTitle, text: applyTextCase(layerText(inputTitle, primaryId), mainOverride?.case), secondaryText: secondaryId ? applyTextCase(layerText(inputTitle, secondaryId), secondaryOverride?.case) : inputTitle.secondaryText };
  const resolved = title.templateId ? resolveTemplateInstance(title, aspectRatio, timeUs) : null;
  if (title.templateId && !resolved) return <div aria-label="Template no disponible" className="template-unavailable" role="alert">Template no disponible · {title.templateId}@{title.templateVersion}</div>;
  const frame = titleFrame(title, timeUs);
  if (!frame) return null;
  const position = resolved ? { x: resolved.layout.x, y: resolved.layout.y } : titlePositionForAspect(title, aspectRatio);
  const mainLayout = resolveLayerLayout(inputTitle, primaryId, aspectRatio);
  const secondaryLayout = secondaryId ? resolveLayerLayout(inputTitle, secondaryId, aspectRatio) : null;
  const fontScale = resolved?.layout.fontScale ?? 1;
  const glowIntensity = Number(resolved?.parameters.glowIntensity ?? 0.5);
  const base: CSSProperties = {
    position: "absolute", left: `${mainLayout.x * 100}%`, top: `${mainLayout.y * 100}%`,
    transform: `translate(${title.anchor === "center" ? "-50%" : title.anchor === "right" ? "-100%" : "0"}, -50%) translate(${frame.translateX / 10.8}cqh, ${frame.translateY / 10.8}cqh) rotate(${mainLayout.rotation}deg) scale(${frame.scale * title.scale * mainLayout.scale})`,
    opacity: frame.opacity * (mainOverride?.opacity ?? 1), color: mainOverride?.fill ?? title.color, textAlign: mainOverride?.alignment ?? resolved?.layout.alignment ?? title.alignment,
    fontFamily: (mainOverride?.font ?? title.font) === "Instrument Serif" ? "Instrument Serif, Georgia, serif" : "Inter, sans-serif", fontStyle: mainOverride?.italic ? "italic" : title.font === "Instrument Serif" ? "italic" : "normal", fontWeight: mainOverride?.fontWeight ?? (title.font === "Instrument Serif" ? 400 : title.fontWeight),
    fontSize: `${(mainOverride?.fontSize ?? title.fontSize) * fontScale / 10.8}cqh`,
    lineHeight: mainOverride?.lineHeight ?? title.lineHeight, letterSpacing: mainOverride?.letterSpacing ? `${mainOverride.letterSpacing / 10.8}cqh` : undefined, textDecoration: mainOverride?.underline ? "underline" : undefined,
    WebkitTextStroke: mainOverride?.strokeWidth ? `${mainOverride.strokeWidth / 10.8}cqh ${mainOverride.strokeColor ?? "#000000"}` : undefined,
    width: "max-content", maxWidth: `${mainLayout.maxWidth * 100}cqw`, whiteSpace: "normal", overflowWrap: "normal", wordBreak: "normal",
    textShadow: mainOverride?.glowIntensity ? `0 0 ${mainOverride.glowIntensity * 2}cqh ${mainOverride.glowColor ?? title.accentColor}` : mainOverride?.shadowBlur ? `${mainOverride.shadowOffsetX ?? 0}px ${mainOverride.shadowOffsetY ?? 0}px ${mainOverride.shadowBlur}px ${mainOverride.shadowColor ?? "#000000"}` : "0 2px 12px #0009", pointerEvents: interactive ? "auto" : "none", cursor: interactive ? "move" : undefined,
  };
  const secondaryStyle: CSSProperties = { color: secondaryOverride?.fill ?? title.accentColor, fontSize: secondaryOverride?.fontSize ? `${secondaryOverride.fontSize / (mainOverride?.fontSize ?? title.fontSize)}em` : ".42em", opacity: frame.secondaryOpacity * (secondaryOverride?.opacity ?? 1), fontFamily: secondaryOverride?.font === "Instrument Serif" ? "Instrument Serif, Georgia, serif" : undefined, fontWeight: secondaryOverride?.fontWeight, fontStyle: secondaryOverride?.italic ? "italic" : undefined, textDecoration: secondaryOverride?.underline ? "underline" : undefined, letterSpacing: secondaryOverride?.letterSpacing ? `${secondaryOverride.letterSpacing / 10.8}cqh` : undefined, lineHeight: secondaryOverride?.lineHeight, textAlign: secondaryOverride?.alignment, WebkitTextStroke: secondaryOverride?.strokeWidth ? `${secondaryOverride.strokeWidth / 10.8}cqh ${secondaryOverride.strokeColor ?? "#000000"}` : undefined, textShadow: secondaryOverride?.glowIntensity ? `0 0 ${secondaryOverride.glowIntensity * 2}cqh ${secondaryOverride.glowColor ?? title.accentColor}` : secondaryOverride?.shadowBlur ? `${secondaryOverride.shadowOffsetX ?? 0}px ${secondaryOverride.shadowOffsetY ?? 0}px ${secondaryOverride.shadowBlur}px ${secondaryOverride.shadowColor ?? "#000000"}` : undefined, transform: secondaryLayout ? `translate(${(secondaryLayout.x - position.x) * 100}cqw, ${(secondaryLayout.y - position.y) * 100}cqh) rotate(${secondaryLayout.rotation}deg) scale(${secondaryLayout.scale})` : undefined, display: "inline-block" };
  const secondary = <span data-title-layer-id={secondaryId} style={secondaryStyle}>{title.secondaryText}</span>;
  const accent = { backgroundColor: title.accentColor };
  const line = <span style={{ ...accent, display: "block", width: `${frame.lineProgress * 100}%`, height: "0.07em", marginTop: "0.12em" }} />;
  let content;
  switch (title.presetId) {
    case "whisper-fade": content = <span style={{ fontWeight: 400, letterSpacing: ".18em", textTransform: "uppercase" }}>{title.text}</span>; break;
    case "rise-settle": content = <strong style={{ fontWeight: 800, letterSpacing: "-.04em" }}>{title.text}</strong>; break;
    case "stack-reveal": content = <span style={{ display: "grid", gap: 4, textAlign: "left" }}><span style={{ ...accent, color: "#08131c", padding: "0.04em 0.22em", clipPath: `inset(0 ${100 - frame.maskProgress * 100}% 0 0)` }}>{title.text}</span><span style={{ background: "#101827e8", padding: "0.08em 0.35em" }}>{secondary}</span></span>; break;
    case "mask-wipe-up": content = <span style={{ display: "block", overflow: "hidden", clipPath: `inset(${100 - frame.maskProgress * 100}% 0 0 0)` }}>{title.text}</span>; break;
    case "split-line": content = <span style={{ display: "grid", gap: 4 }}><span>{title.text}</span>{line}{secondary}</span>; break;
    case "underline-sweep": content = <span style={{ display: "grid" }}><span>{title.text}</span>{line}</span>; break;
    case "lower-third": content = <span style={{ display: "flex", alignItems: "stretch", background: "#0b1423e8", padding: "0.18em 0.32em 0.18em 0", textAlign: "left" }}><span style={{ ...accent, width: "0.07em", marginRight: "0.26em" }} /><span style={{ display: "grid" }}><strong>{title.text}</strong>{secondary}</span></span>; break;
    case "zoom-out-stat": content = <span style={{ display: "grid", textAlign: "center" }}><strong style={{ fontWeight: 900, fontSize: "1.35em", lineHeight: 1 }}>{title.text}</strong>{secondary}</span>; break;
    case "callout": content = <span style={{ display: "flex", gap: "0.3em", alignItems: "start", padding: "0.3em 0.4em", background: "#0c1725ed", border: `2px solid ${title.accentColor}`, borderRadius: "0.15em", textAlign: "left" }}><span style={{ ...accent, width: "0.18em", height: "0.18em", borderRadius: "50%", marginTop: "0.32em" }} /><span style={{ display: "grid" }}><strong>{title.text}</strong>{secondary}</span></span>; break;
    case "editorial-master": content = <span style={{display:"grid",gap:6,textAlign:"left"}}><em style={{fontFamily:"Instrument Serif, Georgia, serif",fontSize:".5em",color:title.accentColor}}>{secondary}</em><strong style={{letterSpacing:"-.04em"}}>{title.text}</strong></span>; break;
    case "future-glow": content = <span style={{display:"grid",textAlign:"center",textShadow:`0 0 ${Math.round(6 + glowIntensity * 12)}px ${title.accentColor},0 0 ${Math.round(15 + glowIntensity * 30)}px ${title.accentColor}`}}><small style={{fontSize:".28em",letterSpacing:".25em",color:title.accentColor}}>{secondary}</small><strong>{title.text}</strong></span>; break;
    case "content-create": content = <span style={{display:"grid",textAlign:"left"}}><strong style={{fontSize:".56em",color:title.accentColor}}>{secondary}</strong><strong>{title.text}</strong></span>; break;
    case "neon-statement": content = <strong style={{WebkitTextStroke:`1px ${title.accentColor}`,textShadow:`0 0 12px ${title.accentColor}`,letterSpacing:"-.05em"}}>{title.text}</strong>; break;
    case "kinetic-pop": content = <strong style={{display:"inline-block",padding:".06em .18em",backgroundColor:title.accentColor,color:"#12212d",transform:"rotate(-3deg)",boxShadow:".12em .12em 0 #f35b82"}}>{title.text}</strong>; break;
    case "letter-cascade-pro": content = <span style={{display:"inline-flex",letterSpacing:".07em"}}>{[...title.text].map((character,index)=><span key={index} style={{display:"inline-block",opacity:index<frame.revealedCharacters?1:0,transform:index<frame.revealedCharacters?"translateY(0)":"translateY(.5em)"}}>{character===" "?"\u00a0":character}</span>)}</span>; break;
    case "dynamic-slide": content = <span style={{display:"grid",borderLeft:`.1em solid ${title.accentColor}`,paddingLeft:".2em",textAlign:"left"}}><strong style={{fontStyle:"italic"}}>{title.text}</strong>{secondary}</span>; break;
    case "typewriter-tech": content = <strong style={{fontFamily:"monospace",color:title.accentColor,fontSize:".75em"}}>&gt; {[...title.text].slice(0,frame.revealedCharacters).join("")}<span style={{opacity:Math.floor(timeUs/250_000)%2?1:0}}>▌</span></strong>; break;
    case "word-highlight": content = <span style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:".12em"}}>{title.text.split(/\s+/).map((word,index)=><strong key={index} style={{padding:"0 .08em",backgroundColor:index<Math.max(1,Math.ceil(title.text.split(/\s+/).length*frame.maskProgress))?title.accentColor:"transparent",color:index<Math.max(1,Math.ceil(title.text.split(/\s+/).length*frame.maskProgress))?"#12212d":title.color}}>{word}</strong>)}</span>; break;
    case "split-impact": content = <span style={{display:"grid",textAlign:"center"}}><strong style={{WebkitTextStroke:`1px ${title.accentColor}`,color:"transparent"}}>{secondary}</strong><strong style={{backgroundColor:title.accentColor,color:"#101924",padding:"0 .12em"}}>{title.text}</strong></span>; break;
    case "stacked-reveal-pro": content = <span style={{display:"grid",gap:4,textAlign:"left"}}><small style={{fontSize:".28em",color:title.accentColor,letterSpacing:".15em"}}>{secondary}</small><strong>{title.text}</strong></span>; break;
    case "underline-editorial": content = <span style={{display:"grid",textAlign:"left"}}><em style={{fontFamily:"Georgia,serif"}}>{title.text}</em>{line}{secondary}</span>; break;
    case "lower-third-premium": content = <span style={{display:"flex",alignItems:"stretch",background:"#0c1725d9",padding:".16em .32em .16em 0",textAlign:"left"}}><span style={{...accent,width:".07em",marginRight:".24em"}}/><span style={{display:"grid"}}><strong>{title.text}</strong>{secondary}</span></span>; break;
    case "stat-hero": content = <span style={{display:"grid",textAlign:"center"}}><strong style={{fontSize:"1.45em",lineHeight:1,fontWeight:900}}>{title.text}</strong><small style={{fontSize:".28em",color:title.accentColor,letterSpacing:".22em"}}>{secondary}</small></span>; break;
    case "tutorial-step": content = <span style={{display:"grid",gap:5,textAlign:"left"}}><small style={{width:"fit-content",padding:".12em .35em",backgroundColor:title.accentColor,color:"#10202a",fontSize:".3em"}}>{title.secondaryText||"PASO 01"}</small><strong style={{fontSize:".85em"}}>{title.text}</strong></span>; break;
    case "quote-editorial": content = <span style={{display:"grid",textAlign:"left",borderLeft:`.05em solid ${title.accentColor}`,paddingLeft:".25em"}}><em style={{fontFamily:"Georgia,serif"}}>“{title.text}”</em>{secondary}</span>; break;
    case "gaming-impact": content = <strong style={{fontWeight:900,fontStyle:"italic",textShadow:`.06em .06em 0 #a52e20,0 0 .3em ${title.accentColor}`,transform:"skewX(-6deg)"}}>{title.text}</strong>; break;
    case "corporate-clean": content = <span style={{display:"grid",textAlign:"left",color:"#f5ffff"}}><small style={{fontSize:".25em",color:title.accentColor,letterSpacing:".2em"}}>{secondary}</small><strong>{title.text}</strong>{line}</span>; break;
  }
  const targetLayer = (event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>) => (event.target as HTMLElement).closest<HTMLElement>("[data-title-layer-id]")?.dataset.titleLayerId ?? primaryId;
  return <div aria-label="Vista previa interactiva del título" data-title-layer-id={primaryId} onPointerDown={interactive ? event => onLayerPointerDown?.(targetLayer(event), event) : undefined} onDoubleClick={interactive ? event => onLayerDoubleClick?.(targetLayer(event), event) : undefined} style={base}>{content}</div>;
}
