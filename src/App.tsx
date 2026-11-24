import { Chess } from 'chess.js';
import {
  ArrowLeftRight,
  Check,
  Copy,
  Download,
  FileCode2,
  Play,
  RotateCcw,
  Undo2
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChessBoardView } from './components/ChessBoardView';
import { useStockfish } from './hooks/useStockfish';
import {
  DEFAULT_EXTENSION_CONFIG,
  EngineLine,
  ExtensionConfig
} from './types/chess';
import {
  buildCustomExtensionZip,
  fetchExtensionSourceFiles
} from './utils/extensionPackager';

type TabKey = 'test' | 'package' | 'source' | 'guide';

const PRESETS: { id: string; label: string; fen: string }[] = [
  {
    id: 'start',
    label: '시작 포지션',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  },
  {
    id: 'sicilian',
    label: '시실리안 나지도르프',
    fen: 'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6'
  },
  {
    id: 'queens-gambit',
    label: '퀸스 갬빗 디클라인드',
    fen: 'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4'
  },
  {
    id: 'mate-in-2',
    label: '전술 퍼즐 (백 선)',
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'
  }
];

const PACKAGE_MANIFEST_FILES = [
  { path: 'manifest.json', role: 'Manifest V3 설정 및 권한 정의', size: '0.8 KB' },
  { path: 'background.js', role: '서비스 워커 · Offscreen 관리 및 메시지 라우팅', size: '3.4 KB' },
  { path: 'content.js', role: 'Chess.com DOM 보드 파서 · SVG 화살표 · HUD', size: '9.8 KB' },
  { path: 'content.css', role: '오버레이 및 플로팅 HUD 스타일', size: '1.3 KB' },
  { path: 'offscreen.html', role: 'Stockfish Web Worker 실행용 Offscreen 호스트', size: '0.2 KB' },
  { path: 'offscreen.js', role: 'Stockfish 19 UCI 프로토콜 제어 및 다중 후보수 파서', size: '4.5 KB' },
  { path: 'popup.html', role: '툴바 팝업 제어판 마크업', size: '2.1 KB' },
  { path: 'popup.js', role: '설정 저장 · 실시간 평가 및 수동 FEN 분석', size: '3.2 KB' },
  { path: 'popup.css', role: '툴바 팝업 스타일', size: '2.4 KB' },
  { path: 'engine/stockfish-19-lite-single.js', role: 'Stockfish 19 WASM 자바스크립트 로더', size: '28 KB' },
  { path: 'engine/stockfish-19-lite-single.wasm', role: 'Stockfish 19 NNUE WebAssembly 바이너리', size: '1,802 KB' },
  { path: 'icons/icon16.png, 48.png, 128.png', role: '웹 스토어 필수 PNG 아이콘 세트', size: '6.2 KB' }
];

