"use client";

import type { ReactNode } from "react";

/**
 * PomodoroSettingsPanel — pixel-exact port of Pencil `gs1Tv` (Pomodoro Settings Panel content).
 *
 * Pencil structure (transparent frame, vertical, gap 16, width fill_container(572)):
 *   aIr3d pomoGrid              horizontal, gap 12, width fill
 *     9wvlU pomoWork            radius 16, fill #F6F7F8, gap 10, padding 16, vertical, width fill
 *       xe3pV "专注时长"          12px 600 #9CA3AF
 *       INPgi pomoWorkInput (Input/TextSuffix 0cT2B):
 *         radius 12, fill #FFFFFFCC, padding [12,14], stroke 1 #E5E7EB, justify space_between, align center, width fill
 *         OQv34 "25"   24px 800 #1A1A1A
 *         zpqfK "分钟" 13px 600 #6B7280
 *     UC3kS pomoBreak           radius 16, fill #FFF7D9 (warm), gap 10, padding 16, vertical, width fill
 *       HCa8G "休息时长"          12px 600 #D97706
 *       QwKzL pomoBreakInput:    radius 12, fill #FFFFFFB8, padding [12,14], stroke 1 #F3D28B (warm)
 *         OQv34 "5"    24px 800 #1A1A1A
 *         zpqfK "分钟" 13px 600 #A16207
 *
 *   JpJcn pomoFooter            vertical, gap 10
 *     aCOWE pomoNotif           align center, radius 16, fill #F6F7F8, justify space_between, padding [14,16], width fill
 *       hlKwN left: "结束提示音"  14px 500 #1A1A1A
 *       wauq6 right: "柔和铃声"   12px 700 #6366F1 (link)
 *     I6SsL5 pomoEndAction      same shape
 *       E49hj1 left: "计时结束提示" 14px 500 #1A1A1A
 *       Tp1bH dropdown (Input/Dropdown Frjkw): radius 12, fill #FFFFFFCC, padding [12,14], stroke 1 #E5E7EB
 *         "弹窗到顶部" 14px 500 #1A1A1A + chevron-down 18×18 #6B7280
 *     WSnlp pomoVideoPath       enabled:false → NOT rendered (design hides this row)
 *     Jvg0I pomoVideoCustom     align center, radius 16, fill #F6F7F8, justify space_between, padding [14,16]
 *       n3DQc left: "自定义视频文件" 14px 500 #1A1A1A
 *       Tv9l8 right: "未选择" 12px 700 #9CA3AF + folder icon 16×16 #6B7280
 */

export type PomodoroSettingsPanelProps = {
  focusMinutes?: number;
  breakMinutes?: number;
  notifSound?: string;
  endAction?: string;
  videoFile?: string | null;
  width?: number | string;
  className?: string;
};

export function PomodoroSettingsPanel({
  focusMinutes = 25,
  breakMinutes = 5,
  notifSound = "柔和铃声",
  endAction = "弹窗到顶部",
  videoFile = null,
  width = "100%",
  className
}: PomodoroSettingsPanelProps) {
  return (
    <div
      className={["preview-frame", className].filter(Boolean).join(" ")}
      data-node-id="gs1Tv"
      style={{
        width,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: "transparent",
        fontFamily: "var(--font-maoken)"
      }}
    >
      {/* aIr3d — pomoGrid */}
      <div style={{ display: "flex", flexDirection: "row", gap: 12, width: "100%" }}>
        {/* 9wvlU — pomoWork */}
        <DurationCard
          tone="neutral"
          label="专注时长"
          value={focusMinutes}
          suffix="分钟"
        />
        {/* UC3kS — pomoBreak */}
        <DurationCard
          tone="warm"
          label="休息时长"
          value={breakMinutes}
          suffix="分钟"
        />
      </div>

      {/* JpJcn — pomoFooter */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        {/* aCOWE — pomoNotif */}
        <FooterRow label="结束提示音">
          <span style={{ fontSize: 12, fontWeight: 700, color: "#6366F1", lineHeight: 1 }}>
            {notifSound}
          </span>
        </FooterRow>

        {/* I6SsL5 — pomoEndAction */}
        <FooterRow label="计时结束提示">
          <DropdownFit value={endAction} />
        </FooterRow>

        {/* WSnlp pomoVideoPath — enabled:false per design; intentionally not rendered */}

        {/* Jvg0I — pomoVideoCustom */}
        <FooterRow label="自定义视频文件">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#9CA3AF", lineHeight: 1 }}>
              {videoFile ?? "未选择"}
            </span>
            <FolderIcon />
          </div>
        </FooterRow>
      </div>
    </div>
  );
}

/* ============================================================
 * DurationCard — 9wvlU / UC3kS shared shape.
 *   Tone "warm" maps the design's UC3kS pomoBreak: warm fills + amber label/suffix.
 * ============================================================ */

function DurationCard({
  tone,
  label,
  value,
  suffix
}: {
  tone: "neutral" | "warm";
  label: string;
  value: number;
  suffix: string;
}) {
  const isWarm = tone === "warm";
  return (
    <div
      style={{
        flex: 1,
        background: isWarm ? "#FFF7D9" : "#F6F7F8",
        borderRadius: 16,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxSizing: "border-box"
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: isWarm ? "#D97706" : "#9CA3AF",
          lineHeight: 1
        }}
      >
        {label}
      </span>
      {/* INPgi / QwKzL — Input/TextSuffix instance (0cT2B) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderRadius: 12,
          background: isWarm ? "#FFFFFFB8" : "#FFFFFFCC",
          border: `1px solid ${isWarm ? "#F3D28B" : "#E5E7EB"}`,
          width: "100%",
          boxSizing: "border-box"
        }}
      >
        <span style={{ fontSize: 24, fontWeight: 800, color: "#1A1A1A", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: isWarm ? "#A16207" : "#6B7280",
            lineHeight: 1
          }}
        >
          {suffix}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
 * FooterRow — aCOWE / I6SsL5 / Jvg0I shared row shape.
 * ============================================================ */

function FooterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px",
        borderRadius: 16,
        background: "#F6F7F8",
        width: "100%",
        gap: 10,
        boxSizing: "border-box"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A", lineHeight: 1 }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

/* ============================================================
 * DropdownFit — Input/Dropdown Frjkw in fit-width context.
 *   Used inline within a space-between row, sized to its content.
 * ============================================================ */

function DropdownFit({ value }: { value: string }) {
  return (
    <button
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 12,
        background: "#FFFFFFCC",
        border: "1px solid #E5E7EB",
        fontFamily: "var(--font-maoken)",
        cursor: "pointer",
        boxSizing: "border-box"
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A", lineHeight: 1 }}>{value}</span>
      <ChevronDownIcon />
    </button>
  );
}

function ChevronDownIcon() {
  // lucide `chevron-down` 18×18 #6B7280 — 3P2uj
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6B7280"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function FolderIcon() {
  // lucide `folder` 16×16 #6B7280 — YQwLD
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6B7280"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}
