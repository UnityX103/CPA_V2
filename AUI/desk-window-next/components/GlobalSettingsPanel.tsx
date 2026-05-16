"use client";

import type { ReactNode } from "react";

/**
 * GlobalSettingsPanel — pixel-exact port of Pencil `Pdj9C` (Global Settings Panel content).
 *
 * Pencil structure (transparent frame, vertical, gap 16, width fill_container(572)):
 *
 *   arfmO gspScale            radius 16, fill #F6F7F8, gap 10, padding 16, vertical, width fill
 *     K0ec1 "界面缩放"          12px 600 #9CA3AF
 *     Hr3ry gsp-scale-row     YwCv6 Input/Slider — horizontal, gap 12, height 24, width fill
 *       7PxeN slider track    24 tall, radius 12, fill #FFFFFFCC, stroke 1 #E5E7EB, layout none
 *         X2MIu fill           radius 13, fill #66B8FF, height 20, x=2 y=2 (width = value × inner)
 *         qlOSu thumb          24×24 ellipse, fill #FFFFFF, stroke 2 #66B8FF
 *       dXdRg value           "1.0×" 14px 700 #1A1A1A, textAlign right, width 48
 *
 *   v1Cfj gspDisplay          radius 16, fill #F6F7F8, gap 10, padding 16, vertical, width fill
 *     s4PsK "目标显示器"        12px 600 #9CA3AF
 *     eTdq5 dropdown          Frjkw Input/Dropdown full-width — radius 12, fill #FFFFFFCC,
 *                              padding [12,14], stroke 1 #E5E7EB, justify space_between, align center
 *                              value "显示器 1" 14px 500 #1A1A1A + chevron-down 18×18 #6B7280
 *
 *   yjJtt gspBindingKey       radius 16, fill #F6F7F8, gap 10, padding 16, vertical, width fill
 *     dM8yb gsp-binding-header  horizontal, justify space_between, align center, width fill
 *       p2ln7 "按键计数"        12px 600 #9CA3AF
 *       GXy0R toggle           NGo9f Toggle Switch 44×24
 *     oYuoP description       "添加按键监听绑定；启用某一项后弹出独立的输入计数面板；最多 1 个标记为同步到远端。"
 *                              11px normal #9CA3AF, fixed-width fill
 *     V1M4tg gsp-binding-list  vertical, gap 8, width fill
 *       BindingKeyRow (RU5zF): horizontal, gap 8, width 540 (fits inside list — children packed left)
 *         n7yDy listener      radius 12, fill #FFFFFFCC, height 36, padding [10,14], stroke 1 #E5E7EB,
 *                              justify space_between, align center
 *           jQjpI key         "鼠标左键" 14px 500 #1A1A1A
 *           aNx5B hint        "点击重新绑定" 11px normal #9CA3AF
 *         kJ6dN sync-btn      36×36 circle, fill #FFFFFFCC, stroke 1 #E5E7EB,
 *                              icon radio-tower 16×16 #9CA3AF
 *                              (synced variant: stroke 1.5 #D15F3D, icon #D15F3D)
 *         yyYgJ del-btn       36×36 circle, fill #FFFFFFCC, stroke 1 #E5E7EB,
 *                              icon trash-2 14×14 #9CA3AF
 *     YQ4ou gsp-binding-add   horizontal, justify center, align center, gap 6, height 36,
 *                              radius 12, padding [8,12], transparent, dashed stroke 1 #D1D5DB
 *                              lucide plus 16×16 #9CA3AF + "添加按键" 13px 500 #9CA3AF
 */

export type BindingKey = {
  /** Display label for the bound key, e.g. "鼠标左键", "Space" */
  label: string;
  /** Whether this binding is the one marked as synced to the room */
  synced?: boolean;
  /** Optional hint shown next to the key label */
  hint?: string;
};

export type GlobalSettingsPanelProps = {
  /** Scale value 0..1 mapped onto the slider range */
  scaleProgress?: number;
  scaleLabel?: string;
  display?: string;
  bindingsEnabled?: boolean;
  bindings?: BindingKey[];
  width?: number | string;
  className?: string;
};

const DEFAULT_BINDINGS: BindingKey[] = [
  { label: "鼠标左键", synced: false },
  { label: "Space", synced: true }
];

export function GlobalSettingsPanel({
  scaleProgress = 0.6,
  scaleLabel = "1.0×",
  display = "显示器 1",
  bindingsEnabled = true,
  bindings = DEFAULT_BINDINGS,
  width = "100%",
  className
}: GlobalSettingsPanelProps) {
  return (
    <div
      className={["preview-frame", className].filter(Boolean).join(" ")}
      data-node-id="Pdj9C"
      style={{
        width,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: "transparent",
        fontFamily: "var(--font-maoken)"
      }}
    >
      {/* arfmO — gspScale */}
      <Card data-node-id="arfmO">
        <CardLabel>界面缩放</CardLabel>
        <Slider value={scaleProgress} valueLabel={scaleLabel} />
      </Card>

      {/* v1Cfj — gspDisplay */}
      <Card data-node-id="v1Cfj">
        <CardLabel>目标显示器</CardLabel>
        <Dropdown value={display} />
      </Card>

      {/* yjJtt — gspBindingKey */}
      <Card data-node-id="yjJtt">
        <BindingHeader enabled={bindingsEnabled} />
        <p
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 400,
            color: "#9CA3AF",
            lineHeight: 1.4
          }}
        >
          添加按键监听绑定；启用某一项后弹出独立的输入计数面板；最多 1 个标记为同步到远端。
        </p>
        {bindings.length > 0 && (
          <div data-node-id="V1M4tg" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {bindings.map((b, i) => (
              <BindingKeyRow key={i} binding={b} />
            ))}
          </div>
        )}
        <AddBindingButton />
      </Card>
    </div>
  );
}

