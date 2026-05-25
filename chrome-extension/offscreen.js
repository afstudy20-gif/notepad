// ScrollDown - Offscreen Document
// Handles canvas stitching since service workers lack DOM access.

'use strict';

const MAX_CANVAS_DIMENSION = 32767; // Chromium max canvas dimension

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load capture image'));
    img.src = dataUrl;
  });
}

async function stitchCaptures(captures, dimensions, format, jpgQuality, limits = {}) {
  const { scrollHeight, viewportHeight, viewportWidth, devicePixelRatio } = dimensions;

  // Load all captured images
  const images = [];
  for (const capture of captures) {
    const img = await loadImage(capture.dataUrl);
    images.push({ img, scrollY: capture.scrollY });
  }

  if (images.length === 0) {
    throw new Error('No captures to stitch');
  }

  // Actual pixel dimensions from the captured viewport
  const captureWidth = images[0].img.width;
  const captureHeight = images[0].img.height;

  // Full output dimensions in device pixels, scaled down when needed so the
  // result can live inside the notepad's browser storage.
  const rawOutputWidth = captureWidth;
  const rawOutputHeight = Math.round(scrollHeight * devicePixelRatio);
  const maxHeight = Math.min(limits.maxHeight || MAX_CANVAS_DIMENSION, MAX_CANVAS_DIMENSION);
  const maxPixels = limits.maxPixels || Infinity;
  const scale = Math.min(
    1,
    maxHeight / Math.max(1, rawOutputHeight),
    Math.sqrt(maxPixels / Math.max(1, rawOutputWidth * rawOutputHeight))
  );
  const outputWidth = Math.max(1, Math.round(rawOutputWidth * scale));
  const outputHeight = Math.max(1, Math.round(rawOutputHeight * scale));

  // Clamp to browser max but don't scale — just crop if exceeding
  const canvasHeight = Math.min(outputHeight, MAX_CANVAS_DIMENSION);

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');

  // High quality rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (let i = 0; i < images.length; i++) {
    const { img, scrollY } = images[i];
    const destY = Math.round(scrollY * devicePixelRatio * scale);

    // Skip if this capture would be entirely beyond canvas bounds
    if (destY >= canvasHeight) continue;

    if (i === images.length - 1 && images.length > 1) {
      // Last capture: may overlap with previous
      // Calculate how much of the page remains after the last scroll
      const remainingPage = scrollHeight - scrollY;
      const remainingPixels = Math.round(remainingPage * devicePixelRatio);

      if (remainingPixels < captureHeight) {
        // Only draw the bottom portion that hasn't been captured yet
        const cropTop = captureHeight - remainingPixels;
        const sourceHeight = Math.min(remainingPixels, captureHeight - cropTop);
        const drawHeight = Math.min(Math.round(sourceHeight * scale), canvasHeight - destY);
        if (cropTop > 0 && sourceHeight > 0 && drawHeight > 0) {
          ctx.drawImage(
            img,
            0, cropTop, captureWidth, sourceHeight,
            0, destY, outputWidth, drawHeight
          );
          continue;
        }
      }
    }

    // Draw full capture at destination — clip to canvas bounds
    const drawHeight = Math.min(Math.round(captureHeight * scale), canvasHeight - destY);
    if (drawHeight > 0) {
      ctx.drawImage(
        img,
        0, 0, captureWidth, Math.min(captureHeight, Math.round(drawHeight / scale)),
        0, destY, outputWidth, drawHeight
      );
    }
  }

  // Export at full quality
  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const quality = format === 'jpg' ? jpgQuality : undefined;
  const resultDataUrl = canvas.toDataURL(mimeType, quality);

  return {
    dataUrl: resultDataUrl,
    width: canvas.width,
    height: canvas.height,
  };
}

// Listen for stitch requests from background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'stitch') {
    stitchCaptures(message.captures, message.dimensions, message.format, message.jpgQuality, {
      maxPixels: message.maxPixels,
      maxHeight: message.maxHeight
    })
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // Async
  }
});
