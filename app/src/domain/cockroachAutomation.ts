import { invoke } from '@tauri-apps/api/core';
import type { PomodoroRuleEvent } from './pomodoroEvents';

export const COCKROACH_RULES_CHANGED = 'cockroach-automation-rules-changed';
export const COCKROACH_AUTOMATION_RESULT = 'cockroach-automation-result';
export const COCKROACH_ACTIONS = [
    { id: 'kill-all', label: '杀死所有蟑螂' },
    { id: 'spawn-one', label: '开始繁殖蟑螂' },
    { id: 'start-simulation', label: '开始模拟蟑螂' },
    { id: 'stop-simulation', label: '停止模拟' },
] as const;
export type CockroachAction = typeof COCKROACH_ACTIONS[number]['id'];
export interface CockroachRule {
    readonly event: PomodoroRuleEvent;
    readonly action: CockroachAction;
}
export function readCockroachRules(): Promise<CockroachRule[]> {
    return invoke('read_cockroach_automation_rules');
}
export function saveCockroachRules(rules: readonly CockroachRule[]): Promise<CockroachRule[]> {
    return invoke('save_cockroach_automation_rules', { rules });
}
export function executeCockroachAction(action: CockroachAction): Promise<void> {
    return invoke('execute_extension_pack_action', { packId: 'pet.cockroach-invasion', action });
}
