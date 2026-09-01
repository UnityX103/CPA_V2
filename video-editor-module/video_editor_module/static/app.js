const token = new URLSearchParams(location.search).get('token') || '';
const fileInput = document.querySelector('#video-file');
const sourceVideo = document.querySelector('#source-video');
const resultVideo = document.querySelector('#result-video');
const screenshotButton = document.querySelector('#screenshot-button');
const processButton = document.querySelector('#process-button');
const startInput = document.querySelector('#start-seconds');
const endInput = document.querySelector('#end-seconds');
const widthInput = document.querySelector('#output-width');
const heightInput = document.querySelector('#output-height');
const presetInput = document.querySelector('#resolution-preset');
const sourceMeta = document.querySelector('#source-meta');
const resultMeta = document.querySelector('#result-meta');
const progressPanel = document.querySelector('#progress-panel');
const progressFill = document.querySelector('#progress-fill');
const progressText = document.querySelector('#progress-text');
const errorPanel = document.querySelector('#error-panel');
const downloadOutput = document.querySelector('#download-output');

let uploadId = '';
let sourceProbe = null;
let sourceObjectUrl = '';
let resultObjectUrl = '';

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-CPA-Module-Token', token);
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response;
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  resetError();
  processButton.disabled = true;
  screenshotButton.disabled = true;
  if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  sourceObjectUrl = URL.createObjectURL(file);
  sourceVideo.src = sourceObjectUrl;
  sourceMeta.textContent = '正在上传并读取视频…';
  try {
    const upload = await api(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    }).then((response) => response.json());
    uploadId = upload.id;
    sourceProbe = await api(`/api/probe?id=${uploadId}`).then((response) => response.json());
    sourceMeta.textContent = `${sourceProbe.width} × ${sourceProbe.height} · ${sourceProbe.durationSeconds.toFixed(2)} 秒 · ${sourceProbe.frameRate.toFixed(2)} FPS`;
    applySourceDefaults();
    processButton.disabled = false;
    screenshotButton.disabled = false;
  } catch (error) {
    showError(error);
    sourceMeta.textContent = '视频读取失败';
  }
});

presetInput.addEventListener('change', () => applyResolutionPreset(presetInput.value));
widthInput.addEventListener('input', () => { presetInput.value = 'custom'; });
heightInput.addEventListener('input', () => { presetInput.value = 'custom'; });

function applySourceDefaults() {
  const duration = Number(sourceProbe.durationSeconds);
  startInput.value = '0';
  startInput.max = String(duration);
  endInput.value = String(duration);
  endInput.max = String(duration);
  applyResolutionPreset('original');
}

function applyResolutionPreset(preset) {
  if (!sourceProbe) return;
  presetInput.value = preset;
  if (preset === 'original') {
    widthInput.value = sourceProbe.width;
    heightInput.value = sourceProbe.height;
    return;
  }
  if (preset === '720' || preset === '1080') {
    const longest = Number(preset);
    const scale = longest / Math.max(sourceProbe.width, sourceProbe.height);
    widthInput.value = even(Math.round(sourceProbe.width * scale));
    heightInput.value = even(Math.round(sourceProbe.height * scale));
  }
}

function even(value) { return Math.max(2, value - (value % 2)); }

screenshotButton.addEventListener('click', () => {
  if (!sourceVideo.videoWidth || !sourceVideo.videoHeight) return;
  const canvas = document.createElement('canvas');
  canvas.width = sourceVideo.videoWidth;
  canvas.height = sourceVideo.videoHeight;
  canvas.getContext('2d').drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `video-frame-${sourceVideo.currentTime.toFixed(3)}s.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});

processButton.addEventListener('click', async () => {
  if (!uploadId || !sourceProbe) return;
  resetError();
  setBusy(true);
  try {
    const job = await api('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId,
        startSeconds: Number(startInput.value),
        endSeconds: Number(endInput.value),
        outputWidth: even(Number(widthInput.value) || sourceProbe.width),
        outputHeight: even(Number(heightInput.value) || sourceProbe.height),
      }),
    }).then((response) => response.json());
    await pollJob(job.id);
  } catch (error) {
    showError(error);
    setBusy(false);
  }
});

async function pollJob(id) {
  while (true) {
    const job = await api(`/api/job?id=${id}`).then((response) => response.json());
    progressPanel.classList.remove('hidden');
    progressFill.style.width = `${job.percent}%`;
    progressText.textContent = `${job.message} · ${job.percent}%`;
    if (job.status === 'error') throw new Error(job.error || job.message);
    if (job.status === 'complete') {
      const outputUrl = `/api/output?id=${id}&token=${encodeURIComponent(token)}`;
      const previewUrl = `/api/preview?id=${id}&token=${encodeURIComponent(token)}`;
      if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
      const blob = await api(previewUrl).then((response) => response.blob());
      resultObjectUrl = URL.createObjectURL(blob);
      resultVideo.src = resultObjectUrl;
      resultMeta.textContent = `${widthInput.value} × ${heightInput.value} · VP8 Alpha WebM`;
      downloadOutput.href = outputUrl;
      downloadOutput.classList.remove('disabled');
      downloadOutput.setAttribute('aria-disabled', 'false');
      setBusy(false);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

function setBusy(busy) {
  processButton.disabled = busy || !uploadId;
  fileInput.disabled = busy;
  presetInput.disabled = busy;
  widthInput.disabled = busy;
  heightInput.disabled = busy;
  startInput.disabled = busy;
  endInput.disabled = busy;
}

function resetError() {
  errorPanel.classList.add('hidden');
  errorPanel.textContent = '';
}

function showError(error) {
  errorPanel.textContent = error instanceof Error ? error.message : String(error);
  errorPanel.classList.remove('hidden');
}
