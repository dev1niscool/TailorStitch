# Screenshot stitching

The browser decodes screenshots, normalizes their widths, and sends RGBA pixels
to `src/engine/index.ts` in a worker. The engine itself has no browser, network,
machine-learning, or third-party runtime dependency.

## Matching

1. Build 32-column RGB row signatures across the image. Include horizontal and
   vertical detail so plain backgrounds do not count as useful overlap evidence.
2. When enabled, compare luminance at the same row positions to estimate repeated
   top and bottom chrome. This avoids confusing a small change in a glass
   toolbar's hue with the start of scrolling content. Use the central half for
   this estimate so peripheral clocks and navigation controls have less effect.
3. Search possible bottom-to-top overlaps with vertically smoothed signatures,
   then refine separate promising peaks at individual source-pixel offsets.
   Compare both RGB values and adjacent-column contrast, so a message bubble's
   viewport-dependent color gradient does not hide its matching text layout.
4. Verify the leading candidates with denser row sampling. Keep representatives
   from distinct alignment peaks, not just adjacent offsets around one peak.
   Reject featureless or ambiguous matches instead of choosing an arbitrary cut.
5. Check original pixels around high-contrast edges. This prevents matching two
   chat screens merely because their bubble layouts look similar while their
   message text differs. Fit one shared fractional-row offset during verification
   to tolerate resizing that puts the scroll translation between pixels. The
   same offset must explain the whole overlap; individual letters cannot shift
   independently to manufacture a match.
6. Before rejecting a unique alignment for its average color difference, also
   check signed local contrast at original-pixel detail. Color changes can be
   accepted only with substantial matching features across multiple rows and
   vertical regions. Long bubble outlines or a matching icon alone cannot
   establish that differently colored screenshots contain the same messages.

If the initial match is unresolved and bar removal is enabled, a bounded recovery
pass proposes raw vertical translations from distinctive content tiles. A tile
whose best alignment is too close to a different runner-up does not vote. Votes
are grouped by translation, with support required from separated source rows.
The original full-view alignment is also retained as a proposal, so a useful
overlap containing only one sticker does not require several distinct text tiles.
It receives the same complete overlap and crop verification as tile proposals.

Stationary row shape, allowing a small common brightness change, supplies possible
header boundaries. The scan stops at evidence of moving content; matching blank
rows later in the image cannot justify cropping the intervening messages.
Each proposed boundary is checked against the full remaining overlap, including
competing alignments and local bands of contradictory text. The extra local check
prevents a large matching photograph or sticker from outvoting different messages
when changing the assumed viewport. Only one independently verified translation
may be accepted. The fallback does not run when bar removal is off.

The confidence value is a heuristic based on image agreement and the separation
between competing alignments. It is not a calibrated probability.

## Planning and rendering

`planStitch` returns source rectangles ready for `CanvasRenderingContext2D.drawImage`.
The original pixels are used for output; the signatures are only for locating
joins. At successful joins, the engine removes the preceding screenshot's
repeated footer, the next screenshot's repeated header, and the matched overlap.
It preserves the first header and final footer. User-specified top and bottom
crops apply to every source image before this process.

Automatic joins choose a quiet, agreeing row inside the shared content instead
of cutting at the viewport edge. This avoids including partially obscured
messages and translucent composer borders when the estimated bar boundary is
a few pixels off. The chosen seam changes which screenshot supplies the shared
pixels, without changing the inferred translation or total output height.
Visual manual cuts retain their explicitly requested source rows.

Exact duplicate images are skipped. Optional ordering compares complete directed
paths through every remaining screenshot, using only verified pairwise matches.
A bounded dynamic program retains the best and runner-up paths; overlap support
and confidence determine edge weights. An order is accepted only when the best
complete path is sufficiently stronger than its alternative. A short repeated
label pointing backward can no longer disqualify an otherwise well-supported
full sequence merely by giving its first image an incoming edge. Disconnected
images are never dropped to manufacture an order. Inconclusive ordering retains
the supplied order.

Uncertain or unrelated joins set `needsReview`. Their previews concatenate the
screenshots without removing content. An explicit confirmed cut resolves the join.
No uncertain inferred cut is silently applied.

### Visual join editing

Each join exposes its actual `upperEnd` and `lowerStart` source rows, including
an automatically chosen interior seam. The editor starts at those exact rows,
so accepting an unchanged join preserves its pixels. `manualCuts` uses these
absolute row boundaries: the upper end is exclusive and the lower start is
inclusive. Global crops bound the available source regions. Adjacent joins must
leave at least one row of each intervening image; conflicting manual cuts are
rejected rather than silently deleting a screenshot.

