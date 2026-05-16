"use client";

/**
 * PlayerCard — pixel-exact port of Pencil node `drqFB`.
 *
 * Pencil structure (reusable frame, 153×94, padding 14, radius 20, fill #FFFDFBF2, clip true):
 *   D3ZIc pc-content-stack  layout vertical, gap 12, width fill_container
 *     tyyE3 head            layout horizontal, gap 10, align center, width fill
 *       MHhxc nameCol       layout vertical, gap 4, width fill
 *         1JKIJ name        "远端玩家" 14px bold #5B4636
 *         UPUHf phaseBadge  padding [3,8], radius 999, fill (phase-themed), gap 5, clip true
 *           do3Bz dot       6×6 ellipse #FFFFFF
 *           ResRN phaseLabel  radius 999, transparent — contains "专注中" small white label
 *       oCExj timeRow       justify end
 *         j5TxSG KeyCounterPill (h31Sl instance)
 *           padding [4,8], radius 999, fill #FFF3EA, stroke 1 #EFDCCD, gap 5
 *           hpLOf keyBadge  padding [1,4], radius 3, fill #FFF, stroke 1 #EFDCCD, "Space" 9px bold #5B4636
 *           nSraL keyCount  "47" 11px bold #A28B79
 *     cnbrI divider         1px #F3E3D3, width fill
 *     cwbeK footer          layout horizontal, gap 6, align center, width fill
 *       KN0dX footIcon      lucide app-window 13×13 #B5A49A
 *       rFcKx footText      "VS Code" 11px medium #A28B79
 *     epxz9 pc-pin-btn      ABSOLUTE within D3ZIc at (110, 50), 22×22, radius 11,
 *                           fill #E9D5C3 (override of cM79C base), icon #7A5F4D
 *                           (Right edge 132 vs D3ZIc width 125: design intentionally overflows
 *                            content stack into card padding; drqFB's clip:true keeps it inside card.)
 */

export type PhaseKey = "focus" | "rest" | "paused" | "completed" | "waiting";

const PHASES: Record<PhaseKey, { bg: string; label: string }> = {
  focus:     { bg: "#D15F3D", label: "专注中" },
  rest:      { bg: "#34A853", label: "休息中" },
  paused:    { bg: "#E08C10", label: "已暂停" },
  completed: { bg: "#6366F1", label: "已完成" },
  waiting:   { bg: "#B5A49A", label: "待加入" }
};

export type PlayerCardProps = {
  name?: string;
  phase?: PhaseKey;
  keyLabel?: string;
  keyCount?: number;
  appName?: string;
  className?: string;
};

export function PlayerCard({
  name = "远端玩家",
  phase = "focus",
  keyLabel = "Space",
  keyCount = 47,
  appName = "VS Code",
  className
}: PlayerCardProps) {
  const theme = PHASES[phase];

  return (
    <div
      className={["preview-frame", className].filter(Boolean).join(" ")}
      style={{
        position: "relative",
        width: 153,
        height: 94,
        padding: 14,
        borderRadius: 20,
        background: "#FFFDFBF2",
        border: "1px solid #EFDCCD",
        overflow: "hidden",
        boxSizing: "border-box",
        fontFamily: "var(--font-maoken)"
      }}
    >
      {/* D3ZIc — pc-content-stack */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: "100%"
        }}
      >
        {/* tyyE3 — head */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 10,
            alignItems: "center",
            width: "100%"
          }}
        >
          {/* MHhxc — nameCol */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#5B4636",
                lineHeight: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {name}
            </span>

            {/* UPUHf — phaseBadge */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 999,
                background: theme.bg,
                alignSelf: "flex-start",
                lineHeight: 1,
                overflow: "hidden"
              }}
            >
              {/* do3Bz — dot */}
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#FFFFFF",
                  display: "inline-block",
                  flexShrink: 0
                }}
              />
              {/* ResRN phaseLabel — small white label */}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#FFFFFF",
                  lineHeight: 1
                }}
              >
                {theme.label}
              </span>
            </span>
          </div>

          {/* oCExj — timeRow */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexShrink: 0 }}>
            {/* j5TxSG — KeyCounterPill */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 8px",
                borderRadius: 999,
                background: "#FFF3EA",
                border: "1px solid #EFDCCD",
                lineHeight: 1
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
          </div>
        </div>

        {/* cnbrI — divider */}
        <div style={{ height: 1, width: "100%", background: "#F3E3D3" }} />

        {/* cwbeK — footer */}
        <div style={{ display: "flex", flexDirection: "row", gap: 6, alignItems: "center", width: "100%" }}>
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

        {/* epxz9 — pc-pin-btn (absolute, intentionally overflows D3ZIc) */}
        <button
          type="button"
          aria-label="置顶"
          style={{
            position: "absolute",
            left: 110,
            top: 50,
            width: 22,
            height: 22,
            borderRadius: 11,
            background: "#E9D5C3",
            border: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#7A5F4D",
            cursor: "pointer",
            boxSizing: "border-box",
            padding: 0
          }}
        >
          <PinIcon />
        </button>
      </div>
    </div>
  );
}

function AppWindowIcon() {
  // lucide `app-window` 13×13 #B5A49A — KN0dX
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
  // lucide `pin` 14×14 #7A5F4D (color via currentColor on parent)
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ display: "block" }} aria-hidden="true">
      <path d="M14 4v5l3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3V4h-1V2h8v2h-1z" />
    </svg>
  );
}
