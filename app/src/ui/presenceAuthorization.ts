import type { PresenceAvailability } from '../domain/presence';

export type PresenceAuthorizationAction = 'requestAccess' | 'retry' | 'openSettings';

export interface PresenceAuthorizationView {
    status: string;
    detail: string;
    tone: 'neutral' | 'ready' | 'warning';
    actions: PresenceAuthorizationAction[];
}

export function presenceAuthorizationView(
    enabled: boolean,
    availability: PresenceAvailability,
): PresenceAuthorizationView {
    if (!enabled || availability === 'disabled') {
        return {
            status: '未启用',
            detail: '启用并应用后检查摄像头授权',
            tone: 'neutral',
            actions: [],
        };
    }

    switch (availability) {
        case 'permissionRequired':
            return {
                status: '需要授权',
                detail: '点击申请权限后才会弹出系统提示',
                tone: 'warning',
                actions: ['requestAccess'],
            };
        case 'checking':
            return {
                status: '正在检查',
                detail: '正在确认摄像头授权与设备状态',
                tone: 'neutral',
                actions: [],
            };
        case 'ready':
            return {
                status: '摄像头可用',
                detail: '已授权，可用于自动控制',
                tone: 'ready',
                actions: [],
            };
        case 'permissionDenied':
            return {
                status: '权限被拒绝',
                detail: '请在系统设置中允许摄像头访问',
                tone: 'warning',
                actions: ['retry', 'openSettings'],
            };
        case 'noDevice':
            return {
                status: '未找到摄像头',
                detail: '连接摄像头后重试',
                tone: 'warning',
                actions: ['retry'],
            };
        case 'busy':
            return {
                status: '摄像头被占用',
                detail: '关闭占用摄像头的应用后重试',
                tone: 'warning',
                actions: ['retry'],
            };
        case 'error':
            return {
                status: '检测失败',
                detail: '请稍后重试摄像头检查',
                tone: 'warning',
                actions: ['retry'],
            };
        default:
            return {
                status: '检测失败',
                detail: '请稍后重试',
                tone: 'warning',
                actions: ['retry'],
            };
    }
}