The editor first lets the user trim the upper image's bottom, then drag it over
the lower image with a translucent overlay. Dragging down advances the lower start row. A dashed
scissors line marks the cut, and a result view renders the retained regions.
Display zoom and canvas resolution are independent of source coordinates.
Pointer movement, keyboard controls, and preview update a draft only. Cancel
leaves the plan untouched; confirmation stores source cuts and pins the current
screenshot order so a later automatic ordering pass cannot attach them to a
different pair. Changes to input order or global crops clear incompatible cuts.

Source images remain immutable. The preview and export draw source rectangles
from those originals, rather than repeatedly cropping or resampling a previous
output. The legacy `manualOverlaps` engine option remains available for callers;
the interface no longer requires entering an overlap in pixels.

## Practical limits

This is vertical translation matching. Screenshots should come from the same
screen, at the same zoom, with a useful shared section—about a quarter to a third
of the screen is a good starting point. Repeated list items, mostly blank
screens, changing video or animation, expanding headers, sideways movement,
and different layouts or zoom levels may need manual order or overlap
adjustments. Matching cannot restore content that was never captured.
Automatic ordering remains inconclusive when complete sequences have similarly
strong evidence. The current order is retained, and unverified joins require
review.

Images passed to the engine must share a width and remain immutable. The caller
controls decoding, width normalization, input/output memory limits, cancellation,
and export. Pixel coordinates and crop values refer to the normalized images.

## Verification

Run `npm test`. Engine tests check exact output pixels against continuous source
images and an independently generated full-size PNG. Cases include repeated
chrome, changing status-clock pixels, shuffled screenshots, exact duplicates,
different heights, noisy pixels, small overlaps, wide images, manual crops,
unrelated screens, repeated patterns, and similar chat layouts with different
text. Fictional dark-chat regressions also cover sparse image attachments,
changing navigation badges, composer overlays, fractional resizing, and bubble
gradients that change with viewport position, with
pixel comparisons or source-coordinate checks for missing/duplicated content.
Tests also cover tinted fixed headers, repeated detailed stickers, and misleading
header crops that could otherwise hide different messages. The browser suite
imports fictional four-screenshot conversations and verifies automatic matching
and export without manual adjustments. Visual-editor tests use independently
generated coordinate charts to check retained source pixels, draft cancellation,
reopening, neighboring cuts, and pointer/touch interactions.
Synthetic and bundled-fixture tests do not establish that every real-world
app or screenshot can be automatically stitched.

## Research references

The 1.1 editor and ordering changes were informed by source-level review of
these eleven licensed open-source projects. The links pin the inspected revisions.
Ideas were implemented independently in TypeScript; none of these libraries or
their source code was added as an application dependency.