/* ============================================================
 * arfmO — Slider (YwCv6)
 * ============================================================ */

function Slider({ value, valueLabel }: { value: number; valueLabel: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      data-node-id="Hr3ry"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        height: 24,
        width: "100%"
      }}
    >
      {/* 7PxeN — slider track */}
      <div
        data-node-id="7PxeN"
        style={{
          position: "relative",
          flex: 1,
          height: 24,
          borderRadius: 12,
          background: "#FFFFFFCC",
          border: "1px solid #E5E7EB",
          boxSizing: "border-box"
        }}
      >
        {/* X2MIu — fill */}
        <div
          style={{
            position: "absolute",
            left: 2,
            top: 2,
            height: 20,
            width: `calc((100% - 4px) * ${clamped})`,
            background: "#66B8FF",
            borderRadius: 13
          }}
        />
        {/* qlOSu — thumb */}
        <div
          style={{
            position: "absolute",
            left: `calc((100% - 24px) * ${clamped})`,
            top: 0,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "#FFFFFF",
            border: "2px solid #66B8FF",
            boxSizing: "border-box"
          }}
        />
      </div>
      {/* dXdRg — value text */}
      <span
        style={{
          width: 48,
          textAlign: "right",
          fontSize: 14,
          fontWeight: 700,
          color: "#1A1A1A",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0
        }}
      >
        {valueLabel}
      </span>
    </div>
  );
}

/* ============================================================
 * v1Cfj — Dropdown (Frjkw, full-width)
 * ============================================================ */

function Dropdown({ value }: { value: string }) {
  return (
    <button
      data-node-id="eTdq5"
      type="button"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 14px",
        borderRadius: 12,
        background: "#FFFFFFCC",
        border: "1px solid #E5E7EB",
        fontFamily: "var(--font-maoken)",
        cursor: "pointer",
        boxSizing: "border-box",
        width: "100%"
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A", lineHeight: 1 }}>{value}</span>
      <ChevronDownIcon />
    </button>
  );
}

/* ============================================================
 * yjJtt — BindingKey header + row + add btn
 * ============================================================ */

function BindingHeader({ enabled }: { enabled: boolean }) {
  return (
    <div
      data-node-id="dM8yb"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%"
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF", lineHeight: 1 }}>按键计数</span>
      <Toggle checked={enabled} />
    </div>
  );
}

function BindingKeyRow({ binding }: { binding: BindingKey }) {
  const hint = binding.hint ?? "点击重新绑定";
  return (
    <div
      data-node-id="RU5zF"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8
      }}
    >
      {/* n7yDy — listener */}
      <button
        type="button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          height: 36,
          padding: "10px 14px",
          borderRadius: 12,
          background: "#FFFFFFCC",
          border: "1px solid #E5E7EB",
          cursor: "pointer",
          boxSizing: "border-box",
          fontFamily: "var(--font-maoken)"
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A", lineHeight: 1 }}>{binding.label}</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: "#9CA3AF", lineHeight: 1 }}>{hint}</span>
      </button>

      {/* kJ6dN — sync-btn (synced variant = #D15F3D stroke + icon) */}
      <button
        type="button"
        aria-label={binding.synced ? "取消同步" : "同步到房间"}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          background: "#FFFFFFCC",
          border: binding.synced ? "1.5px solid #D15F3D" : "1px solid #E5E7EB",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: binding.synced ? "#D15F3D" : "#9CA3AF",
          cursor: "pointer",
          boxSizing: "border-box",
          flexShrink: 0,
          padding: 0
        }}
      >
        <RadioTowerIcon />
      </button>

      {/* yyYgJ — del-btn */}
      <button
        type="button"
        aria-label="删除"
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          background: "#FFFFFFCC",
          border: "1px solid #E5E7EB",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9CA3AF",
          cursor: "pointer",
          boxSizing: "border-box",
          flexShrink: 0,
          padding: 0
        }}
      >
        <Trash2Icon />
      </button>
    </div>
  );
}

function AddBindingButton() {
  return (
    <button
      data-node-id="YQ4ou"
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: "100%",
        height: 36,
        padding: "8px 12px",
        borderRadius: 12,
        background: "transparent",
        border: "1px solid #D1D5DB",
        color: "#9CA3AF",
        fontFamily: "var(--font-maoken)",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        boxSizing: "border-box"
      }}
    >
      <PlusIcon />
      添加按键
    </button>
  );
}

/* ============================================================
 * Shared primitives
 * ============================================================ */

function Card({ children, ...rest }: { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 16,
        borderRadius: 16,
        background: "#F6F7F8",
        width: "100%",
        boxSizing: "border-box"
      }}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF", lineHeight: 1 }}>{children}</span>;
}

function Toggle({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        background: checked ? "#22C55E" : "#B5A49A",
        padding: 2,
        position: "relative",
        boxSizing: "border-box",
        flexShrink: 0
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#FFFFFF",
          transform: checked ? "translateX(20px)" : "translateX(0)",
          transition: "transform 0.2s"
        }}
      />
    </div>
  );
}

/* ============================================================
 * Icons
 * ============================================================ */

function ChevronDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }} aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function RadioTowerIcon() {
  // lucide `radio-tower` 16×16
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }} aria-hidden="true">
      <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
      <path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
      <circle cx="12" cy="9" r="2" />
      <path d="M16.2 4.8c2 2 2.26 5.11.8 7.47" />
      <path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1" />
      <path d="M9.5 18h5l1.5 4h-8Z" />
    </svg>
  );
}

function Trash2Icon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }} aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }} aria-hidden="true">
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}
