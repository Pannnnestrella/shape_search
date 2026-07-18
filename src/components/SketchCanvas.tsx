import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

export type SketchTool = 'brush' | 'eraser';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  tool: SketchTool;
  size: number;
  points: Point[];
}

export interface SketchCanvasHandle {
  /** 以 1x 逻辑尺寸导出画布内容 */
  exportImageData(): ImageData | null;
  clear(): void;
  undo(): void;
  redo(): void;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  isEmpty: boolean;
}

interface Props {
  width: number;
  height: number;
  tool: SketchTool;
  brushSize: number;
  /** 一笔结束（pointerup）时触发，用于自动搜索 */
  onDrawEnd?: () => void;
  onHistoryChange?: (state: HistoryState) => void;
}

const INK_COLOR = '#1a1a1a';
const BG_COLOR = '#ffffff';

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const { points } = stroke;
  if (points.length === 0) return;
  const size = stroke.tool === 'eraser' ? stroke.size * 2.5 : stroke.size;
  ctx.strokeStyle = ctx.fillStyle = stroke.tool === 'eraser' ? BG_COLOR : INK_COLOR;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

export const SketchCanvas = forwardRef<SketchCanvasHandle, Props>(
  function SketchCanvas({ width, height, tool, brushSize, onDrawEnd, onHistoryChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const redoRef = useRef<Stroke[]>([]);
    const currentRef = useRef<Stroke | null>(null);

    const notifyHistory = useCallback(() => {
      onHistoryChange?.({
        canUndo: strokesRef.current.length > 0,
        canRedo: redoRef.current.length > 0,
        isEmpty: strokesRef.current.length === 0,
      });
    }, [onHistoryChange]);

    const redrawAll = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, width, height);
      for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
      if (currentRef.current) drawStroke(ctx, currentRef.current);
    }, [width, height]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      redrawAll();
    }, [width, height, redrawAll]);

    useImperativeHandle(
      ref,
      () => ({
        exportImageData() {
          const off = document.createElement('canvas');
          off.width = width;
          off.height = height;
          const ctx = off.getContext('2d');
          if (!ctx) return null;
          ctx.fillStyle = BG_COLOR;
          ctx.fillRect(0, 0, width, height);
          for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
          return ctx.getImageData(0, 0, width, height);
        },
        clear() {
          strokesRef.current = [];
          redoRef.current = [];
          currentRef.current = null;
          redrawAll();
          notifyHistory();
        },
        undo() {
          if (strokesRef.current.length === 0) return;
          redoRef.current.push(strokesRef.current.pop()!);
          redrawAll();
          notifyHistory();
        },
        redo() {
          if (redoRef.current.length === 0) return;
          strokesRef.current.push(redoRef.current.pop()!);
          redrawAll();
          notifyHistory();
        },
      }),
      [width, height, redrawAll, notifyHistory],
    );

    const getPos = (e: React.PointerEvent): Point => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handlePointerDown = (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      canvasRef.current?.setPointerCapture(e.pointerId);
      currentRef.current = { tool, size: brushSize, points: [getPos(e)] };
      redrawAll();
    };

    const handlePointerMove = (e: React.PointerEvent) => {
      if (!currentRef.current) return;
      currentRef.current.points.push(getPos(e));
      redrawAll();
    };

    const handlePointerUp = (e: React.PointerEvent) => {
      if (!currentRef.current) return;
      canvasRef.current?.releasePointerCapture(e.pointerId);
      strokesRef.current.push(currentRef.current);
      currentRef.current = null;
      redoRef.current = [];
      redrawAll();
      notifyHistory();
      onDrawEnd?.();
    };

    return (
      <canvas
        ref={canvasRef}
        className="sketch-canvas"
        style={{ width, height, touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    );
  },
);
