/** Host contract for an installed extension that coordinates the break timer. */
export type BreakActivityStatus = 'waiting' | 'running' | 'paused' | 'resetting';
export type BreakActivityAction = 'toggle' | 'resume-ready' | 'finish' | 'skip';
export interface BreakActivity {
    readonly id: string;
    readonly ownerId: string;
    readonly status: BreakActivityStatus;
}
export interface BreakActivitySnapshot {
    readonly activity: BreakActivity | null;
    readonly remainingSeconds: number;
    readonly phase: 'focus' | 'break' | 'completed';
    /** Native output-device ID shared by the host's audio settings. */
    readonly audioOutputDeviceId?: string | null;
}
export const BREAK_ACTIVITY_STATE_EVENT = 'break-activity:state';
export const BREAK_ACTIVITY_REQUEST_EVENT = 'break-activity:request';
export const BREAK_ACTIVITY_CONTROL_EVENT = 'break-activity:control';
export function activityOwnsBreak(activity: BreakActivity | null): boolean {
    return activity !== null;
}
