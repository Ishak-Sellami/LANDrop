import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopInfo } from '../application/desktop';
import { App } from './App';

const info: DesktopInfo = { name: 'LanDrop Desktop', version: '0.1.0' };

describe('Desktop foundation', () => {
  it('renders the shell and reports readiness after the backend responds', async () => {
    const getInfo = vi.fn().mockResolvedValue(info);
    render(<App application={{ getInfo }} />);

    expect(screen.getByRole('heading', { name: 'LanDrop Desktop' })).toBeInTheDocument();
    expect(screen.getByText('No receivers discovered yet.')).toBeInTheDocument();
    expect(screen.getByText('No APK selected.')).toBeInTheDocument();
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(getInfo).toHaveBeenCalledOnce();
  });

  it('does not claim readiness while waiting for the backend', () => {
    const getInfo = () => new Promise<DesktopInfo>(() => {});
    render(<App application={{ getInfo }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to local backend');
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('reports backend failure and allows a real retry', async () => {
    const getInfo = vi.fn()
      .mockRejectedValueOnce(new Error('Runtime unavailable'))
      .mockResolvedValue(info);
    render(<App application={{ getInfo }} />);

    expect(await screen.findByText('Local backend unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry backend connection' }));
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(getInfo).toHaveBeenCalledTimes(2);
  });
});
