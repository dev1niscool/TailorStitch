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
Manual overlaps retain their explicitly requested cut.

Exact duplicate images are skipped. Optional ordering searches for an
unambiguous directed chain of matching screenshots. When the order is
inconclusive, the supplied order is retained.

Uncertain or unrelated joins set `needsReview`. Their previews concatenate the
screenshots without removing content. An explicit manual overlap resolves the
join; manual overlaps are measured after the user crops and detected chrome.
No uncertain inferred cut is silently applied.

## Practical limits

This is vertical translation matching. Screenshots should come from the same
screen, at the same zoom, with a useful shared section—about a quarter to a third
of the screen is a good starting point. Repeated list items, mostly blank
screens, changing video or animation, expanding headers, sideways movement,
and different layouts or zoom levels may need manual order or overlap
adjustments. Matching cannot restore content that was never captured.
Automatic ordering can remain inconclusive when a short repeated label supports
a potential reverse join. The current order is retained, and unverified joins
require review.

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
and export without manual overlap adjustments.
Synthetic and bundled-fixture tests do not establish that every real-world
app or screenshot can be automatically stitched.

## Research references

The registration changes were informed by public source and documentation:

- [screenshot-stitcher](https://github.com/mate-matt/screenshot-stitcher/blob/af133ca54304f88a25c899d4c3c9b2976769a499/stitcher.py): multiple alignment proposals and overlap verification.
- [Seamly's OffsetMatcher](https://github.com/LiLiKazine/Seamly.app/blob/ed371adfc13151f95c95b6e3e8e3ff8790075d8d/Seamly/StitchKit/Sources/StitchKit/OffsetMatcher.swift) and [ChromeStaticRowDetector](https://github.com/LiLiKazine/Seamly.app/blob/ed371adfc13151f95c95b6e3e8e3ff8790075d8d/Seamly/StitchKit/Sources/StitchKit/ChromeStaticRowDetector.swift): distinct tile votes and stationary-row evidence for changing chrome.
- [OpenCV feature matching](https://docs.opencv.org/4.13.0/dc/dc3/tutorial_py_matcher.html): rejecting ambiguous correspondences by comparing competing matches.

These informed independently written TypeScript; no source from these projects
is bundled or required at runtime. Research involved reading public code only.
Private browser checks use the local app with outbound requests blocked during
image processing. User screenshots are not added to the repository or CI fixtures.
