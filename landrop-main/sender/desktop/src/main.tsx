import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { desktopApplication } from './platform/tauriDesktop';
import { App } from './presentation/App';
import './presentation/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('LanDrop Desktop root element is missing.');

createRoot(root).render(
  <StrictMode>
    <App application={desktopApplication} />
  </StrictMode>,
);
