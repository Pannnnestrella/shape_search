/**
 * 草图预处理：把画布像素转成统一的"墨量"表示。
 * 裁剪、缩放、居中在 shapeFeatures.extractFeatures 内部完成，
 * 这里只负责颜色归一化（白底黑线 → 0~1 墨量）。
 */

export interface InkImage {
  ink: Float32Array;
  width: number;
  height: number;
}

export function imageDataToInk(img: ImageData): InkImage {
  const { data, width, height } = img;
  const ink = new Float32Array(width * height);
  for (let i = 0, p = 0; i < ink.length; i++, p += 4) {
    const a = data[p + 3] / 255;
    // 按 alpha 与白底混合后取亮度，墨量 = 1 - 亮度
    const r = data[p] * a + 255 * (1 - a);
    const g = data[p + 1] * a + 255 * (1 - a);
    const b = data[p + 2] * a + 255 * (1 - a);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    ink[i] = 1 - lum / 255;
  }
  return { ink, width, height };
}
