export interface LocalProfile {
  avatar: string | null;
  name: string;
  username?: string;
  studio?: string;
  theme?: "dark" | "light" | "system";
  locale?: string;
  timezone?: string;
  dateFormat?: "dmy" | "mdy" | "iso";
  timeFormat?: "12" | "24";
  defaultExportFolder?: string;
}
