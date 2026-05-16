"use client";

/**
 * Clock — pixel-exact port of Pencil node `nNt9z` (cont - clock - component).
 *
 * Pencil structure (group, 78×78):
 *   mMujP  clock-ring-track:    ellipse 78×78, innerRadius 0.77, fill $clock-ring-bg
 *   wL5fP  clock-state-label:   text 78×18 at (0, 44), 13px medium MaokenAssortedSans, $clock-label-color
 *   mo62i  clock-time-value:    text 50×18 at (14, 21), 17px medium MaokenAssortedSans, #5B4636
 *   CeG66  clock-ring-progress: ellipse 78×78, innerRadius 0.77, fill $clock-ring-progress,
 *                                startAngle 90, sweepAngle -270 (i.e. preview shows 75% sweep CW from 12)
 *
 * Ring math:
 *   outerR = 39, innerR = 39 × 0.77 ≈ 30.03 → strokeWidth ≈ 8.97
 *   SVG stroke center radius = (outerR + innerR) / 2 ≈ 34.5
 */

export type ClockState = "focus" | "rest" | "off" | "paused";

const STATE_LABELS: Record<ClockState, string> = {
  focus: "专注中",
  rest: "休息中",
  off: "未开始",
  paused: "暂停中"
};

const DESIGN_SIZE = 78;
const INNER_RATIO = 0.77;

export type ClockProps = {
  state?: ClockState;
  time?: string;
  /** progress 0..1; default 0.75 matches the Pencil preview sweep (-270°) */
  progress?: number;
  size?: number;
  className?: string;
};

export function Clock({
  state = "focus",
  time = "24:18",
  progress = 0.75,
  size = DESIGN_SIZE,
  className
}: ClockProps) {
  const scale = size / DESIGN_SIZE;
  const center = DESIGN_SIZE / 2;
  const outerR = center;
  const innerR = outerR * INNER_RATIO;
  const strokeWidth = outerR - innerR;
  const strokeR = (outerR + innerR) / 2;

  const circumference = 2 * Math.PI * strokeR;
  const safeProgress = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - safeProgress);

  return (
    <div
      className={["relative shrink-0", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
      aria-label={`${STATE_LABELS[state]} ${time}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${DESIGN_SIZE} ${DESIGN_SIZE}`}
        className="absolute inset-0"
        aria-hidden="true"
      >
        {/* mMujP — ring track */}
        <circle
          cx={center}
          cy={center}
          r={strokeR}
          fill="none"
          stroke={`var(--clock-ring-bg-${state})`}
          strokeWidth={strokeWidth}
        />
        {/* CeG66 — progress arc, starts at 12 o'clock, CW */}
        {safeProgress > 0 && (
          <circle
            cx={center}
            cy={center}
            r={strokeR}
            fill="none"
            stroke={`var(--clock-ring-progress-${state})`}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
      </svg>

      {/* mo62i — time text: 50×18 at design (14, 21) */}
      <div
        style={{
          position: "absolute",
          left: 14 * scale,
          top: 21 * scale,
          width: 50 * scale,
          height: 18 * scale,
          textAlign: "center",
          lineHeight: `${18 * scale}px`,
          fontFamily: "var(--font-maoken)",
          fontSize: 17 * scale,
          fontWeight: 500,
          color: "#5B4636"
        }}
      >
        {time}
      </div>

      {/* wL5fP — state label: 78×18 at design (0, 44) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 44 * scale,
          width: 78 * scale,
          height: 18 * scale,
          textAlign: "center",
          lineHeight: `${18 * scale}px`,
          fontFamily: "var(--font-maoken)",
          fontSize: 13 * scale,
          fontWeight: 500,
          color: `var(--clock-label-color-${state})`
        }}
      >
        {STATE_LABELS[state]}
      </div>
    </div>
  );
}
