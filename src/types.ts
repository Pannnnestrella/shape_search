export interface ShapeSearchResult {
  /** 图标唯一标识 */
  id: string;
  /** 图标名称 */
  name: string;
  /** 图标库名称 */
  source: string;
  /** SVG 原始字符串 */
  svg: string;
  /** 预览地址或 Data URL（可选，SVG 本身可直接内联渲染） */
  preview?: string;
  /** 相似度分数，0~1 */
  score: number;
  /** 图标标签 */
  tags?: string[];
  /** 图标分类 */
  category?: string;
}

export interface ShapeSearchInput {
  type: 'drawing' | 'selection';
  image: Blob | ImageData | string;
  width: number;
  height: number;
}

export interface ShapeSearchCallbacks {
  /** 用户选择某个图标时触发 */
  onSelect?: (result: ShapeSearchResult) => void;
  onCopy?: (result: ShapeSearchResult) => void;
  onDownload?: (result: ShapeSearchResult) => void;
  onSearch?: (query: ShapeSearchInput) => void;
}
