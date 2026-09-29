import { invoke, isTauri } from "@tauri-apps/api/core";
import { playbackAssetUrl } from "../playback/service";
import type { AssetProbe, LibraryAsset } from "./library";

export function canUseAssetLibrary() { return isTauri(); }
export function enumerateLibraryFolder(folder: string) { return invoke<string[]>("enumerate_library_folder", { folder }); }
export function probeLibraryAsset(path: string) { return invoke<AssetProbe>("probe_library_asset", { path }); }
export function listBuiltinAssets() { return invoke<LibraryAsset[]>("list_builtin_assets"); }
export async function libraryAssetPreview(path: string) {
  return playbackAssetUrl(await invoke<string>("library_asset_preview", { path }));
}
