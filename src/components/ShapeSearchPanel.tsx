import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShapeSearchCallbacks, ShapeSearchResult } from '../types';
import { imageDataToInk } from '../services/preprocess';
import { extractFeatures } from '../services/shapeFeatures';
import { availableSources, loadIconIndex, searchIcons } from '../services/iconSearch';
import {
  SketchCanvas,
  type HistoryState,
  type SketchCanvasHandle,
  type SketchTool,
} from './SketchCanvas';
import { SearchResults } from './SearchResults';

const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 260;
const AUTO_SEARCH_DELAY = 400;

const SOURCE_LABELS: Record<string, string> = {
  lucide: 'Lucide',
  tabler: 'Tabler',
  heroicons: 'Heroicons',
  material: 'Material',
  bootstrap: 'Bootstrap',
  phosphor: 'Phosphor',
  remix: 'Remix',
};

interface Props extends ShapeSearchCallbacks {
  /** 返回结果的最大数量，默认 60 */
  maxResults?: number;
  /** 是否显示相似度分数，默认显示 */
  showScore?: boolean;
}

export function ShapeSearchPanel({
  maxResults = 60,
  showScore = true,
  onSelect,
  onCopy,
  onDownload,
  onSearch,
}: Props) {
  const canvasRef = useRef<SketchCanvasHandle>(null);
  const autoTimerRef = useRef<number | undefined>(undefined);

  const [tool, setTool] = useState<SketchTool>('brush');
  const [brushSize, setBrushSize] = useState(5);
  const [history, setHistory] = useState<HistoryState>({
    canUndo: false,
    canRedo: false,
    isEmpty: true,
  });
  const [autoSearch, setAutoSearch] = useState(true);
  const allSources = useMemo(() => availableSources(), []);
  const [enabledSources, setEnabledSources] = useState<string[]>(allSources);
  const [results, setResults] = useState<ShapeSearchResult[]>([]);
  const [selected, setSelected] = useState<ShapeSearchResult | null>(null);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('画出你想寻找的形状');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [iconCount, setIconCount] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadIconIndex(enabledSources)
      .then((icons) => setIconCount(icons.length))
      .catch(() => setStatus('图标索引加载失败，请先运行 npm run build:icons'));
  }, [enabledSources]);

  const doSearch = useCallback(async () => {
    const img = canvasRef.current?.exportImageData();
    if (!img) return;
    const { ink, width, height } = imageDataToInk(img);
    const feature = extractFeatures(ink, width, height);
    if (!feature) {
      setResults([]);
      setElapsed(null);
      setStatus('画布是空的，先画一个形状再搜索');
      return;
    }
    onSearch?.({ type: 'drawing', image: img, width, height });
    setSearching(true);
    try {
      const t0 = performance.now();
      const icons = await loadIconIndex(enabledSources);
      const found = searchIcons(feature, icons, maxResults);
      setElapsed(performance.now() - t0);
      setResults(found);
      setStatus('');
    } catch {
      setStatus('搜索失败：图标索引不可用');
    } finally {
      setSearching(false);
    }
  }, [maxResults, onSearch, enabledSources]);

  const toggleSource = useCallback(
    (source: string) => {
      setEnabledSources((prev) =>
        prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source],
      );
    },
    [],
  );

  // 切换图标库后，若画布上已有内容则自动重新搜索
  useEffect(() => {
    if (!history.isEmpty) doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledSources]);

  const handleDrawEnd = useCallback(() => {
    if (!autoSearch) return;
    window.clearTimeout(autoTimerRef.current);
    autoTimerRef.current = window.setTimeout(doSearch, AUTO_SEARCH_DELAY);
  }, [autoSearch, doSearch]);

  useEffect(() => () => window.clearTimeout(autoTimerRef.current), []);

  const handleSelect = useCallback(
    (result: ShapeSearchResult) => {
      setSelected(result);
      if (onSelect) {
        onSelect(result);
      } else {
        // 独立运行时，选择即复制 SVG
        navigator.clipboard?.writeText(result.svg);
        setStatus(`已复制 ${result.name} 的 SVG`);
      }
    },
    [onSelect],
  );

  const handleCopy = useCallback(
    (result: ShapeSearchResult) => {
      navigator.clipboard?.writeText(result.svg);
      setStatus(`已复制 ${result.name} 的 SVG`);
      onCopy?.(result);
    },
    [onCopy],
  );

  const handleDownload = useCallback(
    (result: ShapeSearchResult) => {
      const blob = new Blob([result.svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${result.name}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      onDownload?.(result);
    },
    [onDownload],
  );

  const visibleResults = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return results;
    return results.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [results, filter]);

  return (
    <div className="shape-search-panel">
      <header className="panel-header">
        <h1>Shape Search</h1>
        <p>画出你想寻找的形状，搜索外形相似的图标</p>
      </header>

      <div className="toolbar">
        <button
          type="button"
          className={tool === 'brush' ? 'active' : ''}
          onClick={() => setTool('brush')}
        >
          画笔
        </button>
        <button
          type="button"
          className={tool === 'eraser' ? 'active' : ''}
          onClick={() => setTool('eraser')}
        >
          橡皮
        </button>
        <span className="toolbar-sep" />
        <button
          type="button"
          disabled={!history.canUndo}
          onClick={() => canvasRef.current?.undo()}
        >
          撤销
        </button>
        <button
          type="button"
          disabled={!history.canRedo}
          onClick={() => canvasRef.current?.redo()}
        >
          重做
        </button>
        <button
          type="button"
          disabled={history.isEmpty}
          onClick={() => {
            canvasRef.current?.clear();
            setResults([]);
            setSelected(null);
            setElapsed(null);
            setStatus('画出你想寻找的形状');
          }}
        >
          清空
        </button>
        <label className="brush-size">
          粗细
          <input
            type="range"
            min={2}
            max={14}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
        </label>
      </div>

      <SketchCanvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        tool={tool}
        brushSize={brushSize}
        onDrawEnd={handleDrawEnd}
        onHistoryChange={setHistory}
      />

      <div className="search-controls">
        <button
          type="button"
          className="search-button"
          disabled={searching || iconCount === null}
          onClick={doSearch}
        >
          {searching ? '搜索中…' : '搜索'}
        </button>
        <label className="auto-search">
          <input
            type="checkbox"
            checked={autoSearch}
            onChange={(e) => setAutoSearch(e.target.checked)}
          />
          自动搜索
        </label>
        <input
          className="filter-input"
          type="text"
          placeholder="按名称筛选结果"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="source-chips">
        <span className="source-chips-label">图标库</span>
        {allSources.map((s) => (
          <button
            key={s}
            type="button"
            className={enabledSources.includes(s) ? 'active' : ''}
            onClick={() => toggleSource(s)}
          >
            {SOURCE_LABELS[s] ?? s}
          </button>
        ))}
      </div>

      {status && <div className="panel-status-message">{status}</div>}

      <div className="results-area">
        <SearchResults
          results={visibleResults}
          selectedId={selected?.id ?? null}
          showScore={showScore}
          emptyHint={
            results.length === 0
              ? '搜索结果会显示在这里'
              : '没有匹配筛选词的结果'
          }
          onSelect={handleSelect}
          onCopy={handleCopy}
          onDownload={handleDownload}
        />
      </div>

      <footer className="panel-footer">
        <span>
          {iconCount === null ? '索引加载中…' : `图标库 ${iconCount}`}
        </span>
        {elapsed !== null && <span>{elapsed.toFixed(0)} ms</span>}
        {results.length > 0 && <span>{visibleResults.length} 个结果</span>}
        {selected && (
          <span className="footer-selected" title={selected.id}>
            已选 {selected.name}
          </span>
        )}
      </footer>
    </div>
  );
}
