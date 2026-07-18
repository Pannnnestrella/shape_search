import type { ShapeSearchResult } from '../types';
import { IconCard } from './IconCard';

interface Props {
  results: ShapeSearchResult[];
  selectedId: string | null;
  showScore?: boolean;
  emptyHint: string;
  onSelect: (result: ShapeSearchResult) => void;
  onCopy: (result: ShapeSearchResult) => void;
  onDownload: (result: ShapeSearchResult) => void;
}

export function SearchResults({
  results,
  selectedId,
  showScore,
  emptyHint,
  onSelect,
  onCopy,
  onDownload,
}: Props) {
  if (results.length === 0) {
    return <div className="results-empty">{emptyHint}</div>;
  }
  return (
    <div className="results-grid">
      {results.map((r) => (
        <IconCard
          key={r.id}
          result={r}
          selected={r.id === selectedId}
          showScore={showScore}
          onSelect={onSelect}
          onCopy={onCopy}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
}
