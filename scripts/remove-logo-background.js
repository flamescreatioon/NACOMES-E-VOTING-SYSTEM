/**
 * Removes baked-in checkerboard / white background from absu-logo.png.
 * Uses flood-fill from image edges so white text inside the shield is preserved.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const logoPath = path.join(__dirname, '..', 'public', 'assets', 'images', 'absu-logo.png');

function isBackgroundPixel(r, g, b, a) {
  if (a < 10) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  const avg = (r + g + b) / 3;
  if (avg >= 175 && spread <= 45) return true;
  if (r >= 248 && g >= 248 && b >= 248) return true;
  return false;
}

function removeBackground(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = [];

  const pushIfBg = (x, y) => {
    const i = y * width + x;
    if (visited[i]) return;
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (!isBackgroundPixel(r, g, b, a)) return;
    visited[i] = 1;
    queue.push(i);
  };

  for (let x = 0; x < width; x++) {
    pushIfBg(x, 0);
    pushIfBg(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushIfBg(0, y);
    pushIfBg(width - 1, y);
  }

  while (queue.length) {
    const i = queue.pop();
    const x = i % width;
    const y = (i - x) / width;
    data[i * 4 + 3] = 0;

    if (x > 0) pushIfBg(x - 1, y);
    if (x < width - 1) pushIfBg(x + 1, y);
    if (y > 0) pushIfBg(x, y - 1);
    if (y < height - 1) pushIfBg(x, y + 1);
  }
}

async function main() {
  const { data, info } = await sharp(logoPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  removeBackground(data, info.width, info.height);

  const transparent = data.filter((_, i) => i % 4 === 3 && data[i] === 0).length;
  const total = info.width * info.height;

  const tempPath = logoPath + '.tmp.png';
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(tempPath);
  fs.renameSync(tempPath, logoPath);

  console.log(`✅ Logo background removed: ${logoPath}`);
  console.log(`   Size: ${info.width}x${info.height}, transparent pixels: ${transparent}/${total} (${Math.round((transparent / total) * 100)}%)`);
}

main().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
