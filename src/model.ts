export type Category = 'repair' | 'cleanup' | 'disk' | 'network' | 'updates' | 'tools';
export type Theme = 'system' | 'light' | 'dark' | 'ember' | 'neon';
export type Language = 'pt' | 'en' | 'es' | 'ru' | 'zh';
export type Warning = 'repair' | 'cleanup' | 'temp' | 'browser' | 'network' | 'disk' | 'chkdsk' | 'updates' | 'memory';

export interface TaskDefinition {
  id: string;
  group: Category;
  icon: string;
  command: string;
  warning?: Warning;
  externalTool?: 'rammap';
  recommended?: boolean;
  estimated?: string;
}

export const TASKS: readonly TaskDefinition[] = [
  { id: 'dism-check', group: 'repair', icon: 'shield', command: 'DISM /CheckHealth', recommended: true, estimated: '1 min' },
  { id: 'dism-scan', group: 'repair', icon: 'search', command: 'DISM /ScanHealth', estimated: '5–25 min' },
  { id: 'dism-restore', group: 'repair', icon: 'wrench', command: 'DISM /RestoreHealth', warning: 'repair', estimated: '10–60 min' },
  { id: 'sfc', group: 'repair', icon: 'shield', command: 'sfc /scannow', estimated: '10–30 min' },
  { id: 'components', group: 'cleanup', icon: 'layers', command: 'DISM /StartComponentCleanup', estimated: '10–30 min' },
  { id: 'cleanmgr-config', group: 'cleanup', icon: 'settings', command: 'cleanmgr /sageset:1' },
  { id: 'cleanmgr-run', group: 'cleanup', icon: 'trash', command: 'cleanmgr /sagerun:1', warning: 'cleanup' },
  { id: 'temp-user', group: 'cleanup', icon: 'trash', command: '%LOCALAPPDATA%\\Temp\\*', warning: 'temp' },
  { id: 'temp-windows', group: 'cleanup', icon: 'trash', command: '%SystemRoot%\\Temp\\*', warning: 'temp' },
  { id: 'thumbcache-user', group: 'cleanup', icon: 'trash', command: 'ThumbCacheToDelete\\*.tmp' },
  { id: 'browser-edge', group: 'cleanup', icon: 'trash', command: 'Microsoft Edge · cache', warning: 'browser' },
  { id: 'browser-firefox', group: 'cleanup', icon: 'trash', command: 'Mozilla Firefox · cache', warning: 'browser' },
  { id: 'browser-vivaldi', group: 'cleanup', icon: 'trash', command: 'Vivaldi · cache', warning: 'browser' },
  { id: 'browser-brave', group: 'cleanup', icon: 'trash', command: 'Brave · cache', warning: 'browser' },
  { id: 'browser-chrome', group: 'cleanup', icon: 'trash', command: 'Google Chrome · cache', warning: 'browser' },
  { id: 'chkdsk-scan', group: 'disk', icon: 'hard-drive', command: 'chkdsk [unidade] /scan', estimated: '5–30 min' },
  { id: 'chkdsk-f', group: 'disk', icon: 'hard-drive', command: 'chkdsk [unidade] /f', warning: 'chkdsk' },
  { id: 'defrag', group: 'disk', icon: 'layers', command: 'defrag /C /O', warning: 'disk' },
  { id: 'flushdns', group: 'network', icon: 'wifi', command: 'ipconfig /flushdns', recommended: true },
  { id: 'renewip', group: 'network', icon: 'wifi', command: 'ipconfig /release + /renew', warning: 'network' },
  { id: 'winget-list', group: 'updates', icon: 'package', command: 'winget upgrade', recommended: true },
  { id: 'winget-upgrade', group: 'updates', icon: 'download', command: 'winget upgrade --all --include-unknown', warning: 'updates' },
  { id: 'rammap-empty', group: 'tools', icon: 'memory', command: 'RAMMap -Et', warning: 'memory', externalTool: 'rammap' }
];

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
