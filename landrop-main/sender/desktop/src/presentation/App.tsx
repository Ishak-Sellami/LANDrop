import { useEffect, useState } from 'react';
import type { DesktopApplication, DesktopInfo } from '../application/desktop';

type BackendState =
  | { kind: 'loading' }
  | { kind: 'ready'; info: DesktopInfo }
  | { kind: 'unavailable' };

export function App({ application }: { application: DesktopApplication }) {
  const [backend, setBackend] = useState<BackendState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setBackend({ kind: 'loading' });
    async function load() {
      try {
        const info = await application.getInfo();
        if (active) setBackend({ kind: 'ready', info });
      } catch {
        if (active) setBackend({ kind: 'unavailable' });
      }
    }
    void load();
    return () => { active = false; };
  }, [application, attempt]);

  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand-mark" aria-hidden="true">L<span>↗</span></div>
        <div>
          <p className="eyebrow">LOCAL. TRANSPARENT. YOURS.</p>
          <h1>LanDrop Desktop</h1>
          <p className="subtitle">Your local application delivery workspace.</p>
        </div>
        <span className="phase-badge">Foundation preview</span>
      </header>

      <section className="status-panel" aria-labelledby="status-heading">
        <div>
          <h2 id="status-heading">Status</h2>
          <p role="status" className={`status ${backend.kind}`}>
            <span className="status-dot" aria-hidden="true" />
            {backend.kind === 'loading' && 'Connecting to local backend…'}
            {backend.kind === 'ready' && 'Ready'}
            {backend.kind === 'unavailable' && 'Local backend unavailable'}
          </p>
        </div>
        {backend.kind === 'ready' && (
          <p className="muted">{backend.info.name} · v{backend.info.version}</p>
        )}
        {backend.kind === 'unavailable' && (
          <div className="backend-help">
            <p className="muted">Open the Tauri desktop app to use its Rust backend.</p>
            <button onClick={() => setAttempt(value => value + 1)}>Retry backend connection</button>
          </div>
        )}
      </section>

      <div className="workspace">
        <section className="card" aria-labelledby="devices-heading">
          <p className="eyebrow">01 / RECEIVERS</p>
          <h2 id="devices-heading">Nearby Devices</h2>
          <div className="empty-state">
            <span className="empty-symbol" aria-hidden="true">◎</span>
            <h3>No receivers discovered yet.</h3>
            <p>Discovery is not enabled in this foundation build.</p>
          </div>
        </section>
        <section className="card" aria-labelledby="delivery-heading">
          <p className="eyebrow">02 / DELIVERY</p>
          <h2 id="delivery-heading">Delivery</h2>
          <div className="empty-state">
            <span className="empty-symbol" aria-hidden="true">◇</span>
            <h3>No APK selected.</h3>
            <p>APK selection and delivery arrive in later phases.</p>
          </div>
        </section>
      </div>
      <footer>LanDrop Desktop is the Sender. No discovery, network session, or transfer is running.</footer>
    </main>
  );
}
