import { icon } from './icons';

export const appMarkup = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="TailorStitch home">
      <img src="./icon.svg" alt="" width="34" height="34"><span>Tailor<span class="brand-light">Stitch</span></span>
    </a>
    <nav aria-label="Main navigation">
      <a href="#how-it-works" class="quiet-link">How it works</a>
      <button class="button button-outline install-button" id="install-button">${icon('phone')} <span>Get it on iPhone</span></button>
      <a class="icon-button github-link" href="https://github.com/dev1niscool/TailorStitch" target="_blank" rel="noopener noreferrer" aria-label="Source on GitHub">${icon('github')}</a>
    </nav>
  </header>
  <main>
    <section class="intro">
      <div class="eyebrow"><span class="status-dot"></span> SMALL SCREEN. BIG PICTURE.</div>
      <h1>The whole picture<span class="accent">.</span></h1>
      <p>Chats, recipes, rabbit holes. Turn overlapping screenshots<br class="desktop-break"> into one seamless image, in a stitch.</p>
      <div class="intro-tags"><span>${icon('check')} Always free</span><span>${icon('check')} No watermarks</span><span>${icon('lock')} Stays on your device</span></div>
    </section>
    <section class="workspace" aria-label="Screenshot stitching workspace">
      <div class="workspace-top">
        <div class="workspace-title"><span class="tiny-grid">▦</span> Your workspace <span class="beta-tag">1.0</span></div>
        <div class="local-label"><span class="status-dot"></span> Working locally</div>
      </div>
      <div class="workspace-body">
        <aside class="input-panel">
          <div class="panel-heading"><h2>Screenshots <span id="image-count" class="count">0</span></h2><button id="clear-button" class="text-button" hidden>Clear all</button></div>
          <label id="drop-zone" class="drop-zone" for="file-input">
            <span class="upload-icon">${icon('plus')}</span>
            <strong>Add your screenshots</strong>
            <span>Choose files or drop them here</span>
            <small>PNG, JPG or WebP · up to 12 images</small>
          </label>
          <input id="file-input" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Add screenshots">
          <ol id="image-list" class="image-list" aria-label="Screenshot order"></ol>
          <div class="input-hint" id="input-hint">${icon('info')}<p>Leave some overlap as you scroll.<br>About a third of each screen works well.</p></div>
          <div class="options">
            <label class="toggle-row"><span>Find screenshot order <small>Match the flow automatically</small></span><input id="auto-order" type="checkbox" role="switch" checked></label>
            <label class="toggle-row"><span>Remove repeated bars <small>Keep the first header and last footer</small></span><input id="trim-bars" type="checkbox" role="switch" checked></label>
            <details class="advanced"><summary>Fine-tune crops</summary><p>Remove these pixels from every screenshot before matching.</p><div class="crop-inputs"><label>Top <input id="crop-top" type="number" min="0" max="1000" value="0" inputmode="numeric"><span>px</span></label><label>Bottom <input id="crop-bottom" type="number" min="0" max="1000" value="0" inputmode="numeric"><span>px</span></label></div></details>
          </div>
          <button id="stitch-button" class="button button-primary stitch-button" disabled>${icon('spark')} Stitch screenshots ${icon('arrow')}</button>
          <p class="automatic-note">Stitches automatically when you add images.</p>
        </aside>
        <div class="output-panel">
          <div class="preview-toolbar"><span id="preview-label">THE BIG PICTURE</span><div class="zoom-controls" id="zoom-controls" hidden><button id="zoom-out" aria-label="Zoom out">−</button><span id="zoom-value">Fit</span><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-fit" class="fit-button">Fit</button></div><span class="format-tag">PNG</span></div>
          <div id="preview-stage" class="preview-stage">
            <div id="empty-state" class="empty-state">
              <div class="sample-stack" aria-hidden="true">
                <div class="sample-card sample-card-back"><img src="./demo/03.png" alt=""></div>
                <div class="sample-card sample-card-middle"><img src="./demo/02.png" alt=""></div>
                <div class="sample-card sample-card-front"><img src="./demo/01.png" alt=""></div>
                <div class="sample-badge">${icon('spark')} Seamlessly together</div>
                <span class="floating-plus floating-plus-one">+</span><span class="floating-plus floating-plus-two">+</span>
              </div>
              <h2>A few screenshots.<br>One continuous story.</h2>
              <p>Add two or more overlapping screenshots.<br>We’ll find where they fit.</p>
              <button id="demo-button" class="demo-button">Try it with an example ${icon('arrow')}</button>
            </div>
            <div id="result-wrap" class="result-wrap" hidden><canvas id="output-canvas" aria-label="Stitched screenshot preview"></canvas></div>
            <div id="busy-overlay" class="busy-overlay" hidden><span class="spinner"></span><strong id="busy-label">Finding the perfect fit…</strong><span>All processing stays on this device.</span><button id="cancel-button" class="button button-outline">Cancel</button></div>
          </div>
          <div class="result-bar">
            <div id="result-status" class="result-status" role="status" aria-live="polite">${icon('image')}<span>Your stitched image will appear here</span></div>
            <div class="export-buttons"><button id="share-button" class="button button-outline" disabled aria-label="Share stitched image">${icon('share')}</button><button id="download-button" class="button button-dark" disabled>${icon('download')} <span>Save PNG</span></button></div>
          </div>
        </div>
      </div>
      <div id="notice" class="notice" role="status" hidden></div>
      <div id="join-review" class="join-review" hidden></div>
    </section>
    <section class="benefits" id="how-it-works" aria-label="How it works">
      <article><span class="benefit-number">01</span><div><h3>Scroll. Snap. Repeat.</h3><p>Capture your screen as you scroll, keeping a little of the previous screen visible.</p></div></article>
      <article><span class="benefit-number">02</span><div><h3>Let the pieces find their place.</h3><p>Smart overlap detection lines up your images. You can fine-tune any join.</p></div></article>
      <article><span class="benefit-number">03</span><div><h3>Keep the complete story.</h3><p>Save a crisp PNG, ready to share. No sign-up, upload, or watermark in the way.</p></div></article>
    </section>
  </main>
  <footer><span class="footer-wordmark">Made to bring things together.</span><div><span>Free. Private. Yours.</span><button id="privacy-button" class="text-button">Privacy</button><a href="https://github.com/dev1niscool/TailorStitch" target="_blank" rel="noopener noreferrer">View source ${icon('arrow')}</a></div></footer>
  <dialog id="info-dialog"><button id="dialog-close" class="icon-button dialog-close" aria-label="Close dialog">${icon('close')}</button><div id="dialog-content"></div></dialog>
`;
