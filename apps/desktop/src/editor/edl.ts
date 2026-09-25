import type { CameraDecision, CutDecision, EdlManifest } from "../project/contracts";

export interface PreviewRange { endUs: number; startUs: number }
export interface DraftTracks { camera: CameraDecision[]; cuts: CutDecision[] }

export function consolidateCuts(cuts: CutDecision[], durationUs: number): Array<{ startUs: number; endUs: number }> {
  const sorted = cuts.map(({ startUs, endUs }) => ({ startUs: Math.max(0, Math.min(durationUs, startUs)), endUs: Math.max(0, Math.min(durationUs, endUs)) })).filter((item) => item.endUs > item.startUs).sort((a,b)=>a.startUs-b.startUs||a.endUs-b.endUs);
  const result:Array<{startUs:number;endUs:number}>=[];
  for(const item of sorted){const last=result.at(-1);if(last&&item.startUs<=last.endUs)last.endUs=Math.max(last.endUs,item.endUs);else result.push({...item});}
  return result;
}
export function removedDurationUs(cuts:CutDecision[],durationUs:number):number{return consolidateCuts(cuts,durationUs).reduce((sum,item)=>sum+item.endUs-item.startUs,0);}
export function editedDurationUs(durationUs:number,cuts:CutDecision[]):number{return Math.max(0,durationUs-removedDurationUs(cuts,durationUs));}
export function cutAt(cuts:CutDecision[],sourceUs:number,durationUs:number):{startUs:number;endUs:number}|null{return consolidateCuts(cuts,durationUs).find(item=>sourceUs>=item.startUs&&sourceUs<item.endUs)??null;}
export function sourceToEditedUs(sourceUs:number,cuts:CutDecision[],durationUs:number):number|null{const source=Math.max(0,Math.min(durationUs,sourceUs));const merged=consolidateCuts(cuts,durationUs);if(merged.some(c=>source>=c.startUs&&source<c.endUs))return null;let removed=0;for(const cut of merged){if(cut.endUs<=source)removed+=cut.endUs-cut.startUs;}return source-removed;}
export function editedToSourceUs(editedUs:number,cuts:CutDecision[],durationUs:number):number{const target=Math.max(0,Math.min(editedDurationUs(durationUs,cuts),editedUs));let source=target;for(const cut of consolidateCuts(cuts,durationUs)){if(source<cut.startUs)break;source+=cut.endUs-cut.startUs;}return Math.min(durationUs,source);}
export function activeCameraAt(camera:CameraDecision[],sourceUs:number):CameraDecision|null{return [...camera].reverse().find(item=>sourceUs>=item.startUs&&sourceUs<item.endUs)??null;}
export function previewRange(startUs:number,seconds:10|30,durationUs:number):PreviewRange{return{startUs:Math.max(0,Math.min(durationUs,startUs)),endUs:Math.max(0,Math.min(durationUs,startUs+seconds*1_000_000))};}
export function selectionRange(inUs:number|null,outUs:number|null,durationUs:number):PreviewRange|null{if(inUs===null||outUs===null)return null;const start=Math.max(0,Math.min(inUs,outUs,durationUs));const end=Math.max(0,Math.min(Math.max(inUs,outUs),durationUs));return end>start?{startUs:start,endUs:end}:null;}
export function effectiveTracks(edl:EdlManifest,draft:DraftTracks|null,range:PreviewRange|null):DraftTracks{if(!draft||!range)return{cuts:edl.tracks.cuts,camera:edl.tracks.camera};const inside=<T extends{startUs:number;endUs:number}>(item:T)=>item.startUs<range.endUs&&range.startUs<item.endUs;return{cuts:[...edl.tracks.cuts,...draft.cuts.filter(inside)],camera:[...edl.tracks.camera,...draft.camera.filter(inside)]};}
