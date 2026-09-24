import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { normalizeWorkstationRegion, type WorkstationRegion } from '../domain/presencePersistence';
import './WorkstationCalibration.css';

interface Props {
    cameraDeviceId: string | null;
    region: WorkstationRegion | null;
    onSave: (region: WorkstationRegion | null) => void;
    onClose: () => void;
}

export function WorkstationCalibration({ cameraDeviceId, region, onSave, onClose }: Props) {
    const [frame, setFrame] = useState<string | null>(null);
    const [selection, setSelection] = useState<WorkstationRegion | null>(region);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const origin = useRef<{ x: number; y: number } | null>(null);
    const started = useRef(false);

    const refresh = async () => {
        setLoading(true);
        setError('');
        setFrame(null);
        try {
            const image = await invoke<string>('capture_camera_calibration_frame', { cameraDeviceId });
            if (!image.startsWith('data:image/jpeg;base64,')) throw new Error('画面格式不正确');
            setFrame(image);
        } catch {
            setError('无法获取摄像头画面。请检查授权或设备占用后重试。');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        void refresh();
    }, [cameraDeviceId]);

    const point = (event: PointerEvent<HTMLDivElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
            y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
        };
    };
    const updateSelection = (event: PointerEvent<HTMLDivElement>) => {
        if (!origin.current) return;
        const end = point(event);
        const x = Math.min(origin.current.x, end.x);
        const y = Math.min(origin.current.y, end.y);
        setSelection({
            x, y,
            width: Math.abs(end.x - origin.current.x),
            height: Math.abs(end.y - origin.current.y),
        });
    };
    const beginSelection = (event: PointerEvent<HTMLDivElement>) => {
        if (!frame) return;
        origin.current = point(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        setSelection(null);
    };
    const endSelection = (event: PointerEvent<HTMLDivElement>) => {
        updateSelection(event);
        origin.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };
    const validSelection = normalizeWorkstationRegion(selection);

    return (
        <div className="workstation-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <div className="workstation-dialog" role="dialog" aria-modal="true" aria-label="校准工位区域"
                onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
                <div className="workstation-header">
                    <h3>工位区域</h3>
                    <button className="btn" onClick={onClose} aria-label="关闭校准">×</button>
                </div>
                {frame ? (
                    <div className="workstation-frame" role="img" aria-label="摄像头校准画面"
                        onPointerDown={beginSelection}
                        onPointerMove={updateSelection}
                        onPointerUp={endSelection}
                        onPointerCancel={() => { origin.current = null; }}>
                        <img src={frame} alt="" draggable={false} />
                        {selection && (
                            <div className="workstation-selection" style={{
                                left: `${selection.x * 100}%`, top: `${selection.y * 100}%`,
                                width: `${selection.width * 100}%`, height: `${selection.height * 100}%`,
                            }} />
                        )}
                    </div>
                ) : (
                    <div className="workstation-placeholder" role="status">
                        {loading ? '正在获取画面…' : error}
                    </div>
                )}
                <div className="workstation-actions">
                    <button className="btn" onClick={() => void refresh()} disabled={loading}>刷新画面</button>
                    <button className="btn" onClick={() => onSave(null)}>使用整个画面</button>
                    <button className="btn btn-primary" onClick={() => onSave(validSelection)}
                        disabled={!frame || !validSelection}>应用区域</button>
                </div>
            </div>
        </div>
    );
}
