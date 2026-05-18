import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { hasVisibleInputCounterEntries, useBindingKeyStore } from './bindingKey';

export function useInputCounterWindowController(): void {
    const shouldShowPanel = useBindingKeyStore((s) =>
        s.panelEnabled && hasVisibleInputCounterEntries(s.entries),
    );

    useEffect(() => {
        const command = shouldShowPanel ? 'show_input_counter_window' : 'hide_input_counter_window';
        void invoke(command).catch((error) => {
            console.warn(`[input-counter] ${command} failed`, error);
        });
    }, [shouldShowPanel]);
}
