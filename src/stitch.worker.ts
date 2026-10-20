import { planStitch, type PixelImage, type PlanOptions } from './engine';

self.onmessage = (event: MessageEvent<{ images: PixelImage[]; options: PlanOptions }>) => {
  try {
    self.postMessage({ plan: planStitch(event.data.images, event.data.options) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'The images could not be stitched.' });
  }
};
