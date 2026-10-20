import './style.css';
import { Capacitor } from '@capacitor/core';
import { appMarkup } from './ui';
import { icon } from './icons';
import { shareImage } from './native';
import type { PixelImage, PlanOptions, StitchPlan } from './engine';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = appMarkup;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('file-input');
const canvas = $<HTMLCanvasElement>('output-canvas');
const stitchButton = $<HTMLButtonElement>('stitch-button');
const downloadButton = $<HTMLButtonElement>('download-button');
const shareButton = $<HTMLButtonElement>('share-button');
const autoOrder = $<HTMLInputElement>('auto-order');
const trimBars = $<HTMLInputElement>('trim-bars');
const cropTop = $<HTMLInputElement>('crop-top');
const cropBottom = $<HTMLInputElement>('crop-bottom');
const MAX_INPUT_PIXELS = 20_000_000;
const MAX_OUTPUT_PIXELS = 16_000_000;
const MAX_OUTPUT_HEIGHT = 16384;
const MAX_WIDTH = 1440;
interface Screenshot {
  name: string;
  originalWidth: number;
  originalHeight: number;
  canvas: HTMLCanvasElement;
  thumbnail: string;
}
let screenshots: Screenshot[] = [];
let currentPlan: StitchPlan | null = null;
let outputBlob: Blob | null = null;
let worker: Worker | null = null;
let run = 0;
let busy = false;
let zoom: number | null = null;
let manualOverlaps: Record<number, number> = {};
let showAllJoins = false;
let stopWorker: (() => void) | null = null;

