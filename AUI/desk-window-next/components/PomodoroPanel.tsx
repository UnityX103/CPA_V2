"use client";

import { Clock, type ClockState } from "@/components/Clock";

/**
 * PomodoroPanel — pixel-exact port of Pencil node `YRqeB` (pomodoroPanel).
 *
 * Pencil structure (reusable frame, 233×155):
 *   panel YRqeB
 *     padding 12 / cornerRadius 24 / fill #FFFDFBEE / stroke 1 #EFDCCD
 *     gap 5 (panel-level, single child so visually inert)
 *     child BTIJv pp-content
 *       layout vertical / gap 18 / height 121 / width fill_container
 *       S3Nbk head
 *         layout horizontal / justify space_between / align center / width fill_container
 *         TqjjH title:  "番茄钟"  20px bold #5B4636
 *         4qNnO pp-settings-btn (absolute):  x=66 y=3, 37×18, radius 17, fill #F0E0D0,
 *                                            padding [2,0], child cHy9C lucide settings 14×14 #8c5830
 *         XcJUF statBadge:  vertical, gap 1, align end
 *           s6Z5M "连续专注"  9px medium #A28B79
 *           90Tqv "3 次"     14px bold  #D15F3D
 *       DiaNW contentRow
 *         layout horizontal / gap 22 / padding [0,16] / align center / width fill_container
 *         6SX3a clock instance (Clock at 78×78)
 *         p4kgU chipsRow
 *           layout vertical / gap 8 / width fill_container
 *           xBxOF startBtn: padding [7,12], radius 999, fill #D15F3D, label "开始" 12px bold #FFFFFF, width fill
 *           14BjF skipBtn:  padding [7,12], radius 999, fill #FFFFFF, stroke 1 #E8C4A8,
 *                           label "跳过" 12px bold #A28B79, width fill
 *         HApJ0 pp-pin-btn (absolute):  x=193 y=69, 22×22, radius 11, fill #F5D7C3, stroke 1 #E7C6AF
 *                                       child 3eDk5 lucide pin 14×14 #D15F3D
 */

type PomodoroPanelProps = {
  className?: string;
  title?: string;
  streakLabel?: string;
  streakValue?: string;
  time?: string;
  clockState?: ClockState;
  /** clock progress 0..1; default mirrors Pencil preview (0.75) */
  clockProgress?: number;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
};

export function PomodoroPanel({
  className,
  title = "番茄钟",
  streakLabel = "连续专注",
  streakValue = "3 次",
  time = "24:18",
  clockState = "focus",
  clockProgress,
  primaryActionLabel = "开始",
  secondaryActionLabel = "跳过"
}: PomodoroPanelProps) {
  return (
    <section
      className={["preview-frame", className].filter(Boolean).join(" ")}
      style={{
        position: "relative",
        width: 233,
        height: 155,
        padding: 12,
        borderRadius: 24,
        background: "#FFFDFBEE",
        border: "1px solid #EFDCCD",
        boxSizing: "border-box",
        fontFamily: "var(--font-maoken)"
      }}
    >
      {/* BTIJv — pp-content: vertical, gap 18, height 121, width fill */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          height: 121,
          width: "100%"
        }}
      >
        {/* S3Nbk — head: horizontal, justify space_between, align center */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%"
          }}
        >
          {/* TqjjH — title */}
          <span
            style={{
              fontFamily: "var(--font-maoken)",
              fontSize: 20,
              fontWeight: 700,
              color: "#5B4636",
              lineHeight: 1
            }}
          >
            {title}
          </span>

          {/* 4qNnO — pp-settings-btn: absolute within head, x=66 y=3, 37×18 */}
          <button
            type="button"
            aria-label="设置"
            style={{
              position: "absolute",
              left: 66,
              top: 3,
              width: 37,
              height: 18,
              padding: "2px 0",
              borderRadius: 17,
              background: "#F0E0D0",
              border: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#8c5830",
              cursor: "pointer",
              boxSizing: "border-box"
            }}
          >
            <SettingsIcon />
          </button>

          {/* XcJUF — statBadge: vertical, gap 1, align end */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 1,
              fontFamily: "var(--font-maoken)"
            }}
          >
            <span style={{ fontSize: 9, fontWeight: 500, color: "#A28B79", lineHeight: 1 }}>
              {streakLabel}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#D15F3D", lineHeight: 1 }}>
              {streakValue}
            </span>
          </div>
        </div>

        {/* DiaNW — contentRow: horizontal, gap 22, padding [0,16] (right-only per existing app impl), align center */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 22,
            paddingRight: 16,
            flex: 1
          }}
        >
          {/* 6SX3a — clock instance */}
          <Clock state={clockState} time={time} progress={clockProgress} />

          {/* p4kgU — chipsRow: vertical, gap 8, width fill */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              flex: 1,
              minWidth: 0
            }}
          >
            {/* xBxOF — startBtn */}
            <button
              type="button"
              style={{
                padding: "7px 12px",
                borderRadius: 999,
                background: "#D15F3D",
                color: "#FFFFFF",
                fontFamily: "var(--font-maoken)",
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                border: "none",
                cursor: "pointer",
                width: "100%"
              }}
            >
              {primaryActionLabel}
            </button>
            {/* 14BjF — skipBtn */}
            <button
              type="button"
              style={{
                padding: "7px 12px",
                borderRadius: 999,
                background: "#FFFFFF",
                color: "#A28B79",
                fontFamily: "var(--font-maoken)",
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                border: "1px solid #E8C4A8",
                cursor: "pointer",
                width: "100%"
              }}
            >
              {secondaryActionLabel}
            </button>
          </div>

          {/* HApJ0 — pp-pin-btn: absolute within contentRow, design x=193 y=69, 22×22.
              The contentRow has padding-right 16 and width fills pp-content (209). Pin's design
              left edge (193) sits 16px from contentRow right edge (193 = 209-16) BUT the
              design has the pin sized 22 so its right edge actually overflows by 6px — Pencil
              preview clips through panel padding. We honor design coords with left:193. */}
          <button
            type="button"
            aria-label="置顶"
            style={{
              position: "absolute",
              left: 193,
              top: 69,
              width: 22,
              height: 22,
              borderRadius: 11,
              background: "#F5D7C3",
              border: "1px solid #E7C6AF",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#D15F3D",
              cursor: "pointer",
              boxSizing: "border-box"
            }}
          >
            <PinIcon />
          </button>
        </div>
      </div>
    </section>
  );
}

function SettingsIcon() {
  // lucide `settings` rendered at 14×14 to match cHy9C's effective render inside 37×18 pill (padding [2,0])
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PinIcon() {
  // lucide `pin` 14×14 #D15F3D
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ display: "block" }}
    >
      <path d="M14 4v5l3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3V4h-1V2h8v2h-1z" />
    </svg>
  );
}