function formatLineEval(line: { cp: number | null; mate: number | null }): string {
  if (line.mate !== null) {
    return line.mate > 0 ? `+M${line.mate}` : `-M${Math.abs(line.mate)}`;
  }
  if (line.cp !== null) {
    const val = (line.cp / 100).toFixed(2);
    return line.cp >= 0 ? `+${val}` : val;
  }
  return '0.00';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('test');

  // Live Stockfish Test State
  const [game, setGame] = useState<Chess>(() => new Chess());
  const [fenInput, setFenInput] = useState(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  );
  const [fenError, setFenError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [testDepth, setTestDepth] = useState(14);
  const [testMultiPv, setTestMultiPv] = useState(2);

  // Extension Builder State
  const [extConfig, setExtConfig] = useState<ExtensionConfig>(DEFAULT_EXTENSION_CONFIG);
  const [isBuildingZip, setIsBuildingZip] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [lastBuiltAt, setLastBuiltAt] = useState<string | null>(null);

  // Source Code Inspector State
  const [sourceFiles, setSourceFiles] = useState<Record<string, string>>({});
  const [selectedSourceFile, setSelectedSourceFile] = useState<string>('manifest.json');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const { engineStatus, analysis, analyze } = useStockfish();

  const currentFen = useMemo(() => game.fen(), [game]);

  useEffect(() => {
    setFenInput(currentFen);
    analyze(currentFen, testDepth, testMultiPv);
  }, [currentFen, testDepth, testMultiPv, analyze]);

  useEffect(() => {
    fetchExtensionSourceFiles()
      .then((files) => {
        setSourceFiles(files);
        if (!files[selectedSourceFile]) {
          const first = Object.keys(files)[0];
          if (first) setSelectedSourceFile(first);
        }
      })
      .catch(() => {});
  }, [selectedSourceFile]);

  const handleBoardMove = useCallback((from: string, to: string, promotion = 'q') => {
    setGame((prev) => {
      const next = new Chess(prev.fen());
      try {
        const res = next.move({ from, to, promotion });
        if (!res) return prev;
        setFenError(null);
        return next;
      } catch {
        return prev;
      }
    });
  }, []);

  const handlePlayUciMove = useCallback(
    (uci: string) => {
      if (!uci || uci.length < 4) return;
      handleBoardMove(uci.slice(0, 2), uci.slice(2, 4), uci[4] || 'q');
    },
    [handleBoardMove]
  );

  const handleResetBoard = () => {
    setFenError(null);
    setGame(new Chess());
  };

  const handleUndoMove = () => {
    setGame((prev) => {
      const next = new Chess();
      const history = prev.history();
      if (history.length === 0) return prev;
      for (let i = 0; i < history.length - 1; i++) {
        next.move(history[i]);
      }
      return next;
    });
  };

  const handleLoadFen = (targetFen: string) => {
    try {
      const next = new Chess(targetFen.trim());
      setFenError(null);
      setGame(next);
    } catch {
      setFenError('유효하지 않은 FEN 형식입니다.');
    }
  };

  const handleCopyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      // Clipboard blocked in sandbox fallback ignored
    }
  };

  const handleDownloadCustomZip = async () => {
    setIsBuildingZip(true);
    setBuildError(null);
    try {
      const blob = await buildCustomExtensionZip(extConfig);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'chess-com-stockfish-advisor-v1.0.0.zip';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setLastBuiltAt(new Date().toLocaleTimeString('ko-KR'));
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : 'ZIP 패키징 중 오류가 발생했습니다.');
    } finally {
      setIsBuildingZip(false);
    }
  };

  const moveHistoryPairs = useMemo(() => {
    const moves = game.history();
    const pairs: { moveNum: number; white: string; black?: string }[] = [];
    for (let i = 0; i < moves.length; i += 2) {
      pairs.push({
        moveNum: Math.floor(i / 2) + 1,
        white: moves[i],
        black: moves[i + 1]
      });
    }
    return pairs;
  }, [game]);

  const sortedSourceNames = useMemo(() => Object.keys(sourceFiles).sort(), [sourceFiles]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Three-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('test');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            ChessAdvisor Studio
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('test')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'test'
                  ? 'border-emerald-700 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              라이브 테스트
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('package')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'package'
                  ? 'border-emerald-700 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              ZIP 빌드 설정
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('source')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'source'
                  ? 'border-emerald-700 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              확장 소스 코드
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('guide')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'guide'
                  ? 'border-emerald-700 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              웹 스토어 등록 가이드
            </button>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleDownloadCustomZip}
              disabled={isBuildingZip}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{isBuildingZip ? 'ZIP 생성 중...' : 'ZIP 파일 다운로드'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Tab Navigation */}
        <div className="flex md:hidden items-center gap-4 px-6 pb-3 overflow-x-auto text-xs font-medium text-slate-600">
          {(
            [
              ['test', '라이브 테스트'],
              ['package', 'ZIP 빌드 설정'],
              ['source', '확장 소스 코드'],
              ['guide', '웹 스토어 등록 가이드']
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`pb-1 border-b-2 whitespace-nowrap shrink-0 ${
                activeTab === key
                  ? 'border-emerald-700 text-slate-900 font-semibold'
                  : 'border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-8">
        {/* Page Summary Header */}
        <div className="mb-8 flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
              Chess.com 실시간 Stockfish 19 분석 확장 프로그램
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Manifest V3 패키지</span>
              <span aria-hidden="true">·</span>
              <span>Stockfish 19 WASM 로컬 내장</span>
              <span aria-hidden="true">·</span>
              <span>Chrome Web Store 업로드 규격 (.zip)</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <a
              href="/chess-com-stockfish-advisor-v1.0.0.zip"
              download="chess-com-stockfish-advisor-v1.0.0.zip"
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              기본 빌드 즉시 받기 (1.2 MB)
            </a>
          </div>
        </div>

        {/* TAB 1: LIVE TEST */}
        {activeTab === 'test' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Interactive Chessboard */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <ChessBoardView
                  fen={currentFen}
                  flipped={flipped}
                  arrowColor={extConfig.arrowColor}
                  lines={analysis.lines}
                  bestMove={analysis.bestMove}
                  cp={analysis.cp}
                  mate={analysis.mate}
                  onMove={handleBoardMove}
                />

                <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFlipped((f) => !f)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      <span>보드 뒤집기</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleUndoMove}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>무르기</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResetBoard}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>초기화</span>
                    </button>
                  </div>

                  <span className="text-xs text-slate-500 font-mono">
                    {game.turn() === 'w' ? '백(White) 차례' : '흑(Black) 차례'}
                  </span>
                </div>
              </div>

              {/* Preset Positions */}
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">
                  빠른 테스트 포지션
                </h2>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleLoadFen(preset.fen)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Live Stockfish 19 Output & Controls */}
            <div className="lg:col-span-6 flex flex-col gap-5">
              {/* Top Analysis Readout */}
              <section className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      확장 프로그램 탑재 엔진 실측 결과
                    </div>
                    <div className="mt-1 flex items-baseline gap-3">
                      <span className="font-mono text-3xl font-bold text-slate-900 tabular-nums">
                        {formatLineEval(analysis)}
                      </span>
                      <span className="font-mono text-lg font-semibold text-emerald-700 tabular-nums">
                        {analysis.bestMove
                          ? `${analysis.bestMove.slice(0, 2)} → ${analysis.bestMove.slice(2, 4)}`
                          : '계산 중'}
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono text-xs text-slate-500 tabular-nums">
                    <div>
                      엔진:{' '}
                      <span className="text-slate-900 font-semibold">
                        {engineStatus === 'ready'
                          ? analysis.isSearching
                            ? '탐색 중'
                            : '완료'
                          : engineStatus === 'loading'
                          ? '초기화 중'
                          : '오류'}
                      </span>
                    </div>
                    <div className="mt-1">
                      깊이: <span className="text-slate-900">d{analysis.depth}</span>
                      {analysis.nps ? (
                        <span> · {Math.round(analysis.nps / 1000).toLocaleString()}k nps</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* MultiPV Candidate Lines */}
                <div className="mt-4">
                  <div className="text-xs font-semibold text-slate-700 mb-2">
                    추천 수 순위 (클릭하여 보드에 착수)
                  </div>
                  {analysis.lines.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                      Stockfish 19 WASM 엔진이 후보 수를 계산하고 있습니다...
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                      {analysis.lines.map((line: EngineLine) => (
                        <button
                          key={line.multipv}
                          type="button"
                          onClick={() => handlePlayUciMove(line.bestMove)}
                          className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-xs font-semibold text-slate-400 w-5 shrink-0">
                              #{line.multipv}
                            </span>
                            <span
                              className={`font-mono text-xs font-bold w-14 shrink-0 ${
                                (line.cp ?? 0) >= 0 || (line.mate ?? 0) > 0
                                  ? 'text-emerald-700'
                                  : 'text-rose-700'
                              }`}
                            >
                              {formatLineEval(line)}
                            </span>
                            <span className="font-mono text-xs text-slate-800 truncate">
                              {line.pvSan.length > 0
                                ? line.pvSan.join(' ')
                                : line.pvUci.slice(0, 6).join(' ')}
                            </span>
                          </div>
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 shrink-0 whitespace-nowrap">
                            <Play className="w-3 h-3" />
                            착수
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Engine Parameters */}
                <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="live-depth"
                      className="flex justify-between text-xs font-medium text-slate-700 mb-1.5"
                    >
                      <span>탐색 깊이 (Depth)</span>
                      <span className="font-mono font-bold text-slate-900">{testDepth}</span>
                    </label>
                    <input
                      id="live-depth"
                      type="range"
                      min={8}
                      max={18}
                      value={testDepth}
                      onChange={(e) => setTestDepth(Number(e.target.value))}
                      className="w-full accent-emerald-700"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="live-multipv"
                      className="block text-xs font-medium text-slate-700 mb-1.5"
                    >
                      후보 수 개수 (MultiPV)
                    </label>
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                      {[1, 2, 3].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setTestMultiPv(n)}
                          className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                            testMultiPv === n
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {n}개
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* FEN & Move List */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="fen-tester" className="text-xs font-semibold text-slate-700">
                      현재 포지션 FEN
                    </label>
                    <button
                      type="button"
                      onClick={() => handleCopyText('fen', currentFen)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      {copiedKey === 'fen' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedKey === 'fen' ? '복사됨' : 'FEN 복사'}</span>
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="fen-tester"
                      type="text"
                      value={fenInput}
                      onChange={(e) => setFenInput(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    <button
                      type="button"
                      onClick={() => handleLoadFen(fenInput)}
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      적용
                    </button>
                  </div>
                  {fenError && <p className="mt-1.5 text-xs text-rose-600">{fenError}</p>}
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1.5">착수 기록</div>
                  {moveHistoryPairs.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      기물을 클릭해 이동하거나 추천 수의 &apos;착수&apos; 버튼을 눌러보세요.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-slate-700 max-h-28 overflow-y-auto">
                      {moveHistoryPairs.map((pair) => (
                        <span key={pair.moveNum}>
                          <span className="text-slate-400 mr-1">{pair.moveNum}.</span>
                          <span className="font-semibold text-slate-900 mr-1">{pair.white}</span>
                          {pair.black && <span>{pair.black}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* TAB 2: ZIP BUILDER & EXTENSION SETTINGS */}
        {activeTab === 'package' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">기본 확장 프로그램 설정</h2>
                <p className="mt-1 text-xs text-slate-500">
                  아래 설정을 조정한 뒤 다운로드하면 해당 기본값이 적용된 크롬 웹 스토어 업로드용 .zip 패키지가 생성됩니다.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="flex justify-between text-xs font-semibold text-slate-700 mb-1.5">
                    <span>기본 탐색 깊이 (Depth)</span>
                    <span className="font-mono text-slate-900">{extConfig.depth}</span>
                  </label>
                  <input
                    type="range"
                    min={8}
                    max={20}
                    value={extConfig.depth}
                    onChange={(e) =>
                      setExtConfig((prev) => ({ ...prev, depth: Number(e.target.value) }))
                    }
                    className="w-full accent-emerald-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    기본 MultiPV 후보 수 개수
                  </label>
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setExtConfig((prev) => ({ ...prev, multiPv: n }))}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          extConfig.multiPv === n
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {n}개
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    최선수 화살표 색상
                  </label>
                  <div className="flex items-center gap-2">
                    {[
                      { label: '에메랄드', hex: '#16a34a' },
                      { label: '코발트 블루', hex: '#0284c7' },
                      { label: '앰버', hex: '#d97706' }
                    ].map((swatch) => (
                      <button
                        key={swatch.hex}
                        type="button"
                        onClick={() =>
                          setExtConfig((prev) => ({ ...prev, arrowColor: swatch.hex }))
                        }
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-2 cursor-pointer ${
                          extConfig.arrowColor === swatch.hex
                            ? 'border-slate-900 bg-slate-50 text-slate-900'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: swatch.hex }}
                        />
                        <span>{swatch.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2 space-y-2.5 text-xs text-slate-700">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={extConfig.enabled}
                      onChange={(e) =>
                        setExtConfig((prev) => ({ ...prev, enabled: e.target.checked }))
                      }
                      className="rounded accent-emerald-700"
                    />
                    <span>Chess.com 접속 시 자동 실시간 분석 활성화</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={extConfig.showArrow}
                      onChange={(e) =>
                        setExtConfig((prev) => ({ ...prev, showArrow: e.target.checked }))
                      }
                      className="rounded accent-emerald-700"
                    />
                    <span>보드 위 SVG 화살표 오버레이 표시</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={extConfig.showHud}
                      onChange={(e) =>
                        setExtConfig((prev) => ({ ...prev, showHud: e.target.checked }))
                      }
                      className="rounded accent-emerald-700"
                    />
                    <span>우측 하단 평가 점수 플로팅 HUD 표시</span>
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleDownloadCustomZip}
                  disabled={isBuildingZip}
                  className="w-full py-2.5 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    {isBuildingZip
                      ? '패키지 빌드 중...'
                      : '커스텀 설정으로 .zip 다운로드'}
                  </span>
                </button>
                {lastBuiltAt && (
                  <p className="text-xs text-emerald-700 text-center">
                    {lastBuiltAt}에 chess-com-stockfish-advisor-v1.0.0.zip 생성 완료
                  </p>
                )}
                {buildError && <p className="text-xs text-rose-600 text-center">{buildError}</p>}
              </div>
            </section>

            {/* Right Column: ZIP Manifest Inventory */}
            <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">ZIP 패키지 내부 구성</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    루트 경로에 manifest.json이 포함된 Chrome Web Store 표준 구조
                  </p>
                </div>
                <span className="font-mono text-xs font-semibold text-slate-700">
                  MV3 · 1.2 MB (압축)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-2.5 px-6">경로</th>
                      <th className="py-2.5 px-4">역할</th>
                      <th className="py-2.5 px-6 text-right">원본 크기</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {PACKAGE_MANIFEST_FILES.map((item) => (
                      <tr key={item.path} className="hover:bg-slate-50">
                        <td className="py-2.5 px-6 font-mono font-medium text-slate-900">
                          {item.path}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{item.role}</td>
                        <td className="py-2.5 px-6 font-mono text-slate-500 text-right tabular-nums">
                          {item.size}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: SOURCE CODE INSPECTOR */}
        {activeTab === 'source' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-1">
              <div className="px-3 py-2 text-xs font-semibold text-slate-500">확장 프로그램 파일</div>
              {sortedSourceNames.map((fileName) => (
                <button
                  key={fileName}
                  type="button"
                  onClick={() => setSelectedSourceFile(fileName)}
                  className={`w-full px-3 py-2 rounded-lg text-left text-xs font-mono flex items-center gap-2 transition-colors cursor-pointer ${
                    selectedSourceFile === fileName
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <FileCode2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{fileName}</span>
                </button>
              ))}
            </aside>

            <section className="lg:col-span-9 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between gap-4">
                <span className="font-mono text-xs font-semibold text-slate-200">
                  {selectedSourceFile}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText('source', sourceFiles[selectedSourceFile] || '')
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md cursor-pointer"
                >
                  {copiedKey === 'source' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === 'source' ? '복사 완료' : '코드 복사'}</span>
                </button>
              </div>
              <pre className="p-5 text-xs font-mono leading-relaxed overflow-x-auto max-h-[620px] overflow-y-auto text-slate-200">
                <code>{sourceFiles[selectedSourceFile] || '소스 파일을 불러오는 중입니다...'}</code>
              </pre>
            </section>
          </div>
        )}

        {/* TAB 4: CHROME WEB STORE UPLOAD GUIDE */}
        {activeTab === 'guide' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-7 flex flex-col gap-6">
              <section className="bg-white border border-slate-200 rounded-xl p-6">
                <h2 className="text-base font-bold text-slate-900">
                  01. 왜 .crx가 아닌 .zip을 업로드하나요?
                </h2>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  크롬 웹 스토어 개발자 대시보드는 사용자가 직접 서명한 <code className="font-mono text-slate-900">.crx</code> 파일을 받지 않고, 루트에 <code className="font-mono text-slate-900">manifest.json</code>이 들어 있는 <code className="font-mono text-slate-900">.zip</code> 패키지를 업로드하면 구글이 자체 서명하여 배포용 <code className="font-mono text-slate-900">.crx</code>를 자동 생성합니다. 상단의 <strong>ZIP 파일 다운로드</strong>로 받은 파일을 그대로 업로드하시면 됩니다.
                </p>
              </section>

              <section className="bg-white border border-slate-200 rounded-xl p-6">
                <h2 className="text-base font-bold text-slate-900">
                  02. 크롬 브라우저 로컬 즉시 테스트 방법
                </h2>
                <ol className="mt-3 space-y-2.5 text-sm text-slate-700 list-decimal list-inside leading-relaxed">
                  <li>다운로드한 <code className="font-mono text-slate-900">chess-com-stockfish-advisor-v1.0.0.zip</code> 파일의 압축을 한 폴더에 풉니다.</li>
                  <li>크롬 주소창에 <code className="font-mono text-slate-900">chrome://extensions</code>를 입력해 이동한 뒤 우측 상단 <strong>개발자 모드</strong>를 켭니다.</li>
                  <li><strong>압축 해제된 확장 프로그램을 로드합니다</strong> 버튼을 누르고 압축을 푼 폴더(<code className="font-mono text-slate-900">manifest.json</code>이 있는 폴더)를 선택합니다.</li>
                  <li>Chess.com(분석 보드, 봇 대전, 복기 화면 등)에 접속하면 보드 위 SVG 추천 화살표와 우측 하단 Stockfish 평가 HUD가 즉시 동작합니다.</li>
                </ol>
              </section>

              <section className="bg-white border border-slate-200 rounded-xl p-6">
                <h2 className="text-base font-bold text-slate-900">
                  03. 크롬 웹 스토어 개발자 대시보드 업로드 절차
                </h2>
                <ol className="mt-3 space-y-2.5 text-sm text-slate-700 list-decimal list-inside leading-relaxed">
                  <li>Chrome Web Store Developer Dashboard에서 <strong>새 항목(New Item)</strong>을 클릭하고 다운로드한 <code className="font-mono text-slate-900">.zip</code> 파일을 업로드합니다.</li>
                  <li><strong>스토어 등록정보(Store Listing)</strong>에서 카테고리(생산성 또는 게임/도구), 설명, 1280×800 스크린샷을 등록합니다. (128×128 아이콘은 zip에 이미 포함되어 있습니다.)</li>
                  <li><strong>개인정보 보호(Privacy Practices)</strong> 탭에서 단일 목적 및 권한 사용 사유를 입력합니다(우측 템플릿 복사 활용).</li>
                  <li>원격 코드를 사용하지 않고 Stockfish 19 WASM을 패키지 내부에 포함했으므로 별도 원격 코드 심사를 통과하기 수월합니다.</li>
                </ol>
              </section>
            </div>

            <aside className="lg:col-span-5 flex flex-col gap-6">
              <section className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h2 className="text-sm font-bold text-slate-900">
                    웹 스토어 권한 소명 문구 (복사용)
                  </h2>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        'privacy',
                        'Single Purpose: Analyze Chess.com board positions locally using an embedded Stockfish 19 WebAssembly engine for study and post-game review.\n\noffscreen: Used solely to run the local Stockfish 19 WebAssembly Web Worker under Manifest V3 without external network requests.\n\nstorage: Used solely to persist user preferences (search depth, MultiPV count, overlay visibility).\n\nHost permission (https://www.chess.com/*): Used strictly to read the visible board piece positions from the DOM and render optional analysis arrow overlays.'
                      )
                    }
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 cursor-pointer"
                  >
                    {copiedKey === 'privacy' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'privacy' ? '복사됨' : '전체 복사'}</span>
                  </button>
                </div>

                <div className="space-y-3 text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono">
                  <p>
                    <strong className="text-slate-900">Single Purpose:</strong> Analyze Chess.com board positions locally using an embedded Stockfish 19 WebAssembly engine for study and post-game review.
                  </p>
                  <p>
                    <strong className="text-slate-900">offscreen:</strong> Run local Stockfish 19 WASM Web Worker under Manifest V3.
                  </p>
                  <p>
                    <strong className="text-slate-900">storage:</strong> Persist user depth, MultiPV, and overlay toggle settings.
                  </p>
                  <p>
                    <strong className="text-slate-900">Host (chess.com):</strong> Read board piece classes from DOM and render optional SVG arrows.
                  </p>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-xl p-6">
                <h2 className="text-sm font-bold text-slate-900">공정 플레이 정책 안내</h2>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  Chess.com의 Fair Play 정책상 실시간 레이팅 대전 중 외부 엔진의 도움을 받는 행위는 계정 제재 사유가 될 수 있습니다. 이 확장 프로그램은 대국 후 복기, 오프닝 연구, 봇 대전 또는 비공개 연습 보드 분석 목적으로 사용하시기 바랍니다.
                </p>
              </section>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
