import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const baseline = resolve('public/dev-align/drqFB.png');
const outHtml = resolve('tmp/player-card-compare.html');

if (!existsSync(baseline))
{
    throw new Error(`Missing baseline image: ${baseline}`);
}

mkdirSync(dirname(outHtml), { recursive: true });
writeFileSync(outHtml, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>PlayerCard compare</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #f8f8f8; }
    .wrap { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
    .pane { display: grid; gap: 8px; }
    .label { font: 12px system-ui; color: #555; }
    iframe { width: 520px; height: 180px; border: 0; background: white; }
    img { width: 153px; height: 94px; image-rendering: auto; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="pane">
      <div class="label">Pencil drqFB</div>
      <img src="../public/dev-align/drqFB.png" alt="Pencil baseline">
    </div>
    <div class="pane">
      <div class="label">Live DevAlign drqFB</div>
      <iframe src="../dist/index.html?window=devalign&target=drqFB&mode=side"></iframe>
    </div>
  </div>
</body>
</html>
`);

console.log(`PlayerCard comparison HTML written to ${outHtml}`);
console.log('Open it after npm run build and inspect Pencil vs live drqFB at 153x94.');
