/**
 * TypeScript interfaces for OmniFocus data objects returned by the mappers.
 */

export interface TaskData {
  id: string;
  name: string;
  note: string;
  completed: boolean;
  dropped: boolean;
  flagged: boolean;
  dueDate: string | null;
  deferDate: string | null;
  plannedDate: string | null;
  estimatedMinutes: number | null;
  tags: string[];
  projectName: string | null;
  assignedProject: string | null;
  inInbox: boolean;
  repetitionRule: string | null;
  repetitionMethod: string | null;
  parentTaskId: string | null;
  parentTaskName: string | null;
  hasChildren: boolean;
  childTaskCount: number;
}

export interface ProjectData {
  id: string;
  name: string;
  note: string;
  status: string;
  completed: boolean;
  flagged: boolean;
  dueDate: string | null;
  deferDate: string | null;
  folderName: string | null;
  taskCount: number;
  sequential: boolean;
  nextReviewDate: string | null;
}

export interface FolderData {
  id: string;
  name: string;
  status: string;
  projectCount: number;
  folderCount: number;
  parentName: string | null;
}

export interface TagData {
  id: string;
  name: string;
  status: string;
  taskCount: number;
  allowsNextAction: boolean;
  parentName: string | null;
}

export interface PerspectiveData {
  id: string;
  name: string;
}
