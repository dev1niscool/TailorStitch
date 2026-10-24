import type { ManualCut } from './engine';
import './join-editor.css';

interface JoinEditorOptions {
  upper: HTMLCanvasElement;
  lower: HTMLCanvasElement;
  upperName: string;
  lowerName: string;
  upperStart: number;
  upperEndLimit: number;
  lowerStartLimit: number;
  lowerEnd: number;
  initial: ManualCut;
  validateCut?: (cut: ManualCut) => string | null;
}

let closeActiveEditor: (() => void) | null = null;
export function closeJoinEditor() { closeActiveEditor?.(); }

/** Edits source coordinates only. The preview is viewport-sized; originals are never modified. */
export function openJoinEditor(options: JoinEditorOptions): Promise<ManualCut | null> {
  closeJoinEditor();
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.id = 'join-editor-dialog';
    dialog.className = 'join-editor';
    dialog.setAttribute('aria-labelledby', 'join-editor-title');
    dialog.setAttribute('aria-describedby', 'join-editor-instructions');
    dialog.innerHTML = `
      <div class="join-editor-heading"><div><span class="join-editor-eyebrow">A LITTLE FINE-TUNING</span><h2 id="join-editor-title">Adjust join</h2></div><button class="icon-button" id="join-editor-close" aria-label="Close join editor">✕</button></div>
      <div class="join-editor-steps" aria-label="Editing steps"><button id="join-step-trim" aria-pressed="true"><span>1</span> Trim upper photo</button><button id="join-step-align" aria-pressed="false"><span>2</span> Align overlap</button></div>
      <p id="join-editor-instructions"></p>
      <div class="join-editor-toolbar"><span id="join-editor-view-label">Upper photo · bottom trim</span><div class="join-editor-zoom"><button id="join-editor-zoom-out" aria-label="Zoom out">−</button><button id="join-editor-fit" aria-label="Fit photos to width">Fit</button><button id="join-editor-zoom-in" aria-label="Zoom in">+</button></div></div>
      <div id="join-editor-stage" class="join-editor-stage" tabindex="0" aria-label="Scrollable photo preview">
        <div id="join-editor-scene" class="join-editor-scene">
          <canvas id="join-editor-canvas" aria-label="Local preview of the selected join"></canvas>
          <div id="join-upper-drag" class="join-upper-drag" tabindex="0" role="slider" aria-label="Drag upper photo to align" aria-orientation="vertical"></div>
          <div id="join-cut-guide" class="join-cut-guide" aria-hidden="true"><span>✂ <span id="join-cut-label">Bottom of upper photo</span></span></div>
          <div id="join-trim-handle" class="join-trim-handle" tabindex="0" role="slider" aria-label="Trim bottom of upper photo" aria-orientation="vertical"><span>↕</span></div>
        </div>
      </div>
      <div class="join-editor-controls">
        <div id="join-trim-controls" class="join-editor-control-row"><label for="join-trim-range">Bottom trim</label><input id="join-trim-range" type="range" step="1"><output id="join-trim-value"></output></div>
        <div id="join-align-controls" hidden><div class="join-editor-control-row"><label for="join-overlap-range">Overlap position</label><input id="join-overlap-range" type="range" step="1"><output id="join-overlap-value"></output></div><div class="join-editor-preview-row"><span>Upper photo <span class="join-overlay-key"></span> 50% overlay</span><button id="join-toggle-result" class="button button-outline" aria-pressed="false">Show cut result</button></div></div>
        <p id="join-editor-summary" aria-live="polite"></p><p id="join-editor-error" role="alert" hidden></p>
      </div>
      <div class="join-editor-footer"><button class="text-button" id="join-reset">Reset changes</button><div><button class="button button-outline" id="join-cancel">Cancel</button><button class="button button-primary" id="join-apply">Next: align</button></div></div>`;
    document.body.appendChild(dialog);
    const el = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
    const stage = el('join-editor-stage');
    const scene = el('join-editor-scene');
    const preview = el<HTMLCanvasElement>('join-editor-canvas');
    const ctx = preview.getContext('2d')!;
    const upperDrag = el('join-upper-drag');
    const trimHandle = el('join-trim-handle');
    const cutGuide = el('join-cut-guide');
    const trimRange = el<HTMLInputElement>('join-trim-range');
    const overlapRange = el<HTMLInputElement>('join-overlap-range');
    const initial = { ...options.initial };
    let draft = { ...initial };
    let mode: 'trim' | 'align' = 'trim';
    let resultView = false;
    let magnification = 1;
    let scale = 1, left = 0, upperOrigin = 0, lowerOrigin = 0, seamY = 0;
    let ended = false;
    let frame = 0;
    let activePointer: { id: number; y: number; value: number; mode: 'trim' | 'align'; target: HTMLElement } | null = null;
    const padding = 28;
    // An automatic seam may legitimately leave an empty middle screenshot.
    // Keep that inherited endpoint representable without changing a no-edit confirmation.
    const upperMin = Math.min(options.upperEndLimit, options.upperStart + 1, initial.upperEnd);
    const lowerMax = Math.max(options.lowerStartLimit, options.lowerEnd - 1, initial.lowerStart);
    const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
    const percent = (part: number, whole: number) => `${Math.round(part / Math.max(1, whole) * 100)}%`;
    trimRange.min = String(upperMin);
    trimRange.max = String(options.upperEndLimit);
    overlapRange.min = String(options.lowerStartLimit);
    overlapRange.max = String(lowerMax);

    function paint() {
      frame = 0;
      if (ended) return;
      const width = stage.clientWidth, height = stage.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const backingWidth = Math.round(width * dpr), backingHeight = Math.round(height * dpr);
      if (preview.width !== backingWidth || preview.height !== backingHeight) {
        preview.width = backingWidth;
        preview.height = backingHeight;
      }
      preview.style.width = `${width}px`;
      preview.style.height = `${height}px`;
      preview.style.transform = `translate(${stage.scrollLeft}px, ${stage.scrollTop}px)`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(-stage.scrollLeft, -stage.scrollTop);
      const draw = (image: HTMLCanvasElement, start: number, end: number, origin: number) => {
        if (end <= start) return;
        ctx.drawImage(image, 0, start, image.width, end - start, left, origin + start * scale, image.width * scale, (end - start) * scale);
      };
      if (mode === 'trim') {
        draw(options.upper, options.upperStart, options.upperEndLimit, upperOrigin);
        ctx.fillStyle = 'rgba(21, 29, 16, .68)';
        ctx.fillRect(left, seamY, options.upper.width * scale, (options.upperEndLimit - draft.upperEnd) * scale);
      } else {
        draw(options.lower, resultView ? draft.lowerStart : options.lowerStartLimit, options.lowerEnd, lowerOrigin);
        if (resultView) draw(options.upper, options.upperStart, draft.upperEnd, upperOrigin);
        else {
          // Only the shared area is translucent: non-overlapping upper content stays legible.
          const overlapTop = lowerOrigin + options.lowerStartLimit * scale;
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, 0, options.upper.width * scale, overlapTop);
          ctx.clip();
          draw(options.upper, options.upperStart, draft.upperEnd, upperOrigin);
          ctx.restore();
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, overlapTop, options.upper.width * scale, Math.max(0, seamY - overlapTop));
          ctx.clip();
          ctx.globalAlpha = .5;
          draw(options.upper, options.upperStart, draft.upperEnd, upperOrigin);
          ctx.restore();
        }
      }
    }
    function schedulePaint() { if (!frame) frame = requestAnimationFrame(paint); }
    function focusCut() {
      stage.scrollTop = Math.max(0, seamY - stage.clientHeight * .57);
      stage.scrollLeft = Math.max(0, left + options.upper.width * scale / 2 - stage.clientWidth / 2);
      schedulePaint();
    }
    function update(focus = false) {
      const available = Math.max(160, Math.min(620, stage.clientWidth - padding * 2));
      scale = available / options.upper.width * magnification;
      const sceneWidth = Math.max(stage.clientWidth, options.upper.width * scale + padding * 2);
      left = (sceneWidth - options.upper.width * scale) / 2;
      if (mode === 'trim') {
        upperOrigin = padding - options.upperStart * scale;
        seamY = upperOrigin + draft.upperEnd * scale;
        scene.style.height = `${Math.max(stage.clientHeight, padding * 2 + (options.upperEndLimit - options.upperStart) * scale)}px`;
      } else {
        // The lower image is fixed. Increasing its top cut translates the UPPER image down.
        lowerOrigin = padding + (options.upperEndLimit - options.upperStart - options.lowerStartLimit) * scale;
        upperOrigin = lowerOrigin + (draft.lowerStart - draft.upperEnd) * scale;
        seamY = lowerOrigin + draft.lowerStart * scale;
        scene.style.height = `${Math.max(stage.clientHeight, lowerOrigin + options.lowerEnd * scale + padding)}px`;
      }
      scene.style.width = `${sceneWidth}px`;
      for (const element of [cutGuide, trimHandle, upperDrag]) {
        element.style.left = `${left}px`;
        element.style.width = `${options.upper.width * scale}px`;
      }
      cutGuide.style.top = `${seamY}px`;
      trimHandle.style.top = `${seamY - 22}px`;
      upperDrag.style.top = `${upperOrigin + options.upperStart * scale}px`;
      upperDrag.style.height = `${(draft.upperEnd - options.upperStart) * scale}px`;
      upperDrag.hidden = mode !== 'align' || resultView;
      trimHandle.hidden = mode !== 'trim';
      trimRange.value = String(Math.round(draft.upperEnd));
      overlapRange.value = String(Math.round(draft.lowerStart));
      const kept = percent(draft.upperEnd - options.upperStart, options.upperEndLimit - options.upperStart);
      const removed = percent(draft.lowerStart - options.lowerStartLimit, options.lowerEnd - options.lowerStartLimit);
      trimRange.setAttribute('aria-valuetext', `${kept} of upper photo kept`);
      overlapRange.setAttribute('aria-valuetext', `${removed} of lower photo removed`);
      for (const [element, min, max, value, valueText] of [
        [trimHandle, upperMin, options.upperEndLimit, draft.upperEnd, `${kept} of upper photo kept`],
        [upperDrag, options.lowerStartLimit, lowerMax, draft.lowerStart, `${removed} of lower photo removed`],
      ] as const) {
        element.setAttribute('aria-valuemin', String(min));
        element.setAttribute('aria-valuemax', String(max));
        element.setAttribute('aria-valuenow', String(Math.round(value)));
        element.setAttribute('aria-valuetext', valueText);
      }
      el('join-trim-value').textContent = `${kept} kept`;
      el('join-overlap-value').textContent = `${removed} cut`;
      el('join-editor-summary').textContent = mode === 'trim'
        ? 'The shaded bottom will be removed from the upper photo. Your original stays unchanged.'
        : resultView ? 'This is the cut: the kept upper photo, followed by the lower photo below the dashed line.'
        : 'The scissors line cuts the top of the lower photo. Everything above it in the upper photo is kept.';
      el('join-editor-fit').textContent = magnification === 1 ? 'Fit' : `${Math.round(magnification * 100)}%`;
      el<HTMLButtonElement>('join-editor-zoom-out').disabled = magnification <= 1;
      el<HTMLButtonElement>('join-editor-zoom-in').disabled = magnification >= 3;
      if (focus) focusCut();
      schedulePaint();
    }
    function setMode(next: 'trim' | 'align') {
      el('join-editor-error').hidden = true;
      mode = next;
      resultView = false;
      el('join-step-trim').setAttribute('aria-pressed', String(mode === 'trim'));
      el('join-step-align').setAttribute('aria-pressed', String(mode === 'align'));
      el('join-trim-controls').hidden = mode !== 'trim';
      el('join-align-controls').hidden = mode !== 'align';
      el('join-editor-instructions').textContent = mode === 'trim'
        ? 'First, drag the dashed edge up to trim the bottom of the upper photo. Keep it as it is if no trim is needed.'
        : 'Drag the upper photo down over the lower photo until the shared content lines up. Use the transparent overlap to match it.';
      el('join-editor-view-label').textContent = mode === 'trim' ? 'Upper photo · bottom trim' : 'Drag upper photo ↕ · lower photo stays in place';
      el('join-cut-label').textContent = mode === 'trim' ? 'Bottom of upper photo' : 'Cut top of lower photo here';
      el('join-apply').textContent = mode === 'trim' ? 'Next: align' : 'OK — apply join';
      el('join-toggle-result').textContent = 'Show cut result';
      el('join-toggle-result').setAttribute('aria-pressed', 'false');
      update(true);
    }
    function change(value: number, which = mode) {
      el('join-editor-error').hidden = true;
      if (which === 'trim') draft.upperEnd = clamp(value, upperMin, options.upperEndLimit);
      else draft.lowerStart = clamp(value, options.lowerStartLimit, lowerMax);
      update();
    }
    function pointerStart(event: PointerEvent) {
      if (event.button !== 0 || activePointer) return;
      const target = event.currentTarget as HTMLElement;
      const which = target === trimHandle ? 'trim' : 'align';
      activePointer = { id: event.pointerId, y: event.clientY, value: which === 'trim' ? draft.upperEnd : draft.lowerStart, mode: which, target };
      target.setPointerCapture(event.pointerId);
      target.classList.add('is-dragging');
      event.preventDefault();
    }
    function pointerMove(event: PointerEvent) {
      if (!activePointer || activePointer.id !== event.pointerId) return;
      change(activePointer.value + (event.clientY - activePointer.y) / scale, activePointer.mode);
      event.preventDefault();
    }
    function pointerEnd(event: PointerEvent) {
      if (!activePointer || activePointer.id !== event.pointerId) return;
      if (event.type === 'pointercancel') change(activePointer.value, activePointer.mode);
      activePointer.target.classList.remove('is-dragging');
      activePointer = null;
      // Quantize once per gesture, never accumulate rounded display coordinates.
      draft = { upperEnd: Math.round(draft.upperEnd), lowerStart: Math.round(draft.lowerStart) };
      update();
    }
    function keyboard(event: KeyboardEvent, which: 'trim' | 'align') {
      const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      change((which === 'trim' ? draft.upperEnd : draft.lowerStart) + direction * (event.shiftKey ? 10 : 1), which);
      focusCut();
    }
    for (const target of [upperDrag, trimHandle]) {
      target.addEventListener('pointerdown', pointerStart);
      target.addEventListener('pointermove', pointerMove);
      target.addEventListener('pointerup', pointerEnd);
      target.addEventListener('pointercancel', pointerEnd);
      target.addEventListener('lostpointercapture', pointerEnd);
      target.addEventListener('keydown', event => keyboard(event, target === trimHandle ? 'trim' : 'align'));
    }
    trimRange.addEventListener('input', () => { change(Number(trimRange.value), 'trim'); focusCut(); });
    overlapRange.addEventListener('input', () => { change(Number(overlapRange.value), 'align'); focusCut(); });
    trimRange.addEventListener('keydown', event => keyboard(event, 'trim'));
    overlapRange.addEventListener('keydown', event => keyboard(event, 'align'));
    el('join-step-trim').addEventListener('click', () => setMode('trim'));
    el('join-step-align').addEventListener('click', () => setMode('align'));
    el('join-toggle-result').addEventListener('click', () => {
      resultView = !resultView;
      el('join-toggle-result').textContent = resultView ? 'Show overlay' : 'Show cut result';
      el('join-toggle-result').setAttribute('aria-pressed', String(resultView));
      el('join-editor-view-label').textContent = resultView ? 'Cut result · exactly what this join keeps' : 'Drag upper photo ↕ · lower photo stays in place';
      update();
    });
    el('join-reset').addEventListener('click', () => { draft = { ...initial }; setMode(mode); });
    el('join-editor-zoom-in').addEventListener('click', () => { magnification = Math.min(3, magnification + .5); update(true); });
    el('join-editor-zoom-out').addEventListener('click', () => { magnification = Math.max(1, magnification - .5); update(true); });
    el('join-editor-fit').addEventListener('click', () => { magnification = 1; update(true); });
    stage.addEventListener('scroll', schedulePaint, { passive: true });
    const observer = new ResizeObserver(() => update(true));
    function finish(value: ManualCut | null) {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (closeActiveEditor === cancel) closeActiveEditor = null;
      dialog.close();
      dialog.remove();
      preview.width = preview.height = 1;
      resolve(value);
    }
    function cancel() { finish(null); }
    closeActiveEditor = cancel;
    el('join-cancel').addEventListener('click', cancel);
    el('join-editor-close').addEventListener('click', cancel);
    el('join-apply').addEventListener('click', () => {
      if (mode === 'trim') { setMode('align'); return; }
      const cut = { upperEnd: Math.round(draft.upperEnd), lowerStart: Math.round(draft.lowerStart) };
      const error = options.validateCut?.(cut);
      if (error) {
        el('join-editor-error').textContent = error;
        el('join-editor-error').hidden = false;
        return;
      }
      finish(cut);
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) cancel();
    });
    dialog.showModal();
    el('join-editor-title').title = `${options.upperName} → ${options.lowerName}`;
    setMode('trim');
    observer.observe(stage);
    el('join-step-trim').focus();
  });
}
