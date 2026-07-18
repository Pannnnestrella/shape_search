import type { ShapeSearchResult } from '../types';

interface Props {
  result: ShapeSearchResult;
  selected: boolean;
  showScore?: boolean;
  onSelect: (result: ShapeSearchResult) => void;
  onCopy: (result: ShapeSearchResult) => void;
  onDownload: (result: ShapeSearchResult) => void;
}

export function IconCard({ result, selected, showScore, onSelect, onCopy, onDownload }: Props) {
  return (
    <div
      className={`icon-card${selected ? ' selected' : ''}`}
      title={`${result.name} · ${result.source}`}
      onClick={() => onSelect(result)}
    >
      <div
        className="icon-card-preview"
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
      <div className="icon-card-name">{result.name}</div>
      {showScore && (
        <div className="icon-card-score">{Math.round(result.score * 100)}%</div>
      )}
      <div className="icon-card-actions">
        <button
          type="button"
          title="复制 SVG"
          onClick={(e) => {
            e.stopPropagation();
            onCopy(result);
          }}
        >
          复制
        </button>
        <button
          type="button"
          title="下载 SVG"
          onClick={(e) => {
            e.stopPropagation();
            onDownload(result);
          }}
        >
          下载
        </button>
      </div>
    </div>
  );
}
