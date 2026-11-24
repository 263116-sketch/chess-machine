export interface EngineLine {
  multipv: number;
  depth: number;
  scoreType: 'cp' | 'mate';
  cp: number | null;
  mate: number | null;
  pvUci: string[];
  pvSan: string[];
  bestMove: string;
}

export interface AnalysisResult {
  fen: string;
  sideToMove: 'w' | 'b';
  depth: number;
  nps: number | null;
  bestMove: string | null;
  ponder: string | null;
  cp: number | null;
  mate: number | null;
  lines: EngineLine[];
  isSearching: boolean;
}

export interface ExtensionConfig {
  enabled: boolean;
  showArrow: boolean;
  showHud: boolean;
  depth: number;
  multiPv: number;
  arrowColor: string;
}

export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  enabled: true,
  showArrow: true,
  showHud: true,
  depth: 14,
  multiPv: 2,
  arrowColor: '#16a34a'
};
