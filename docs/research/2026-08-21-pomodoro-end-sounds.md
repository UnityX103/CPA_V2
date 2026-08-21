# Pomodoro end-sound candidates

Date: 2026-08-21

## Decision summary

- **Recommended focus-end default:** **Clear Success** — `GASP_Chimes_Success_4.wav` by Rob_Marion. It is a short stereo chime explicitly described as indicating a successful interaction, so it reads as completion/reward without sounding like an error.
- **Recommended break-end default:** **Triple Ping** — `Triple_Ping_Notification_Sound_Mobile_Optimized` by PiesHelpfulOven. Its three-note pattern was designed to remain audible on small speakers and in noisy environments, making it a clearer “return now” cue than a single soft chime.
- All primary candidates below are marked **Creative Commons Zero (CC0)** on their individual Freesound pages. Under CC0, copying, modifying, commercial use, and redistribution are allowed without required attribution. See the [CC0 1.0 deed](https://creativecommons.org/publicdomain/zero/1.0/) and [Freesound licensing FAQ](https://freesound.org/help/faq/#licenses-0).
- CC0 does not remove every possible third-party right, and Freesound warns that user-uploaded material can occasionally be incorrectly licensed. Favor sounds whose author describes a self-created synthesis workflow, save a dated copy of the sound page/license at acquisition time, and keep the original downloaded filename with a source manifest.

## Focus-end candidates

These options aim for a positive, completed, or rewarded feeling. They should be distinct from the more attention-seeking break-end cue.

| Priority | Proposed settings label | Source and preview | Author/platform | Original format and duration | License / attribution | Why it fits | Risk or caveat |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Recommended** | **Clear Success / 清澈完成** | [`GASP_Chimes_Success_4.wav`](https://freesound.org/people/Rob_Marion/sounds/541985/) · [MP3 preview](https://cdn.freesound.org/previews/541/541985_6856600-lq.mp3) | Rob_Marion / Freesound | WAV, stereo, 1.588 s | CC0; no attribution required | The author explicitly describes it as a sound for a successful interaction or moment. Short enough for repeated Pomodoro use, but longer and more affirmative than an ordinary UI click. | The description does not document the exact synthesis chain. Keep the page/license snapshot with the downloaded original. |
| Alternative | **Light Success / 轻盈成功** | [`Success.mp3`](https://freesound.org/people/oysterqueen/sounds/582988/) · [MP3 preview](https://cdn.freesound.org/previews/582/582988_13153333-lq.mp3) | oysterqueen / Freesound | MP3, stereo, 2.052 s | CC0; no attribution required | Designed as a positive success/connection notification; its two-second tail gives the end of a focus block a little more ceremony. | The author provides little production provenance. Also verify that the encoded MP3 has no excessive silence before bundling. |
| Alternative | **Glockenspiel Reward / 木琴奖励** | [`Short Success Sound Glockenspiel Treasure Video Game.mp3`](https://freesound.org/people/FunWithSound/sounds/456965/) · [MP3 preview](https://cdn.freesound.org/previews/456/456965_6456158-lq.mp3) | FunWithSound / Freesound | MP3, stereo, 2.485 s | CC0; no attribution required | A melodic glockenspiel success cue gives the strongest reward/achievement character of the focus-end group. | The game-like “treasure” character may be too playful for users who want a quiet productivity tool. The author says it was made with MuseScore, so retain the license snapshot and confirm the downloaded file before shipping. |
| Alternative | **High Bell Approval / 高铃认可** | [`[UI Sound] Approval - High Pitched Bell Synth`](https://freesound.org/people/GabFitzgerald/sounds/625174/) · [MP3 preview](https://cdn.freesound.org/previews/625/625174_13251199-lq.mp3) | GabFitzgerald / Freesound | WAV, stereo, 0.774 s | CC0; no attribution required | A very compact synthesized approval sound; useful as a low-interruption option when the video prompt already supplies the main visual reward. | High pitch can become tiring at high volume. Loudness normalization and listening tests on laptop speakers are important. |

## Break-end candidates

These options prioritize noticeability and a clear return-to-focus signal. They should not sound as rewarding as the focus-end cue.

| Priority | Proposed settings label | Source and preview | Author/platform | Original format and duration | License / attribution | Why it fits | Risk or caveat |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Recommended** | **Triple Ping / 三连提示** | [`Triple_Ping_Notification_Sound_Mobile_Optimized`](https://freesound.org/people/PiesHelpfulOven/sounds/842513/) · [MP3 preview](https://cdn.freesound.org/previews/842/842513_14031674-lq.mp3) | PiesHelpfulOven / Freesound | WAV, stereo, 0.969 s | CC0; no attribution required | A three-note E6-G6-C7 notification intentionally optimized for small speakers and noisy environments. The repeated contour is easier to notice as “break over” without needing a long alarm loop. | This is the brightest option and may feel sharp to sound-sensitive users. Ship at a conservative normalized level and expose volume/off controls. |
| Alternative | **Mid-Bass Notice / 中低音通知** | [`Notification_2.wav`](https://freesound.org/people/Wax_vibe/sounds/554554/) · [MP3 preview](https://cdn.freesound.org/previews/554/554554_12197619-lq.mp3) | Wax_vibe / Freesound | WAV, stereo, 0.914 s | CC0; no attribution required | The author describes it as a mid-bass notification made in FL Studio. It provides a less piercing return cue than the triple ping while remaining under one second. | Its science-fiction tone may not match the current pet aesthetic. Test it beside the built-in “千千” video rather than in isolation. |
| Alternative | **Vintage Alarm / 复古闹铃** | [`Alarm 3_1.wav`](https://freesound.org/people/Joao_Janz/sounds/478294/) · [MP3 preview](https://cdn.freesound.org/previews/478/478294_9961300-lq.mp3) | Joao_Janz / Freesound | WAV, stereo, 1.875 s | CC0; no attribution required | An alarm-style cue made with a Yamaha PSR-36 and processed by the author. It is the most explicit “time to return” option and useful for users who miss softer notifications. | More insistent and potentially fatiguing than the other choices. It should be an opt-in alternative, not the default. “Yamaha” is only production provenance and should not appear in the in-app label. |

## Licensing and acquisition notes

1. Download the **original file** from each selected sound page after signing in to Freesound. The CDN MP3 links above are convenient listening previews, not the artifact to redistribute.
2. At download time, store a small manifest beside the bundled assets containing sound ID, source URL, author, original filename, acquisition date, license (`CC0-1.0`), and the downloaded file SHA-256.
3. Save a PDF or HTML snapshot of the individual sound page and the CC0 deed. CC0 does not require attribution, but retaining provenance makes later release audits much easier.
4. Normalize loudness and trim silence as a derivative asset only after the originals and their hashes are archived. Use lossless WAV as the working source when offered; encode the shipping format in a reproducible build step.
5. Do not use a single sound for both transitions. The recommended pair deliberately separates a warm success chime from a brighter three-ping return cue.

## Suggested settings model for the Pencil proposal

This research does not modify Pencil or application code. It gives the settings design a concrete content model:

- `专注结束声音`: `关闭` / `清澈完成（内置）` / other built-in candidates / `自定义 MP3`
- `休息结束声音`: `关闭` / `三连提示（内置）` / other built-in candidates / `自定义 MP3`
- Each `自定义 MP3` choice reveals its own local-path row and file-picker action. Focus and break paths must remain independent.
- Consider one shared `提示音量` control only if the current settings layout has room; otherwise use system/media volume for the first iteration.

## Primary sources

- [Creative Commons: CC0 1.0 Universal deed](https://creativecommons.org/publicdomain/zero/1.0/)
- [Creative Commons: CC0 1.0 legal code](https://creativecommons.org/publicdomain/zero/1.0/legalcode)
- [Freesound licensing FAQ](https://freesound.org/help/faq/#licenses-0)
- The seven individual Freesound sound pages linked in the tables above; each page is the first-party platform record for its uploader, file metadata, and selected license.
