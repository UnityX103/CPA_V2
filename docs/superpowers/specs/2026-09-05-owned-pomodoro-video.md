# App-owned custom prompt video

Selecting a custom WebM imports it into the app data directory at
`media/pomodoro-end/提示视频.webm`. The picker returns this owned path, so the existing settings
Apply/persistence flow stores the copy instead of the original external path.

The slot has a stable name. Selecting a replacement immediately replaces its contents after a
complete copy and successful atomic rename; any settings already using that slot stay valid.
Only this owned copy is replaced. The original user-selected files are never deleted.
Cancelling the picker leaves it unchanged. Read/copy/replace failures retain the prior owned file
and remove the staging file. Selecting the owned file itself does not truncate it.

Imports run off the UI thread and serialize with transparent-video conversion. The settings page
shows importing/error state and disables selection and Apply while the import is pending. macOS
invalidates only this source's generated alpha-video cache before importing. Windows plays the
owned WebM directly. Playback gets a unique asset URL to avoid reusing cached bytes at the fixed path.

Legacy external paths remain readable. Re-select an existing video to import it into the owned slot;
no scan or deletion of arbitrary external media is performed.

Verification covers source deletion after import, replacing the slot with only one remaining file,
copy/replace failures, selecting the owned file, targeted cache invalidation, picker cancellation,
error feedback, and storing only the owned path through Apply.
