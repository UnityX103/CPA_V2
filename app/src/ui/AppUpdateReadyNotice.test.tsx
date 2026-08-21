import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppUpdateStore } from '../domain/appUpdate';
import { AppUpdateReadyNotice } from './AppUpdateReadyNotice';

describe('AppUpdateReadyNotice', () => {
    const initial = useAppUpdateStore.getState();

    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        useAppUpdateStore.setState({
            autoUpdateEnabled: true,
            status: 'idle',
            currentVersion: null,
            availableVersion: null,
            releaseNotes: null,
            lastCheckedAt: null,
            errorMessage: null,
            downloadedBytes: 0,
            downloadTotalBytes: null,
            restartForUpdate: initial.restartForUpdate,
        });
    });

    it('stays hidden until an update is ready to restart', () => {
        render(<AppUpdateReadyNotice />);

        expect(screen.queryByRole('status')).toBeNull();
    });

    it('shows the available version when restart is ready', () => {
        useAppUpdateStore.setState({
            status: 'readyToRestart',
            availableVersion: '0.2.0',
        });

        render(<AppUpdateReadyNotice />);

        expect(screen.getByRole('status')).toHaveTextContent('新版本 0.2.0 已准备好');
        expect(screen.getByRole('button', { name: '重启更新' })).toBeInTheDocument();
    });

    it('relaunches from the restart button', () => {
        const restartForUpdate = vi.fn(() => Promise.resolve());
        useAppUpdateStore.setState({
            status: 'readyToRestart',
            restartForUpdate,
        });

        render(<AppUpdateReadyNotice />);
        fireEvent.click(screen.getByRole('button', { name: '重启更新' }));

        expect(restartForUpdate).toHaveBeenCalledTimes(1);
    });
});
