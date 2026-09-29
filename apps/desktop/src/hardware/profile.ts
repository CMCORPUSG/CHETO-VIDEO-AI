import { invoke } from "@tauri-apps/api/core";

export interface HardwareProfile {
  osName: string;
  osVersion: string;
  architecture: string;
  cpu: string;
  physicalCores: number;
  logicalCores: number;
  ramTotalBytes: number;
  ramAvailableBytes: number;
  gpuAdapters: { name: string; vendor: string; dedicatedVideoMemoryBytes: number }[];
  diskFreeBytes: number;
  diskMount: string;
  projectsPath: string;
  tempPath: string;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  nvencAvailable: boolean;
}

export const detectHardwareProfile = () => invoke<HardwareProfile>("detect_hardware_profile");
export const exportDiskSpace = (path: string) => invoke<[number, string]>("export_disk_space", { path });
