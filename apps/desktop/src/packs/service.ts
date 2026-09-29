import { invoke } from "@tauri-apps/api/core";
import type { TemplateManifest } from "../templates/registry";

export interface PackTemplateRef { path: string; templateId: string; templateVersion: string }
export interface PackManifest {
  schemaVersion: number; packId: string; packVersion: string; name: string; description: string; author: string;
  createdAt: string; minimumChetoVersion: string; maximumChetoVersion?: string | null;
  templates: PackTemplateRef[]; assetRefs: string[]; fontRefs: string[]; previewRefs: string[];
  tags: string[]; categories: string[]; licenseSummary: string; checksumAlgorithm: string; provenance: string; requiresBuiltins: string[];
}
export interface PackLicense { resourceId: string; resourceType: string; name: string; licenseId: string; licenseTextRef?: string | null; source: string; author: string; copyright: string; redistributionAllowed: boolean; modified: boolean; notes: string }
export interface PackInspection { manifest: PackManifest; templates: TemplateManifest[]; licenses: PackLicense[]; sizeBytes: number; archiveSha256: string; status: "compatible" | "already_installed" | "update" | "older"; warnings: string[] }
export interface InstalledPack { packId: string; packVersion: string; name: string; author: string; installedAt: string; source: string; installPath: string; templates: PackTemplateRef[]; archiveSha256: string; sizeBytes: number }
export interface ExportPackRequest { packId: string; packVersion: string; name: string; description: string; author: string; outputPath: string; templates: TemplateManifest[]; resources?: { path: string; sourcePath: string; license: PackLicense }[] }
export interface ResolvedPackResource { resourceId: string; kind: "font" | "asset" | "preview"; path: string; sha256: string; licenseId: string; licenseSource: string; licenseAuthor: string; licenseName: string; licenseTextRef?: string | null; licenseTextPath?: string | null; resourceType: string }

export const validPackId = (value: string) => /^[a-z][a-z0-9.-]{5,119}$/.test(value) && !value.includes("..");
export const validPackVersion = (value: string) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
export const packResourceId = (packId: string, version: string, path: string) => `pack:${packId}@${version}:${path}`;
export function packageTemplate(manifest: TemplateManifest, packId: string, packVersion = manifest.templateVersion): TemplateManifest {
  if (!validPackId(packId)) throw new Error("ID de paquete inválido");
  const slug = manifest.templateId.split(".").at(-1);
  const rewrite = (id: string) => id.startsWith("pack:") ? `pack:${packId}@${packVersion}:${id.split(":").slice(2).join(":")}` : id;
  const packed = { ...structuredClone(manifest), templateId: `cheto.pack.${packId}.${slug}` };
  packed.fontRefs = packed.fontRefs.map(rewrite);
  packed.assetRefs = packed.assetRefs.map(rewrite);
  if (packed.graphicLayer) packed.graphicLayer = { ...packed.graphicLayer, assetId: rewrite(packed.graphicLayer.assetId) };
  return packed;
}

export const inspectChetoPack = (path: string) => invoke<PackInspection>("inspect_chetopack", { path });
export const installChetoPack = (path: string) => invoke<InstalledPack>("install_chetopack", { path });
export const listChetoPacks = () => invoke<InstalledPack[]>("list_chetopacks");
export const verifyChetoPack = (packId: string, packVersion: string) => invoke<void>("verify_chetopack", { packId, packVersion });
export const loadInstalledTemplates = () => invoke<TemplateManifest[]>("load_installed_templates");
export const resolveChetoPackResource = (resourceId: string) => invoke<ResolvedPackResource>("resolve_chetopack_resource", { resourceId });
export const uninstallChetoPack = (packId: string, packVersion: string) => invoke<void>("uninstall_chetopack", { packId, packVersion });
export const exportChetoPack = (request: ExportPackRequest) => invoke<string>("export_chetopack", { request });
