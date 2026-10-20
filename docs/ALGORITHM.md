# Screenshot stitching

`src/engine/index.ts` is an independent implementation. It does not contain
decompiled Tailor code or depend on REA. The browser decodes screenshots, normalizes
their widths, and sends RGBA pixels to a worker. The engine itself has no browser,
network, machine-learning, or third-party runtime dependency.

## Matching

1. Build 32-column RGB row signatures across the image. Include horizontal and
   vertical detail so plain backgrounds do not count as useful overlap evidence.
2. When enabled, compare rows at the same position to estimate repeated top and
   bottom chrome. Use the central half of the image for this step so a changing
   status clock, navigation badge, or scrollbar does not prevent matching.
3. Search possible bottom-to-top overlaps with vertically smoothed signatures,
   then refine separate promising peaks at individual source-pixel offsets.
4. Verify the leading candidates with denser row sampling. Reject featureless,
   poor, or ambiguous matches instead of choosing an arbitrary cut.
5. Check original pixels around high-contrast edges. This prevents matching two
   chat screens merely because their bubble layouts look similar while their
   message text differs. Fit one shared fractional-row offset during verification
   to tolerate resizing that puts the scroll translation between pixels. The
   same offset must explain the whole overlap; individual letters cannot shift
   independently to manufacture a match.

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
changing navigation badges, composer overlays, and fractional resizing, with
pixel comparisons or source-coordinate checks for missing/duplicated content.
Synthetic and bundled-fixture tests do not establish that every real-world
app or screenshot can be automatically stitched.
