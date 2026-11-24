import { Chess, Square } from 'chess.js';
import React, { useMemo, useState } from 'react';
import { EngineLine } from '../types/chess';
import { ChessPieceSvg } from './ChessPieces';

interface ChessBoardViewProps {
  fen: string;
  flipped: boolean;
  arrowColor: string;
  lines: EngineLine[];
  bestMove: string | null;
  cp: number | null;
  mate: number | null;
  onMove: (from: string, to: string, promotion?: string) => void;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

function squareToSvgPoint(sq: string, flipped: boolean) {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1], 10) - 1;
  const xIdx = flipped ? 7 - file : file;
  const yIdx = flipped ? rank : 7 - rank;
  return {
    x: xIdx * 100 + 50,
    y: yIdx * 100 + 50,
    rectX: xIdx * 100,
    rectY: yIdx * 100
  };
}

export const ChessBoardView: React.FC<ChessBoardViewProps> = ({
  fen,
  flipped,
  arrowColor,
  lines,
  bestMove,
  cp,
  mate,
  onMove
}) => {
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);

  const game = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  const legalTargets = useMemo(() => {
    if (!selectedSquare) return new Set<string>();
    const moves = game.moves({ square: selectedSquare, verbose: true });
    return new Set(moves.map((m) => m.to));
  }, [game, selectedSquare]);

  const boardRows = useMemo(() => {
    const raw = game.board(); // [rank 8..1][file a..h]
    const rows = flipped ? [...raw].reverse().map((r) => [...r].reverse()) : raw;
    return rows;
  }, [game, flipped]);

  const whiteBarPct = useMemo(() => {
    if (mate !== null) {
      return mate > 0 ? 100 : 0;
    }
    if (cp === null) return 50;
    const winProb = 1 / (1 + Math.exp(-0.0038 * cp));
    return Math.max(4, Math.min(96, winProb * 100));
  }, [cp, mate]);

  const evalLabel = useMemo(() => {
    if (mate !== null) {
      return mate > 0 ? `+M${mate}` : `-M${Math.abs(mate)}`;
    }
    if (cp === null) return '0.0';
    const pawns = (cp / 100).toFixed(1);
    return cp >= 0 ? `+${pawns}` : pawns;
  }, [cp, mate]);

  const handleSquareClick = (sq: Square) => {
    if (selectedSquare && legalTargets.has(sq)) {
      onMove(selectedSquare, sq, 'q');
      setSelectedSquare(null);
      return;
    }

    const piece = game.get(sq);
    if (piece && piece.color === game.turn()) {
      setSelectedSquare(sq === selectedSquare ? null : sq);
    } else {
      setSelectedSquare(null);
    }
  };

  const arrowLines = useMemo(() => {
    if (lines.length > 0) return lines;
    if (bestMove) {
      return [
        {
          multipv: 1,
          depth: 0,
          scoreType: 'cp' as const,
          cp,
          mate,
          pvUci: [bestMove],
          pvSan: [],
          bestMove
        }
      ];
    }
    return [];
  }, [lines, bestMove, cp, mate]);

  const topMove = arrowLines[0]?.bestMove || null;

  return (
    <div className="flex items-stretch gap-3 select-none">
      {/* Vertical Evaluation Bar */}
      <div
        className="w-8 rounded-md border border-slate-300 bg-slate-900 overflow-hidden flex flex-col justify-between relative shrink-0"
        title="백 기준 평가 막대"
      >
        <div
          className="w-full bg-slate-100 transition-all duration-300 ease-out"
          style={{
            height: flipped ? `${whiteBarPct}%` : `${100 - whiteBarPct}%`,
            backgroundColor: flipped ? '#f8fafc' : '#0f172a'
          }}
        />
        <div
          className="w-full flex-1 transition-all duration-300 ease-out"
          style={{
            backgroundColor: flipped ? '#0f172a' : '#f8fafc'
          }}
        />
        <span
          className={`absolute left-0 right-0 text-center font-mono text-[10px] font-bold px-0.5 ${
            whiteBarPct >= 50
              ? 'bottom-1.5 text-slate-900'
              : 'top-1.5 text-slate-100'
          }`}
        >
          {evalLabel}
        </span>
      </div>

      {/* 8x8 Chessboard + SVG Overlay */}
      <div className="relative aspect-square w-full max-w-[520px] rounded-md overflow-hidden border border-slate-300 shadow-sm">
        <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
          {boardRows.map((row, rIdx) =>
            row.map((cell, fIdx) => {
              const rankName = flipped ? RANKS[7 - rIdx] : RANKS[rIdx];
              const fileName = flipped ? FILES[7 - fIdx] : FILES[fIdx];
              const sq = `${fileName}${rankName}` as Square;
              const isLight = (rIdx + fIdx) % 2 === 0;
              const isSelected = selectedSquare === sq;
              const isLegal = legalTargets.has(sq);
              const isBestOrigin = topMove?.slice(0, 2) === sq;
              const isBestTarget = topMove?.slice(2, 4) === sq;

              return (
                <button
                  key={sq}
                  type="button"
                  onClick={() => handleSquareClick(sq)}
                  className="relative flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700"
                  style={{
                    backgroundColor: isLight ? '#EBECD0' : '#739552'
                  }}
                  aria-label={`Square ${sq}`}
                >
                  {(isSelected || isBestOrigin || isBestTarget) && (
                    <span
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundColor: isSelected
                          ? 'rgba(250, 204, 21, 0.45)'
                          : `${arrowColor}33`
                      }}
                    />
                  )}

                  {fIdx === 0 && (
                    <span
                      className="absolute top-0.5 left-1 font-mono text-[10px] font-semibold leading-none pointer-events-none"
                      style={{ color: isLight ? '#739552' : '#EBECD0' }}
                    >
                      {rankName}
                    </span>
                  )}

                  {rIdx === 7 && (
                    <span
                      className="absolute bottom-0.5 right-1 font-mono text-[10px] font-semibold leading-none pointer-events-none"
                      style={{ color: isLight ? '#739552' : '#EBECD0' }}
                    >
                      {fileName}
                    </span>
                  )}

                  {cell && (
                    <ChessPieceSvg code={`${cell.color}${cell.type.toUpperCase()}`} />
                  )}

                  {isLegal && !cell && (
                    <span className="w-3.5 h-3.5 rounded-full bg-slate-900/25 pointer-events-none" />
                  )}
                  {isLegal && cell && (
                    <span className="absolute inset-1 rounded-full border-[3px] border-slate-900/30 pointer-events-none" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* SVG Best-Move Arrow Overlay (mirrors extension content.js) */}
        <svg
          viewBox="0 0 800 800"
          className="absolute inset-0 w-full h-full pointer-events-none z-20"
          aria-hidden="true"
        >
          <defs>
            {arrowLines.map((line, idx) => {
              const color = idx === 0 ? arrowColor : idx === 1 ? '#0284c7' : '#d97706';
              return (
                <marker
                  key={line.multipv}
                  id={`studio-arrow-${idx}`}
                  markerWidth="4"
                  markerHeight="4"
                  refX="2.5"
                  refY="2"
                  orient="auto"
                >
                  <path d="M 0 0 L 4 2 L 0 4 z" fill={color} />
                </marker>
              );
            })}
          </defs>

          {[...arrowLines].reverse().map((line, revIdx) => {
            const idx = arrowLines.length - 1 - revIdx;
            const uci = line.bestMove;
            if (!uci || uci.length < 4) return null;
            const from = squareToSvgPoint(uci.slice(0, 2), flipped);
            const to = squareToSvgPoint(uci.slice(2, 4), flipped);
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const len = Math.hypot(dx, dy) || 1;
            const x2 = to.x - (dx / len) * 22;
            const y2 = to.y - (dy / len) * 22;
            const color = idx === 0 ? arrowColor : idx === 1 ? '#0284c7' : '#d97706';

            return (
              <line
                key={`${line.multipv}-${uci}`}
                x1={from.x}
                y1={from.y}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={idx === 0 ? 15 : 10}
                strokeLinecap="round"
                strokeOpacity={idx === 0 ? 0.9 : 0.45}
                markerEnd={`url(#studio-arrow-${idx})`}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
};
