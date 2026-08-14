# CPA Desktop Pomodoro

CPA is a desktop Pomodoro whose local timer can react to workstation-presence observations without identifying the user or sharing camera-derived data.

## Language

**Workstation Presence（工位在场）**:
At least one face is detected in the current camera sample. It is only a proxy for being at the workstation and does not mean the person is actively working.
_Avoid_: Working status, productivity, identity

**Presence Observation（在场观测）**:
One timestamped camera result classified as Present, Absent, or Unknown.
_Avoid_: Camera frame, attendance record

**Present（在场）**:
A Presence Observation in which at least one face is detected.
_Avoid_: Working, attentive

**Absent（离场）**:
A successful Presence Observation in which no face is detected.
_Avoid_: Taking a break, offline

**Unknown（未知）**:
A Presence Observation that cannot establish Present or Absent because the camera, permission, capture, or detector is unavailable.
_Avoid_: Absent, failure-as-absence

**Presence-Owned Pause（在场检测暂停）**:
A paused focus session whose pause was initiated by presence automation and may therefore be resumed by that automation.
_Avoid_: Manual pause, break

**Manual Pause（手动暂停）**:
A paused timer resulting from explicit user control. Presence automation never resumes it.
_Avoid_: Presence-Owned Pause
