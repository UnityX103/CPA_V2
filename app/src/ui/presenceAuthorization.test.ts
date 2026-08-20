import { describe, expect, it } from 'vitest';
import type { PresenceAvailability } from '../domain/presence';
import { presenceAuthorizationView } from './presenceAuthorization';

describe('presenceAuthorizationView', () => {
    it.each([
        ['permissionRequired', '需要授权', ['requestAccess']],
        ['ready', '摄像头可用', []],
        ['permissionDenied', '权限被拒绝', ['retry', 'openSettings']],
        ['noDevice', '未找到摄像头', ['retry']],
        ['busy', '摄像头被占用', ['retry']],
        ['error', '检测失败', ['retry']],
    ] satisfies Array<[PresenceAvailability, string, string[]]>) (
        'maps %s to its status and actions',
        (availability, status, actions) => {
            expect(presenceAuthorizationView(true, availability)).toEqual(expect.objectContaining({
                status,
                actions,
            }));
        },
    );

    it('does not expose actions while disabled or checking', () => {
        expect(presenceAuthorizationView(false, 'permissionRequired').actions).toEqual([]);
        expect(presenceAuthorizationView(true, 'checking').actions).toEqual([]);
    });
});
