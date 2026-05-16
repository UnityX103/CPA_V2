"use client";

import { useState, type ReactNode } from "react";

/**
 * SettingsPanel — pixel-exact port of Pencil `vnYnS` (Unified Settings Panel).
 *
 * Frame: 460×394, padding 20, radius 20, fill #FFFFFF, stroke 1 #F1E5D8, layout vertical, gap 16.
 *
 *   head 8QyVE  layout horizontal, align center, width fill
 *     title 5cQ0e   "设置" 18px bold #5B4636
 *     spacer 0TTLX  frame width fill height 1
 *     closeBtn mNjRm (ref UAbZg)  padding 6, transparent, icon lucide x 18×18 #A28B79
 *
 *   body 3kLAl  layout horizontal, width fill, height fill, clip true
 *     sidebar qvEam  width 71, height 318, padding [8,0], radius 5, fill #F6F7F8, vertical
 *       ajiBx tab-pomodoro  padding [10,14], width fill, fill #FFFFFF (active),
 *                            text "番茄钟" 13px bold #D15F3D
 *       8jjqe tab-online    padding [10,14], width fill, transparent,
 *                            text "联机" 13px medium #9E8E80
 *       Cz9E3 tab-pet       padding [10,14], width fill, transparent,
 *                            text "宠物" 13px medium #9E8E80
 *       htxKX tab-global    padding [10,14], width fill, transparent,
 *                            text "全局" 13px medium #9E8E80
 *     content NCXdZ  vertical, width fill, height fill, transparent
 *       contentArea 2RdBk  vertical, gap 16, padding 16, transparent
 *         (active tab content — gs1Tv / 8Le5R / v2ZgA / Pdj9C — slotted via prop)
 *       uspApply EkvuW  ABSOLUTE x=0 y=0, width 349, height 38, justify end, fill #FFFFFF
 *         gBjcB apply-btn  padding [7,12], radius 999, fill #D15F3D,
 *                          "应用" 14px bold white, width 120
 *
 *   scale-dialog-host dIbYY  picking-mode:Ignore, height 0 — design-only stub, no DOM here.
 */

export type SettingsTab = "pomodoro" | "online" | "pet" | "global";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "pomodoro", label: "番茄钟" },
  { id: "online", label: "联机" },
  { id: "pet", label: "宠物" },
  { id: "global", label: "全局" }
];

export type SettingsPanelProps = {
  /** Currently active sidebar tab. Uncontrolled if omitted (defaults to "pomodoro"). */
  activeTab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
  /** Whether to render the absolute uspApply bar (only certain tabs show it: pomodoro / global). */
  showApply?: boolean;
  onApply?: () => void;
  onClose?: () => void;
  /** Slot rendered inside 2RdBk contentArea. */
  children?: ReactNode;
  className?: string;
};

export function SettingsPanel({
  activeTab: controlledTab,
  onTabChange,
  showApply = false,
  onApply,
  onClose,
  children,
  className
}: SettingsPanelProps) {
  const [uncontrolledTab, setUncontrolledTab] = useState<SettingsTab>("pomodoro");
  const tab = controlledTab ?? uncontrolledTab;

  const setTab = (next: SettingsTab) => {
    if (onTabChange) onTabChange(next);
    if (controlledTab === undefined) setUncontrolledTab(next);
  };

  return (
    <section
      className={["preview-frame", className].filter(Boolean).join(" ")}
      style={{
        position: "relative",
        width: 460,
        height: 394,
        padding: 20,
        borderRadius: 20,
        background: "#FFFFFF",
        border: "1px solid #F1E5D8",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        boxSizing: "border-box",
        fontFamily: "var(--font-maoken)"
      }}
    >
      {/* 8QyVE — head */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          width: "100%",
          flexShrink: 0
        }}
      >
        {/* 5cQ0e — title */}
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-maoken)",
            fontSize: 18,
            fontWeight: 700,
            color: "#5B4636",
            lineHeight: 1,
            flex: "0 0 auto"
          }}
        >
          设置
        </h2>
        {/* 0TTLX — spacer */}
        <div style={{ flex: 1, height: 1 }} />
        {/* mNjRm — closeBtn (ref UAbZg) */}
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            padding: 6,
            borderRadius: 999,
            background: "transparent",
            border: "none",
            color: "#A28B79",
            cursor: "pointer",
            boxSizing: "border-box",
            flexShrink: 0
          }}
        >
          <CloseIcon />
        </button>
      </div>

      {/* 3kLAl — body */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flex: 1,
          width: "100%",
          minHeight: 0,
          overflow: "hidden"
        }}
      >
        {/* qvEam — sidebar */}
        <nav
          style={{
            width: 71,
            height: 318,
            padding: "8px 0",
            borderRadius: 5,
            background: "#F6F7F8",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                width: "100%",
                padding: "10px 14px",
                background: t.id === tab ? "#FFFFFF" : "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "var(--font-maoken)",
                fontSize: 13,
                fontWeight: t.id === tab ? 700 : 500,
                color: t.id === tab ? "#D15F3D" : "#9E8E80",
                lineHeight: 1,
                boxSizing: "border-box"
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* NCXdZ — content */}
        <div
          style={{
            position: "relative",
            flex: 1,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            minWidth: 0
          }}
        >
          {/* 2RdBk — contentArea */}
          <div
            style={{
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              flex: 1,
              overflowY: "auto",
              boxSizing: "border-box",
              /* Push first card below the absolute apply bar when applicable. */
              paddingTop: showApply ? 16 + 38 + 8 : 16
            }}
          >
            {children}
          </div>

          {/* EkvuW — uspApply (absolute, only on tabs that mutate state) */}
          {showApply && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 349,
                height: 38,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                background: "#FFFFFF",
                padding: "0 16px",
                boxSizing: "border-box",
                pointerEvents: "none"
              }}
            >
              {/* gBjcB — apply-btn */}
              <button
                type="button"
                onClick={onApply}
                style={{
                  width: 120,
                  height: 38,
                  padding: "7px 12px",
                  borderRadius: 999,
                  background: "#D15F3D",
                  color: "#FFFFFF",
                  fontFamily: "var(--font-maoken)",
                  fontSize: 14,
                  fontWeight: 700,
                  lineHeight: 1,
                  border: "none",
                  cursor: "pointer",
                  pointerEvents: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxSizing: "border-box"
                }}
              >
                应用
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CloseIcon() {
  // lucide `x` 18×18 #A28B79 (color via currentColor)
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