const escapeHTML = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
function notice(message = '', error = false) {
  const el = $('notice');
  el.textContent = message;
  el.hidden = !message;
  el.classList.toggle('error', error);
}
function setBusy(value: boolean, label = 'Finding the perfect fit…') {
  busy = value;
  $('busy-overlay').hidden = !value;
  $('busy-label').textContent = label;
  stitchButton.disabled = value || screenshots.length < 2;
  input.disabled = value;
  autoOrder.disabled = value;
  trimBars.disabled = value;
  cropTop.disabled = value;
  cropBottom.disabled = value;
  $<HTMLButtonElement>('demo-button').disabled = value;
  downloadButton.disabled = value || !outputBlob || !!currentPlan?.needsReview;
  shareButton.disabled = downloadButton.disabled;
  $('drop-zone').setAttribute('aria-disabled', String(value));
}
function cancelWork() {
  run++;
  worker?.terminate();
  worker = null;
  stopWorker?.();
  stopWorker = null;
  setBusy(false);
}
function clearResult() {
  currentPlan = null;
  outputBlob = null;
  canvas.width = canvas.height = 1;
  $('empty-state').hidden = false;
  $('result-wrap').hidden = true;
  $('zoom-controls').hidden = true;
  $('join-review').hidden = true;
  $('preview-stage').classList.remove('has-result');
  $('preview-label').textContent = 'THE BIG PICTURE';
  $('result-status').innerHTML = `${icon('image')}<span>Your stitched image will appear here</span>`;
  downloadButton.disabled = shareButton.disabled = true;
  zoom = null;
}
function renderInputs() {
  $('image-count').textContent = String(screenshots.length);
  $('clear-button').hidden = screenshots.length === 0;
  document.querySelector('.input-panel')!.classList.toggle('has-images', screenshots.length > 0);
  $('image-list').innerHTML = screenshots.map((item, index) => `
    <li class="image-row">
      <img src="${item.thumbnail}" alt="Screenshot ${index + 1} thumbnail">
      <div class="image-row-info"><strong title="${escapeHTML(item.name)}">${index + 1}. ${escapeHTML(item.name)}</strong><small>${item.originalWidth} × ${item.originalHeight}</small></div>
      <div class="row-actions"><button class="icon-button move-image" data-index="${index}" data-direction="-1" aria-label="Move screenshot ${index + 1} up" ${index === 0 || busy ? 'disabled' : ''}>${icon('up')}</button><button class="icon-button move-image" data-index="${index}" data-direction="1" aria-label="Move screenshot ${index + 1} down" ${index === screenshots.length - 1 || busy ? 'disabled' : ''}>${icon('down')}</button></div>
      <button class="icon-button remove-image" data-index="${index}" aria-label="Remove screenshot ${index + 1}" ${busy ? 'disabled' : ''}>${icon('close')}</button>
    </li>`).join('');
  stitchButton.disabled = busy || screenshots.length < 2;
}
function release(item: Screenshot) {
  item.canvas.width = item.canvas.height = 1;
}
function clearAll() {
  cancelWork();
  screenshots.forEach(release);
  screenshots = [];
  manualOverlaps = {};
  clearResult();
  notice();
  renderInputs();
  input.value = '';
}
async function decode(file: File): Promise<Screenshot> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error(`${file.name}: choose a PNG, JPG or WebP image. For HEIC, export a PNG or JPEG first.`);
  }
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} exceeds 25 MB. Choose a smaller image.`);
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`${file.name} could not be opened. Try exporting it as a PNG.`));
      image.src = url;
    });
    const originalWidth = image.naturalWidth, originalHeight = image.naturalHeight;
    if (!originalWidth || !originalHeight || originalWidth * originalHeight > 24_000_000) {
      throw new Error(`${file.name} is too large. Each source image must be under 24 megapixels.`);
    }
    const width = Math.min(MAX_WIDTH, originalWidth);
    const height = Math.round(originalHeight * width / originalWidth);
    if (height > MAX_OUTPUT_HEIGHT) throw new Error(`${file.name} is too tall for a mobile canvas. Choose an image no taller than 16,384 processed pixels.`);
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const ctx = surface.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Your browser could not create an image canvas.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const thumb = document.createElement('canvas');
    thumb.width = 100;
    thumb.height = Math.min(180, Math.round(height / width * 100));
    thumb.getContext('2d')!.drawImage(surface, 0, 0, width, thumb.height / 100 * width, 0, 0, 100, thumb.height);
    return { name: file.name, originalWidth, originalHeight, canvas: surface, thumbnail: thumb.toDataURL('image/jpeg', .75) };
  } finally {
    URL.revokeObjectURL(url);
    image.src = '';
  }
}
async function addFiles(files: File[]) {
  if (busy || !files.length) return;
  if (screenshots.length + files.length > 12) {
    notice('Choose up to 12 screenshots per stitch. Remove a few images or start a second stitch.', true);
    return;
  }
  const token = ++run;
  const additions: Screenshot[] = [];
  setBusy(true, 'Opening your screenshots…');
  notice();
  try {
    let pixels = screenshots.reduce((sum, item) => sum + item.canvas.width * item.canvas.height, 0);
    for (const file of files) {
      const item = await decode(file);
      additions.push(item);
      if (token !== run) { additions.forEach(release); return; }
      const width = screenshots[0]?.originalWidth ?? additions[0]!.originalWidth;
      if (item.originalWidth !== width) throw new Error('These screenshots have different widths. Use screenshots from the same screen size, or crop them to the same width first.');
      pixels += item.canvas.width * item.canvas.height;
      if (pixels > MAX_INPUT_PIXELS) throw new Error('This batch is too large for safe on-device processing. Use fewer screenshots (20 megapixels per batch).');
    }
    screenshots.push(...additions);
    manualOverlaps = {};
    clearResult();
    setBusy(false);
    renderInputs();
    if (screenshots.length > 1) await stitch();
    else notice('One screenshot added. Add the next overlapping screenshot to start stitching.');
  } catch (error) {
    additions.forEach(release);
    if (token === run) {
      notice(error instanceof Error ? error.message : 'The images could not be opened.', true);
      setBusy(false);
      renderInputs();
    }
  } finally {
    input.value = '';
  }
}
function getPlan(options: PlanOptions): Promise<StitchPlan> {
  return new Promise((resolve, reject) => {
    const activeWorker = new Worker(new URL('./stitch.worker.ts', import.meta.url), { type: 'module' });
    worker = activeWorker;
    const finish = () => {
      clearTimeout(timeout);
      activeWorker.terminate();
      if (worker === activeWorker) worker = null;
      stopWorker = null;
    };
    const timeout = window.setTimeout(() => { finish(); reject(new Error('Matching took too long. Try fewer screenshots or turn off automatic ordering.')); }, 60_000);
    stopWorker = () => { finish(); reject(new Error('Cancelled')); };
    activeWorker.onerror = () => { finish(); reject(new Error('The image worker could not finish. Try fewer or smaller screenshots.')); };
    activeWorker.onmessage = (event: MessageEvent<{ plan?: StitchPlan; error?: string }>) => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.plan!);
    };
    try {
      const images: PixelImage[] = screenshots.map(item => {
        const { width, height } = item.canvas;
        return { width, height, data: item.canvas.getContext('2d')!.getImageData(0, 0, width, height).data };
      });
      activeWorker.postMessage({ images, options }, images.map(image => image.data.buffer));
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
async function stitch() {
  if (busy || screenshots.length < 2) return;
  const token = ++run;
  setBusy(true);
  renderInputs();
  notice();
  outputBlob = null;
  try {
    const plan = await getPlan({
      autoOrder: autoOrder.checked,
      trimFixedBars: trimBars.checked,
      cropTop: Number(cropTop.value),
      cropBottom: Number(cropBottom.value),
      manualOverlaps,
    });
    if (token !== run) return;
    if (plan.height > MAX_OUTPUT_HEIGHT || plan.width * plan.height > MAX_OUTPUT_PIXELS) {
      throw new Error('The stitched image exceeds this device-safe canvas limit (16 megapixels or 16,384 pixels tall). Use a smaller batch.');
    }
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The preview canvas could not be created.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, plan.width, plan.height);
    for (const p of plan.placements) {
      ctx.drawImage(screenshots[p.imageIndex]!.canvas, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The PNG could not be created. Try a smaller batch.')), 'image/png'));
    if (token !== run) return;
    currentPlan = plan;
    outputBlob = blob;
    $('empty-state').hidden = true;
    $('result-wrap').hidden = false;
    $('zoom-controls').hidden = false;
    $('preview-stage').classList.add('has-result');
    $('preview-label').textContent = plan.needsReview ? 'REVIEW YOUR JOINS' : 'ALL TOGETHER NOW';
    const size = (blob.size / 1024 / 1024).toFixed(1);
    $('result-status').innerHTML = `${icon(plan.needsReview ? 'info' : 'check')}<span>${plan.needsReview ? 'Review needed · ' : ''}${plan.width.toLocaleString()} × ${plan.height.toLocaleString()} px<br>${plan.order.length} screenshots · ${size} MB</span>`;
    fitPreview();
    const messages = [...plan.warnings];
    if (plan.order.some((value, index) => value !== index) && autoOrder.checked) messages.push(`Detected order: ${plan.order.map(i => i + 1).join(' → ')}.`);
    if (screenshots.some(s => s.originalWidth > MAX_WIDTH)) messages.push(`Images were resized to ${MAX_WIDTH}px wide to stay within mobile memory limits.`);
    if (plan.needsReview) messages.unshift('Some overlaps could not be verified. Review the joins below before saving; no uncertain content has been cropped.');
    notice(messages.join(' '), plan.needsReview);
    renderJoins();
  } catch (error) {
    if (token === run) {
      clearResult();
      notice(error instanceof Error ? error.message : 'Stitching failed. Try fewer screenshots.', true);
    }
  } finally {
    if (token === run) { setBusy(false); renderInputs(); }
  }
}
function renderJoins() {
  const el = $('join-review');
  const plan = currentPlan;
  if (!plan || !plan.joins.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `
    <button class="join-disclosure" id="toggle-joins" aria-expanded="${plan.needsReview || showAllJoins}">${plan.needsReview ? 'Review uncertain joins' : `${showAllJoins ? 'Hide' : 'Fine-tune'} ${plan.joins.length} ${plan.joins.length === 1 ? 'join' : 'joins'}`} ${plan.needsReview ? '' : '↕'}</button>
    <div ${plan.needsReview || showAllJoins ? '' : 'hidden'}>
      <p class="join-explanation">Overlap is the shared content in pixels, after crops and repeated bars. Set 0 to remove no overlap; repeated-bar removal still follows your setting. Apply a value to confirm a join.</p>
      ${plan.joins.map((join, index) => {
        const resolved = join.status === 'matched';
        const max = Math.min(screenshots[join.fromIndex]!.canvas.height, screenshots[join.toIndex]!.canvas.height) - Number(cropTop.value) - Number(cropBottom.value) - join.topTrim - join.bottomTrim - 1;
        return `<div class="join-row"><div class="join-info"><strong>Screenshot ${join.fromIndex + 1} → ${join.toIndex + 1}</strong><span class="join-status ${resolved ? '' : 'review'}">${join.manual ? 'Manual' : resolved ? 'Matched' : 'Review'}</span><small>${escapeHTML(join.reason)}${join.topTrim || join.bottomTrim ? ` Bars: ${join.topTrim}px top, ${join.bottomTrim}px bottom.` : ''}</small></div><div class="join-controls"><label for="overlap-${index}">Overlap</label><input id="overlap-${index}" type="number" min="0" max="${Math.max(0, max)}" value="${join.appliedOverlap}" inputmode="numeric"><span>px</span><button class="button button-outline apply-overlap" data-join="${index}">Apply</button><button class="text-button stack-join" data-join="${index}">Use 0 px</button></div></div>`;
      }).join('')}
      <button id="reset-joins" class="text-button">Reset manual adjustments</button>
    </div>`;
}
function fitPreview() {
  if (!currentPlan) return;
  const available = $('preview-stage').clientWidth - (window.innerWidth <= 720 ? 36 : 52);
  const fit = Math.min(available, 440, currentPlan.width);
  const width = zoom === null ? fit : Math.round(currentPlan.width * zoom);
  canvas.style.width = `${width}px`;
  canvas.style.maxWidth = zoom === null ? '100%' : 'none';
  $('result-wrap').style.maxWidth = zoom === null ? '100%' : 'none';
  $('zoom-value').textContent = zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`;
}
function adjustZoom(delta: number) {
  if (!currentPlan) return;
  zoom = Math.min(2, Math.max(.1, (zoom ?? canvas.getBoundingClientRect().width / currentPlan.width) + delta));
  fitPreview();
}
const filename = () => `tailorstitch-${new Date().toISOString().slice(0, 10)}.png`;
async function save(share = false) {
  if (!outputBlob || currentPlan?.needsReview) return;
  const blob = outputBlob;
  try {
    if (await shareImage(blob, filename())) return;
    const file = new File([blob], filename(), { type: 'image/png' });
    if (share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'TailorStitch' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (share) notice('File sharing is unavailable in this browser. Your PNG download has started.');
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    notice(error instanceof Error ? error.message : 'Your image could not be shared. Try Save PNG instead.', true);
  }
}
input.addEventListener('change', () => { void addFiles(Array.from(input.files ?? [])); });
const dropZone = $('drop-zone');
for (const type of ['dragenter', 'dragover']) dropZone.addEventListener(type, event => {
  event.preventDefault();
  if (!busy) dropZone.classList.add('drag-over');
});
for (const type of ['dragleave', 'drop']) dropZone.addEventListener(type, event => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', event => { if (!busy) void addFiles(Array.from((event as DragEvent).dataTransfer?.files ?? [])); });
// Prevent dropped files outside the target from replacing the application.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
document.addEventListener('paste', event => {
  if ((event.target as HTMLElement)?.matches('input')) return;
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length && !busy) { event.preventDefault(); void addFiles(files); }
});
$('clear-button').addEventListener('click', clearAll);
$('cancel-button').addEventListener('click', () => { cancelWork(); renderInputs(); notice('Stitching cancelled. Your screenshots are still here.'); });
stitchButton.addEventListener('click', () => void stitch());
downloadButton.addEventListener('click', () => void save());
shareButton.addEventListener('click', () => void save(true));
$('zoom-in').addEventListener('click', () => adjustZoom(.25));
$('zoom-out').addEventListener('click', () => adjustZoom(-.25));
$('zoom-fit').addEventListener('click', () => { zoom = null; fitPreview(); });
window.addEventListener('resize', fitPreview);
for (const control of [autoOrder, trimBars, cropTop, cropBottom]) control.addEventListener('change', () => {
  manualOverlaps = {};
  void stitch();
});
$('image-list').addEventListener('click', event => {
  if (busy) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.classList.contains('remove-image')) {
    release(screenshots[index]!);
    screenshots.splice(index, 1);
  } else if (button.classList.contains('move-image')) {
    const next = index + Number(button.dataset.direction);
    if (next < 0 || next >= screenshots.length) return;
    [screenshots[index], screenshots[next]] = [screenshots[next]!, screenshots[index]!];
    autoOrder.checked = false;
  }
  manualOverlaps = {};
  clearResult();
  renderInputs();
  if (screenshots.length > 1) void stitch();
  else notice(screenshots.length ? 'Add another screenshot to continue.' : '');
});
$('join-review').addEventListener('click', event => {
  if (busy) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  if (button.id === 'toggle-joins') { showAllJoins = !showAllJoins; renderJoins(); return; }
  if (button.id === 'reset-joins') { manualOverlaps = {}; void stitch(); return; }
  const index = Number(button.dataset.join);
  if (!Number.isInteger(index) || !currentPlan) return;
  const field = $<HTMLInputElement>(`overlap-${index}`);
  const value = button.classList.contains('stack-join') ? 0 : Number(field.value);
  if (!Number.isInteger(value) || value < 0 || value > Number(field.max)) {
    notice(`Enter an overlap from 0 to ${field.max} pixels.`, true);
    return;
  }
  manualOverlaps[index] = value;
  showAllJoins = true;
  void stitch();
});
$('demo-button').addEventListener('click', async () => {
  if (busy) return;
  const token = ++run;
  setBusy(true, 'Getting the example ready…');
  try {
    const files = await Promise.all([1, 2, 3].map(async index => {
      const response = await fetch(`${import.meta.env.BASE_URL}demo/0${index}.png`);
      if (!response.ok) throw new Error('The example could not be loaded. Add your own screenshots to try stitching.');
      return new File([await response.blob()], `Copenhagen-${index}.png`, { type: 'image/png' });
    }));
    if (token !== run) return;
    setBusy(false);
    clearAll();
    await addFiles(files);
  } catch (error) {
    if (token === run) { setBusy(false); notice(error instanceof Error ? error.message : 'The example could not be opened.', true); }
  }
});
const dialog = $<HTMLDialogElement>('info-dialog');
function showDialog(content: string) {
  $('dialog-content').innerHTML = content;
  dialog.showModal();
}
$('install-button').addEventListener('click', () => {
  showDialog(`<span class="dialog-icon">${icon('phone')}</span><h2>A little more screen space.</h2><p>Add TailorStitch to your iPhone’s Home Screen. It’s free, and your screenshots stay on your phone.</p><ol><li>Open this website in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong> (you may need to scroll down).</li><li>Tap <strong>Add</strong>. Open TailorStitch from its new icon.</li></ol><p>After the first visit, the app also works offline on supported browsers.</p><p class="dialog-note">Prefer an Xcode app? The <a href="https://github.com/dev1niscool/TailorStitch/blob/main/docs/IOS.md" target="_blank" rel="noopener noreferrer">iPhone project and installation guide</a> are included. A signed App Store release is not available yet.</p>`);
});
$('privacy-button').addEventListener('click', () => {
  showDialog(`<span class="dialog-icon">${icon('lock')}</span><h2>Your screenshots stay yours.</h2><p>Stitching happens entirely on your device. We don’t upload, track, or store your screenshots on a server. There are no analytics, accounts, advertisements, or watermarks.</p><p>Images remain in memory until you clear them or close the app. Saved files are under your control. Offline caching stores the app and its fictional example, never your screenshots.</p><p>GitHub Pages hosts the website and may log normal website requests. It does not receive the images you select.</p><p class="dialog-note">TailorStitch is an independent recreation inspired by Tailor’s public screenshot-stitching behavior. No original app code or assets are included.</p>`);
});
$('dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
if (Capacitor.isNativePlatform()) $('install-button').hidden = true;
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform() && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Stitching remains available when private browsing or policy blocks caching.
    });
  });
}
