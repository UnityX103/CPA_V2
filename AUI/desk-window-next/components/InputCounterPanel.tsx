"use client";

/**
 * InputCounterPanel — pixel-exact port of Pencil node `ZmuFh`.
 *
 * Pencil structure (reusable frame, 128 wide × fit_content, padding 14, radius 20,
 * fill #FFFDFBF2, stroke 1 #EFDCCD, clip true, layout vertical, gap 10):
 *
 *   F6JNWl icp-head           layout horizontal (default frame), justify space_between, width fill
 *     gOGPt icp-pill-list     vertical, gap 8, transparent
 *       eRIvt icp-key-counter (h31Sl instance) padding [4,8], radius 999, fill #FFF3EA, stroke 1 #EFDCCD, gap 5
 *         hpLOf keyBadge       padding [1,4], radius 3, fill #FFF, stroke 1 #EFDCCD
 *           YALqq keyLabel    "Space" 9px bold #5B4636
 *         nSraL keyCount      "47"    11px bold #A28B79
 *     iP8E3 icp-pin-btn       frame (NOT absolute, unlike drqFB's pin), 22×22, radius 11,
 *                             fill #F0E0D0, center-aligned pin icon 14×14 #7A5F4D
 *
 *   lMybO icp-divider         1px #F3E3D3, width fill
 *
 *   t4yhPl icp-footer         horizontal, align center, gap 6, width fill
 *     D3edEq icp-app-icon     lucide app-window 13×13 #B5A49A
 *     VLQ4k  icp-app-text     "VS Code" 11px medium #A28B79
 */

export type InputCounterPill = {
  keyLabel: string;
  keyCount: number;
};

export type InputCounterPanelProps = {
  pills?: InputCounterPill[];
  appName?: string;
  className?: string;
};

const DEFAULT_PILLS: InputCounterPill[] = [{ keyLabel: "Space", keyCount: 47 }];

export function InputCounterPanel({
  pills = DEFAULT_PILLS,
  appName = "VS Code",
  className
}: InputCounterPanelProps) {
  return (
    <div
      className={["preview-frame", className].filter(Boolean).join(" ")}
      style={{
        width: 128,
        padding: 14,
        borderRadius: 20,
        background: "#FFFDFBF2",
        border: "1px solid #EFDCCD",
        overflow: "hidden",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontFamily: "var(--font-maoken)"
      }}
    >
      {/* F6JNWl — icp-head */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          width: "100%",
          gap: 6
        }}
      >
        {/* gOGPt — icp-pill-list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pills.map((p, i) => (
            <KeyCounterPill key={i} {...p} />
          ))}
        </div>

        {/* iP8E3 — icp-pin-btn */}
        <button
          type="button"
          aria-label="置顶"
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            background: "#F0E0D0",
            border: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#7A5F4D",
            cursor: "pointer",
            boxSizing: "border-box",
            padding: 0,
            flexShrink: 0
          }}
        >
          <PinIcon />
        </button>
      </div>

      {/* lMybO — icp-divider */}
      <div style={{ height: 1, width: "100%", background: "#F3E3D3" }} />

      {/* t4yhPl — icp-footer */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: "100%" }}>
        <AppWindowIcon />
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "#A28B79",
            lineHeight: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {appName}
        </span>
      </div>
    </div>
  );
}

/**
 * KeyCounterPill — `h31Sl` reusable. Exported so other components (PlayerCard's timeRow,
 * BindingKeyRow, etc.) can share a single pixel-exact implementation.
 */
export function KeyCounterPill({ keyLabel, keyCount }: InputCounterPill) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 8px",
        borderRadius: 999,
        background: "#FFF3EA",
        border: "1px solid #EFDCCD",
        lineHeight: 1,
        fontFamily: "var(--font-maoken)"
      }}
    >
      {/* hpLOf — keyBadge */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1px 4px",
          borderRadius: 3,
          background: "#FFFFFF",
          border: "1px solid #EFDCCD",
          fontSize: 9,
          fontWeight: 700,
          color: "#5B4636",
          lineHeight: 1
        }}
      >
        {keyLabel}
      </span>
      {/* nSraL — keyCount */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#A28B79",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {keyCount}
      </span>
    </span>
  );
}

function AppWindowIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#B5A49A"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M2 10h20M6 7v.01M9 7v.01M12 7v.01" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ display: "block" }} aria-hidden="true">
      <path d="M14 4v5l3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3V4h-1V2h8v2h-1z" />
    </svg>
  );
}
