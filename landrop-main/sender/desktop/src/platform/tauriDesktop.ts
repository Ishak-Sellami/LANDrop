import { invoke } from '@tauri-apps/api/core';
import type { DesktopApplication, DesktopInfo } from '../application/desktop';

export const desktopApplication: DesktopApplication = {
  getInfo: () => invoke<DesktopInfo>('get_desktop_info'),
};
