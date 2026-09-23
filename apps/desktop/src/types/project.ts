export type ProjectStatus = "created";

export interface LocalProject {
  createdAt: string;
  fileExtension: string;
  fileName: string;
  fileSize: number;
  id: string;
  name: string;
  sourcePath: string;
  status: ProjectStatus;
}

export type ProjectDraft = Pick<
  LocalProject,
  "fileExtension" | "fileName" | "fileSize" | "name" | "sourcePath"
>;
