import { Chess } from 'chess.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalysisResult, EngineLine } from '../types/chess';

function uciPvToSan(fen: string, pvUci: string[]): string[] {
  try {
    const sim = new Chess(fen);
    const sanList: string[] = [];
    for (const uci of pvUci.slice(0, 6)) {
      if (!uci || uci.length < 4) break;
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      const move = sim.move({ from, to, promotion });
      if (!move) break;
      sanList.push(move.san);
    }
    return sanList;
  } catch {
    return pvUci.slice(0, 6);
  }
}

export function useStockfish() {
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const searchingRef = useRef(false);
  const currentReqRef = useRef<{
    fen: string;
    depth: number;
    multiPv: number;
    sideToMove: 'w' | 'b';
    lines: Record<number, EngineLine>;
    nps: number | null;
  } | null>(null);
  const pendingReqRef = useRef<{ fen: string; depth: number; multiPv: number } | null>(null);

  const [engineStatus, setEngineStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [analysis, setAnalysis] = useState<AnalysisResult>({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sideToMove: 'w',
    depth: 0,
    nps: null,
    bestMove: null,
    ponder: null,
    cp: 0,
    mate: null,
    lines: [],
    isSearching: false
  });

  const startSearchInternal = useCallback((req: { fen: string; depth: number; multiPv: number }) => {
    const worker = workerRef.current;
    if (!worker || !readyRef.current) {
      pendingReqRef.current = req;
      return;
    }
    if (searchingRef.current) {
      pendingReqRef.current = req;
      worker.postMessage('stop');
      return;
    }

    const sideToMove = (req.fen.split(' ')[1] === 'b' ? 'b' : 'w') as 'w' | 'b';
    currentReqRef.current = {
      fen: req.fen,
      depth: req.depth,
      multiPv: req.multiPv,
      sideToMove,
      lines: {},
      nps: null
    };
    searchingRef.current = true;

    setAnalysis((prev) => ({
      ...prev,
      fen: req.fen,
      sideToMove,
      isSearching: true
    }));

    worker.postMessage(`setoption name MultiPV value ${req.multiPv}`);
    worker.postMessage(`position fen ${req.fen}`);
    worker.postMessage(`go depth ${req.depth}`);
  }, []);

  useEffect(() => {
    try {
      const worker = new Worker('/engine/stockfish-19-lite-single.js');
      workerRef.current = worker;

      worker.onmessage = (event) => {
        const line = typeof event.data === 'string' ? event.data : String(event.data || '');

        if (line === 'uciok') {
          worker.postMessage('isready');
          return;
        }

        if (line === 'readyok') {
          readyRef.current = true;
          setEngineStatus('ready');
          if (pendingReqRef.current) {
            const next = pendingReqRef.current;
            pendingReqRef.current = null;
            startSearchInternal(next);
          }
          return;
        }

        if (line.startsWith('info ')) {
          const req = currentReqRef.current;
          if (!req) return;
          const tokens = line.trim().split(/\s+/);
          let depth: number | null = null;
          let multipv = 1;
          let scoreType: 'cp' | 'mate' | null = null;
          let scoreVal: number | null = null;
          let nps: number | null = null;
          let pv: string[] = [];

          for (let i = 1; i < tokens.length; i++) {
            const t = tokens[i];
            if (t === 'depth' && tokens[i + 1]) {
              depth = parseInt(tokens[++i], 10);
            } else if (t === 'multipv' && tokens[i + 1]) {
              multipv = parseInt(tokens[++i], 10);
            } else if (t === 'nps' && tokens[i + 1]) {
              nps = parseInt(tokens[++i], 10);
            } else if (t === 'score' && tokens[i + 1] && tokens[i + 2]) {
              const kind = tokens[++i];
              if (kind === 'cp' || kind === 'mate') {
                scoreType = kind;
                scoreVal = parseInt(tokens[++i], 10);
              }
            } else if (t === 'pv') {
              pv = tokens.slice(i + 1);
              break;
            }
          }

          if (depth == null || scoreType == null || scoreVal == null || pv.length === 0) return;

          const sign = req.sideToMove === 'b' ? -1 : 1;
          const cp = scoreType === 'cp' ? scoreVal * sign : null;
          const mate = scoreType === 'mate' ? scoreVal * sign : null;
          if (nps != null) req.nps = nps;

          req.lines[multipv] = {
            multipv,
            depth,
            scoreType,
            cp,
            mate,
            pvUci: pv,
            pvSan: uciPvToSan(req.fen, pv),
            bestMove: pv[0]
          };

          const sorted = Object.values(req.lines).sort((a, b) => a.multipv - b.multipv);
          const top = sorted[0];
          if (top) {
            setAnalysis({
              fen: req.fen,
              sideToMove: req.sideToMove,
              depth: top.depth,
              nps: req.nps,
              bestMove: top.bestMove,
              ponder: top.pvUci[1] || null,
              cp: top.cp,
              mate: top.mate,
              lines: sorted,
              isSearching: true
            });
          }
          return;
        }

        if (line.startsWith('bestmove ')) {
          const parts = line.trim().split(/\s+/);
          const bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
          const ponderIdx = parts.indexOf('ponder');
          const ponder = ponderIdx !== -1 ? parts[ponderIdx + 1] : null;

          const req = currentReqRef.current;
          if (req && !pendingReqRef.current) {
            const sorted = Object.values(req.lines).sort((a, b) => a.multipv - b.multipv);
            const top = sorted[0];
            setAnalysis({
              fen: req.fen,
              sideToMove: req.sideToMove,
              depth: top?.depth ?? req.depth,
              nps: req.nps,
              bestMove: bestMove ?? top?.bestMove ?? null,
              ponder: ponder ?? top?.pvUci[1] ?? null,
              cp: top?.cp ?? null,
              mate: top?.mate ?? null,
              lines: sorted,
              isSearching: false
            });
          }

          searchingRef.current = false;
          currentReqRef.current = null;

          if (pendingReqRef.current) {
            const next = pendingReqRef.current;
            pendingReqRef.current = null;
            startSearchInternal(next);
          }
        }
      };

      worker.onerror = () => {
        setEngineStatus('error');
      };

      worker.postMessage('uci');

      return () => {
        worker.terminate();
        workerRef.current = null;
      };
    } catch {
      setEngineStatus('error');
    }
  }, [startSearchInternal]);

  const analyze = useCallback(
    (fen: string, depth = 14, multiPv = 2) => {
      startSearchInternal({ fen, depth, multiPv });
    },
    [startSearchInternal]
  );

  return { engineStatus, analysis, analyze };
}
