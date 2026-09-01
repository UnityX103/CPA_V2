const token = new URLSearchParams(location.search).get('token') || '';
const fileInput = document.querySelector('#video-file');
const sourceVideo = document.querySelector('#source-video');
const sourceStage = sourceVideo.closest('.video-stage');
const resultVideo = document.querySelector('#result-video');
const subjectAutoButton = document.querySelector('#subject-mode-auto');
const subjectPointButton = document.querySelector('#subject-mode-point');
const subjectMarker = document.querySelector('#subject-marker');
const subjectSelectionStatus = document.querySelector('#subject-selection-status');
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
const resetMattingParametersButton = document.querySelector('#reset-matting-parameters');

const DEFAULT_MATTING_PARAMETERS = Object.freeze({
  backgroundCutoff: 0,
  seedThreshold: 0.5,
  coreThreshold: 0.35,
  supportRadius: 30,
  featherSigma: 5,
});
const parameterBindings = [
  ['backgroundCutoff', '#background-cutoff', '#background-cutoff-value'],
  ['seedThreshold', '#seed-threshold', '#seed-threshold-value'],
  ['coreThreshold', '#core-threshold', '#core-threshold-value'],
  ['supportRadius', '#support-radius', '#support-radius-value'],
  ['featherSigma', '#feather-sigma', '#feather-sigma-value'],
].map(([key, rangeSelector, numberSelector]) => ({
  key,
  range: document.querySelector(rangeSelector),
  number: document.querySelector(numberSelector),
}));

let uploadId = '';
let sourceProbe = null;
let sourceObjectUrl = '';
let resultObjectUrl = '';
let subjectMode = 'auto';
let subjectPoint = null;

for (const binding of parameterBindings) {
  binding.range.addEventListener('input', () => { binding.number.value = binding.range.value; });
  binding.number.addEventListener('input', () => {
    if (binding.number.value !== '') binding.range.value = binding.number.value;
  });
}
resetMattingParametersButton.addEventListener('click', resetMattingParameters);
subjectAutoButton.addEventListener('click', () => setSubjectMode('auto'));
subjectPointButton.addEventListener('click', () => setSubjectMode('point'));
sourceVideo.addEventListener('click', selectSubjectPoint);
resetMattingParameters();
setSubjectMode('auto');

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
  subjectPoint = null;
  setSubjectMode('auto');
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

function setSubjectMode(mode) {
  subjectMode = mode;
  const automatic = mode === 'auto';
  subjectAutoButton.classList.toggle('active', automatic);
  subjectPointButton.classList.toggle('active', !automatic);
  subjectAutoButton.setAttribute('aria-pressed', String(automatic));
  subjectPointButton.setAttribute('aria-pressed', String(!automatic));
  sourceStage.classList.toggle('point-selection-active', !automatic);
  subjectMarker.classList.toggle('hidden', automatic || !subjectPoint);
  if (automatic) {
    subjectSelectionStatus.textContent = '自动选择清晰主体帧，无需手动操作。';
  } else if (subjectPoint) {
    subjectSelectionStatus.textContent = `已在 ${subjectPoint.timeSeconds.toFixed(3)} 秒点选主体；再次点击可调整。`;
  } else {
    subjectSelectionStatus.textContent = '请暂停在清晰画面，并点击目标动物。';
  }
}

function selectSubjectPoint(event) {
  if (subjectMode !== 'point' || !sourceVideo.videoWidth || !sourceVideo.videoHeight) return;
  const bounds = sourceVideo.getBoundingClientRect();
  const videoAspect = sourceVideo.videoWidth / sourceVideo.videoHeight;
  const elementAspect = bounds.width / bounds.height;
  let contentWidth = bounds.width;
  let contentHeight = bounds.height;
  let offsetX = 0;
  let offsetY = 0;
  if (elementAspect > videoAspect) {
    contentWidth = bounds.height * videoAspect;
    offsetX = (bounds.width - contentWidth) / 2;
  } else {
    contentHeight = bounds.width / videoAspect;
    offsetY = (bounds.height - contentHeight) / 2;
  }
  const localX = event.clientX - bounds.left - offsetX;
  const localY = event.clientY - bounds.top - offsetY;
  if (localX < 0 || localY < 0 || localX > contentWidth || localY > contentHeight) return;
  subjectPoint = {
    x: localX / contentWidth,
    y: localY / contentHeight,
    timeSeconds: sourceVideo.currentTime,
    markerX: (offsetX + localX) / bounds.width,
    markerY: (offsetY + localY) / bounds.height,
  };
  subjectMarker.style.left = `${subjectPoint.markerX * 100}%`;
  subjectMarker.style.top = `${subjectPoint.markerY * 100}%`;
  subjectMarker.classList.remove('hidden');
  setSubjectMode('point');
}

function resetMattingParameters() {
  for (const binding of parameterBindings) {
    const value = DEFAULT_MATTING_PARAMETERS[binding.key];
    binding.range.value = String(value);
    binding.number.value = String(value);
  }
}

function readMattingParameters() {
  return Object.fromEntries(parameterBindings.map((binding) => [binding.key, Number(binding.number.value)]));
}

function readSubjectSelection() {
  if (subjectMode === 'auto') return { mode: 'auto' };
  if (!subjectPoint) throw new Error('请先在源视频当前帧点击要保留的动物');
  return {
    mode: 'point',
    x: subjectPoint.x,
    y: subjectPoint.y,
    timeSeconds: subjectPoint.timeSeconds,
  };
}

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
        subjectSelection: readSubjectSelection(),
        mattingParameters: readMattingParameters(),
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
  subjectAutoButton.disabled = busy;
  subjectPointButton.disabled = busy;
  resetMattingParametersButton.disabled = busy;
  for (const binding of parameterBindings) {
    binding.range.disabled = busy;
    binding.number.disabled = busy;
  }
}

function resetError() {
  errorPanel.classList.add('hidden');
  errorPanel.textContent = '';
}

function showError(error) {
  errorPanel.textContent = error instanceof Error ? error.message : String(error);
  errorPanel.classList.remove('hidden');
}
