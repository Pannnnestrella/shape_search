/**
 * 形状特征提取（纯函数，无 DOM 依赖）。
 * 浏览器端（用户草图）与离线索引脚本（图标库）共用同一套实现，
 * 保证两侧特征空间一致。
 *
 * 算法：找到墨迹包围盒 → 以包围盒长边为边长的正方形（居中）映射到
 * GRID×GRID 密度网格 → 每格取平均墨量的平方根 → L2 归一化。
 * 对平移、缩放不敏感，对笔触粗细有一定容忍度。
 */

export const GRID = 16;
export const FEATURE_DIM = GRID * GRID;

const INK_THRESHOLD = 0.15;

/**
 * @param ink 每像素墨量，0（空白）~ 1（全黑），长度 width*height
 * @returns L2 归一化后的特征向量；画面为空时返回 null
 */
export function extractFeatures(
  ink: Float32Array,
  width: number,
  height: number,
): Float32Array | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (ink[row + x] > INK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  // 过小的墨迹（误触的点）不足以构成形状
  if (bw < 3 && bh < 3) return null;

  const side = Math.max(bw, bh);
  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;
  const x0 = cx - side / 2;
  const y0 = cy - side / 2;

  const sums = new Float64Array(FEATURE_DIM);
  const counts = new Float64Array(FEATURE_DIM);
  const startX = Math.floor(x0);
  const startY = Math.floor(y0);
  for (let y = startY; y < y0 + side; y++) {
    for (let x = startX; x < x0 + side; x++) {
      let gx = Math.floor(((x - x0) / side) * GRID);
      let gy = Math.floor(((y - y0) / side) * GRID);
      if (gx < 0) gx = 0;
      else if (gx >= GRID) gx = GRID - 1;
      if (gy < 0) gy = 0;
      else if (gy >= GRID) gy = GRID - 1;
      const idx = gy * GRID + gx;
      counts[idx]++;
      if (x >= 0 && x < width && y >= 0 && y < height) {
        const v = ink[y * width + x];
        if (v > INK_THRESHOLD) sums[idx] += v;
      }
    }
  }

  const feat = new Float32Array(FEATURE_DIM);
  let norm = 0;
  for (let i = 0; i < FEATURE_DIM; i++) {
    const d = counts[i] > 0 ? Math.sqrt(sums[i] / counts[i]) : 0;
    feat[i] = d;
    norm += d * d;
  }
  if (norm === 0) return null;
  norm = Math.sqrt(norm);
  for (let i = 0; i < FEATURE_DIM; i++) feat[i] /= norm;
  return feat;
}

/** 两个已 L2 归一化向量的余弦相似度 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 按向量最大值缩放到 0~255，用于索引文件的紧凑存储 */
export function quantizeFeatures(feat: Float32Array): Uint8Array {
  let max = 0;
  for (let i = 0; i < feat.length; i++) if (feat[i] > max) max = feat[i];
  const out = new Uint8Array(feat.length);
  if (max === 0) return out;
  for (let i = 0; i < feat.length; i++) {
    out[i] = Math.round((feat[i] / max) * 255);
  }
  return out;
}

/** 反量化并重新 L2 归一化（余弦相似度对整体缩放不敏感） */
export function dequantizeFeatures(bytes: Uint8Array): Float32Array {
  const feat = new Float32Array(bytes.length);
  let norm = 0;
  for (let i = 0; i < bytes.length; i++) {
    feat[i] = bytes[i];
    norm += bytes[i] * bytes[i];
  }
  if (norm > 0) {
    norm = Math.sqrt(norm);
    for (let i = 0; i < feat.length; i++) feat[i] /= norm;
  }
  return feat;
}
