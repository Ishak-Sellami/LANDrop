export interface DesktopInfo {
  readonly name: string;
  readonly version: string;
}

// The presentation layer consumes this contract, not the Tauri runtime.
export interface DesktopApplication {
  getInfo(): Promise<DesktopInfo>;
}
