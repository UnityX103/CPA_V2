export type ClockState = "focus" | "rest" | "off" | "paused";

export type ClockTheme = {
  label: string;
  labelColor: string;
  valueColor: string;
  ringBackground: string;
  ringForeground: string;
  /** default progress for this state (0–1) */
  defaultProgress: number;
};

export const CLOCK_THEMES: Record<ClockState, ClockTheme> = {
  focus: {
    label: "专注中",
    labelColor: "var(--clock-label-color-focus)",
    valueColor: "#5B4636",
    ringBackground: "var(--clock-ring-bg-focus)",
    ringForeground: "var(--clock-ring-progress-focus)",
    defaultProgress: 0.75
  },
  rest: {
    label: "休息中",
    labelColor: "var(--clock-label-color-rest)",
    valueColor: "#1D6B35",
    ringBackground: "var(--clock-ring-bg-rest)",
    ringForeground: "var(--clock-ring-progress-rest)",
    defaultProgress: 0.75
  },
  off: {
    label: "未开始",
    labelColor: "var(--clock-label-color-off)",
    valueColor: "#5B4636",
    ringBackground: "var(--clock-ring-bg-off)",
    ringForeground: "var(--clock-ring-progress-off)",
    defaultProgress: 0
  },
  paused: {
    label: "暂停中",
    labelColor: "var(--clock-label-color-paused)",
    valueColor: "#5B4636",
    ringBackground: "var(--clock-ring-bg-paused)",
    ringForeground: "var(--clock-ring-progress-paused)",
    defaultProgress: 0.5
  }
};

export type ClockProps = {
  state?: ClockState;
  time?: string;
  label?: string;
  /** Progress ratio 0–1. Defaults to ClockTheme.defaultProgress. */
  progress?: number;
  size?: number;
  className?: string;
};

// Design constants derived from the Pencil component (104×104 canvas):
//   outerRadius = 52, innerRadius = 52 × 0.77 ≈ 40
//   strokeWidth = outerRadius − innerRadius ≈ 12
//   ringRadius   = (outerRadius + innerRadius) / 2 ≈ 46
const DESIGN_SIZE = 104;
const INNER_RATIO = 0.77;

export function Clock({
  state = "focus",
  time = "24:18",
  label,
  progress,
  size = DESIGN_SIZE,
  className
}: ClockProps) {
  const theme = CLOCK_THEMES[state];
  const resolvedProgress = Math.max(0, Math.min(1, progress ?? theme.defaultProgress));

  const scale = size / DESIGN_SIZE;
  const cx = DESIGN_SIZE / 2;              // 52
  const cy = DESIGN_SIZE / 2;              // 52
  const outerR = cx;                        // 52
  const innerR = outerR * INNER_RATIO;      // ≈ 40
  const strokeWidth = outerR - innerR;      // ≈ 12
  const ringR = (outerR + innerR) / 2;      // ≈ 46

  const circumference = 2 * Math.PI * ringR;
  const dashOffset = circumference * (1 - resolvedProgress);

  // Inner circle inset (fills the hollow centre with page background)
  const innerInset = Math.round(size * INNER_RATIO * 0.5) * 2; // diameter in px
  const innerDiameter = Math.round(innerR * 2 * scale);
  const innerOffset = Math.round((size - innerDiameter) / 2);

  return (
    <div
      className={["relative shrink-0", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
      aria-label={label ?? theme.label}
    >
      {/* SVG ring */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${DESIGN_SIZE} ${DESIGN_SIZE}`}
        className="absolute inset-0"
        aria-hidden="true"
      >
        {/* track */}
        <circle
          cx={cx}
          cy={cy}
          r={ringR}
          fill="none"
          stroke={theme.ringBackground}
          strokeWidth={strokeWidth}
        />
        {/* progress arc — starts at 12 o'clock, goes clockwise */}
        {resolvedProgress > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={ringR}
            fill="none"
            stroke={theme.ringForeground}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
      </svg>

      {/* Inner "hole" — uses page background so it feels transparent */}
      <div
        className="absolute rounded-full bg-[#FFFEFD]"
        style={{
          width: innerDiameter,
          height: innerDiameter,
          top: innerOffset,
          left: innerOffset
        }}
      />

      {/* Text content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[5px]">
        <span
          className="font-[family:var(--font-maoken)] font-medium leading-none"
          style={{
            fontSize: Math.round(25 * scale),
            color: theme.valueColor
          }}
        >
          {time}
        </span>
        <span
          className="font-[family:var(--font-maoken)] font-medium leading-none"
          style={{
            fontSize: Math.round(13 * scale),
            color: theme.labelColor
          }}
        >
          {label ?? theme.label}
        </span>
      </div>
    </div>
  );
}
