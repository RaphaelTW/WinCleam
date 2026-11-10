import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BootstrapInfo, DriveInfo, MaintenanceEvent, RunRequest, SystemSnapshot } from './model';

export const desktop = isTauri();

export const bridge = {
  async bootstrap(): Promise<BootstrapInfo> {
    return desktop
      ? invoke<BootstrapInfo>('bootstrap')
      : { isAdmin: false, isWindows: false, version: '2.0.0', preferences: {} };
  },
  async drives(): Promise<DriveInfo[]> {
    return desktop ? invoke<DriveInfo[]>('list_drives') : [
      { letter: 'C:', label: 'Windows (prévia)', size: 512e9, free: 240e9 },
      { letter: 'D:', label: 'Dados (prévia)', size: 1024e9, free: 720e9 }
    ];
  },
  async snapshot(): Promise<SystemSnapshot> {
    if (desktop) return invoke<SystemSnapshot>('system_snapshot');
    const now = Date.now() / 1900;
    return {
      cpuPercent: 18 + Math.abs(Math.sin(now)) * 24,
      memoryTotal: 16 * 1024 ** 3,
      memoryUsed: (6.1 + Math.abs(Math.sin(now / 2)) * 1.1) * 1024 ** 3,
      cpuCount: 4,
      osName: 'Prévia visual'
    };
  },
  async start(request: RunRequest): Promise<void> {
    if (!desktop) throw new Error('Modo de demonstração: execute pelo Tauri no Windows.');
    await invoke('start_run', { request });
  },
  async stop(): Promise<boolean> {
    return desktop ? invoke<boolean>('stop_after_current') : false;
  },
  async chooseTool(tool: 'rammap' | 'lasso'): Promise<string | null> {
    return desktop ? invoke<string | null>('choose_external_tool', { tool }) : null;
  },
  async openTool(tool: 'rammap' | 'lasso'): Promise<void> {
    if (!desktop) throw new Error('Ferramenta externa disponível somente no Windows.');
    await invoke('open_external_tool', { tool });
  },
  async windowsSettings(target: 'drivers' | 'updates'): Promise<void> {
    if (!desktop) throw new Error('Configurações disponíveis no Windows.');
    await invoke('open_windows_settings', { target });
  },
  async openLatestRelease(): Promise<void> {
    if (!desktop) throw new Error('Atualizações estão disponíveis somente no aplicativo instalado.');
    await invoke('open_latest_release');
  },
  async exportLog(): Promise<boolean> {
    if (!desktop) throw new Error('A exportação precisa do aplicativo instalado.');
    return invoke<boolean>('export_log');
  },
  async listen(handler: (event: MaintenanceEvent) => void): Promise<() => void> {
    if (!desktop) return () => {};
    return listen<MaintenanceEvent>('wincleam:event', payload => handler(payload.payload));
  }
};