| Project / license | What it does well | Application or limit here |
| --- | --- | --- |
| [ScrollSnap](https://github.com/Brkgng/ScrollSnap/blob/5be0a28f679358be658d4139d16465307f906c87/ScrollSnap/Managers/StitchingManager.swift) · MIT | Corroborates translation across spatial bands and bounds motion. | Supports requiring agreement across regions; repeated labels still need uniqueness checks. |
| [OpenStitching](https://github.com/OpenStitching/stitching/blob/be1919b85c5b3935d16dcde0cdfa8ac7d7c7e03e/stitching/feature_matcher.py) · Apache-2.0 | Uses pairwise confidence graphs and global consistency. | Compare complete screenshot sequences. Do not discard disconnected inputs or warp/blend text as a panorama. |
| [scikit-image registration](https://github.com/scikit-image/scikit-image/blob/69a0f1f215cdadf65ba9fb0f40b3f2e5ae2cbfd7/src/_skimage2/registration/_phase_cross_correlation.py) · BSD-3-Clause for inspected code | Separates shift proposals from real-space disambiguation; masks invalid overlap. | Preserve competing candidates and verify actual overlapping content. Do not average incompatible peaks. |
| [Overmix](https://github.com/spillerrec/Overmix/blob/ebc2d3128a4024a7cb267ad0ecec210aa772efc7/src/aligners/IndependentAligner.cpp) · GPL-3.0-or-later | Separates comparison, alignment, and rendering; considers neighboring offsets. | Treat pair matches as evidence for a whole sequence. No GPL code copied, and no blending/subpixel reconstruction of text. |
| [Android Stitch Screenshots](https://github.com/nikitabobko/android-stitch-screenshots/blob/e3cab622ef0b838553f9ed7e3586f19a718416b2/src/MainActivity.kt) · MIT | Keeps original bitmaps with independent junction cuts and dimmed excluded regions. | Independent source cuts and source-rectangle export, with additional constraints between neighboring joins. |
| [AnLi image stitching](https://github.com/xfgryujk/AnLi-image-stitching/blob/65e478efaa71ced1694a76d79a034e50422e2aad/src/components/imageCanvas.vue) · MIT | Separates crop geometry from source images; provides reorder controls. | Preserve originals and render final cuts once. Per-image cuts are needed instead of shared subtitle-strip settings. |
| [screenStitch](https://github.com/jaflo/screenStitch/blob/308d30130808aa34fca4dc34ad8b75603242c98e/screenStitch.py) · MIT | Separates stationary surroundings from the changing region. | Useful comparison: first-pair bounds and single-row exact matching are too brittle for changing headers and repeated chat labels. |
| [Cropper.js](https://github.com/fengyuanchen/cropperjs/blob/d671590f32aa655eba87069b61b1e22ff0a2fb63/packages/element-selection/src/index.ts) · MIT | Keeps selection geometry separate, supports reset, keyboard movement, and invalid-change rejection. | Draft geometry, keyboard alternatives, reset, and bounded cuts without adding a general crop library. |
| [React Easy Crop](https://github.com/ValentinH/react-easy-crop/blob/91bfd8f0928ead345e5126a539edab4657d82993/src/helpers.ts) · MIT | Explicit source/display transforms and separate continuous/committed changes. | Zoom-independent source coordinates and draft/confirm behavior; no React dependency. |
| [TOAST UI Image Editor](https://github.com/nhn/tui.image-editor/blob/9ee993e21135a0bdb69d1400b19d89d7e78f7378/apps/image-editor/src/js/invoker.js) · MIT | Reversible commands and clear operation boundaries. | Keep unconfirmed edits local and restore existing cuts on reopen. Avoid raster recropping and the package's default hostname analytics. |
| [TOCropViewController](https://github.com/TimOliver/TOCropViewController/blob/f71823b513d4966ed9a66294b8d164369b1abc7d/Objective-C/TOCropViewController/Views/TOCropView.m) · MIT | Generous touch targets, gesture-start geometry, reset, and source-bound export. | Large handles, stable drag deltas, and clamped source rows on touch screens. |

For the interaction design, we also examined [Stitch It's official site](https://www.stitchitapp.com/),
[its iPhone guide](https://www.stitchitapp.com/blog/how-to-stitch-screenshots-on-iphone),
[official crop screenshot](https://www.stitchitapp.com/images/home/ios-crop.webp),
and a [published hands-on review](https://bamka.info/screenshot-merge-stitchit).
These illustrate transparent adjacent captures, independent top/bottom crops,
dashed boundaries, and large handles. The two-step upper-trim / lower-cut gesture
implements the requested workflow. An embedded YouTube link was found, but video
playback was unavailable; the design conclusions come from the published text
and screenshots.

Earlier registration work was informed by these public sources:

- [screenshot-stitcher](https://github.com/mate-matt/screenshot-stitcher/blob/af133ca54304f88a25c899d4c3c9b2976769a499/stitcher.py): multiple alignment proposals and overlap verification.
- [Seamly's OffsetMatcher](https://github.com/LiLiKazine/Seamly.app/blob/ed371adfc13151f95c95b6e3e8e3ff8790075d8d/Seamly/StitchKit/Sources/StitchKit/OffsetMatcher.swift) and [ChromeStaticRowDetector](https://github.com/LiLiKazine/Seamly.app/blob/ed371adfc13151f95c95b6e3e8e3ff8790075d8d/Seamly/StitchKit/Sources/StitchKit/ChromeStaticRowDetector.swift): distinct tile votes and stationary-row evidence for changing chrome.
- [OpenCV feature matching](https://docs.opencv.org/4.13.0/dc/dc3/tutorial_py_matcher.html): rejecting ambiguous correspondences by comparing competing matches.

These informed independently written TypeScript; no source from these projects
is bundled or required at runtime. Research involved reading public code only.
Private browser checks use the local app with outbound requests blocked during
image processing. User screenshots are not added to the repository or CI fixtures.
