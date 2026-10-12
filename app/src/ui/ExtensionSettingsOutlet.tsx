import type { ComponentType } from 'react';
import type { ExtensionSettingsRenderer } from '../domain/extensionPacks';
import { PetSettingsTab } from './PetSettingsTab';
import { KegelSettingsTab } from './KegelSettings';

const SETTINGS_RENDERERS: Readonly<Record<ExtensionSettingsRenderer, ComponentType>> = {
    'pet.cockroach-invasion': PetSettingsTab,
    'wellness.kegel': KegelSettingsTab,
};

export function ExtensionSettingsOutlet({ renderer }: { renderer: ExtensionSettingsRenderer }) {
    const SettingsComponent = SETTINGS_RENDERERS[renderer];
    return <SettingsComponent />;
}
