export const PRESENCE_ABSENCE_POLICIES = [
    { value: 'off', label: '关闭防抖', requiredAbsentSamples: 1 },
    { value: 'strict', label: '严谨', requiredAbsentSamples: 2 },
    { value: 'balanced', label: '中等', requiredAbsentSamples: 3 },
    { value: 'relaxed', label: '宽松', requiredAbsentSamples: 6 },
] as const;

export type PresenceAbsenceSensitivity =
    (typeof PRESENCE_ABSENCE_POLICIES)[number]['value'];

export const DEFAULT_PRESENCE_ABSENCE_SENSITIVITY: PresenceAbsenceSensitivity = 'strict';

export function isPresenceAbsenceSensitivity(
    value: unknown,
): value is PresenceAbsenceSensitivity {
    return PRESENCE_ABSENCE_POLICIES.some((policy) => policy.value === value);
}

export function presenceAbsencePolicy(sensitivity: PresenceAbsenceSensitivity) {
    return PRESENCE_ABSENCE_POLICIES.find((policy) => policy.value === sensitivity)
        ?? PRESENCE_ABSENCE_POLICIES[1];
}
