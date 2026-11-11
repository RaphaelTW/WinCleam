import taskCatalog from '../shared/tasks.json';

export type Category = 'repair' | 'cleanup' | 'disk' | 'network' | 'updates' | 'tools';
export type Theme = 'system' | 'light' | 'dark';
export type Language = 'pt' | 'en' | 'es' | 'ru' | 'zh';
export type Warning = 'repair' | 'cleanup' | 'temp' | 'browser' | 'network' | 'disk' | 'chkdsk' | 'updates' | 'memory';

export interface TaskDefinition {
  id: string;
  group: Category;
  icon: string;
  command: string;
  warning?: Warning;
  recommended?: boolean;
}

export const TASKS: readonly TaskDefinition[] = taskCatalog as TaskDefinition[];

export const CATEGORIES: Category[] = ['repair', 'cleanup', 'disk', 'network', 'updates', 'tools'];

export interface DriveInfo {
  letter: string;
  label: string;
  size: number;
  free: number;
}
export interface BootstrapInfo {
  isAdmin: boolean;
  isWindows: boolean;
  version: string;
  preferences: { rammapPath?: string | null; lassoPath?: string | null };
}
export interface SystemSnapshot {
  cpuPercent: number;
  memoryTotal: number;
  memoryUsed: number;
  cpuCount: number;
  osName: string;
  temperatures: { cpu: number | null; gpu: number | null; motherboard: number | null; memory: number | null };
}
export interface HardwareMonitorStatus {
  detected: boolean;
  checkedAt: string;
}
export interface RunRequest {
  ids: string[];
  diskTarget: string;
  repairAcknowledged: boolean;
  locale: Language;
}
export interface MaintenanceEvent {
  kind: 'run-start' | 'task-start' | 'task-end' | 'step' | 'progress' | 'log' | 'run-end';
  taskId?: string;
  message?: string;
  rawMessage?: string;
  percent?: number;
  ids?: string[];
  index?: number;
  total?: number;
  step?: number;
  ok?: boolean;
  error?: string;
  completed?: number;
  failed?: number;
  skipped?: number;
}
