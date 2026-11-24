import JSZip from 'jszip';
import { ExtensionConfig } from '../types/chess';

const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'offscreen.html',
  'offscreen.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.js',
  'popup.css',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'engine/stockfish-19-lite-single.js',
  'engine/stockfish-19-lite-single.wasm'
];

const TEXT_EXTENSIONS = ['.json', '.js', '.html', '.css'];

export async function fetchExtensionSourceFiles(): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  const textFiles = EXTENSION_FILES.filter((f) => TEXT_EXTENSIONS.some((ext) => f.endsWith(ext)) && !f.startsWith('engine/'));
  await Promise.all(
    textFiles.map(async (relPath) => {
      const res = await fetch(`/extension/${relPath}`);
      if (res.ok) {
        entries[relPath] = await res.text();
      }
    })
  );
  return entries;
}

function patchDefaultSettings(source: string, config: ExtensionConfig): string {
  const block = `{\n  enabled: ${config.enabled},\n  showArrow: ${config.showArrow},\n  showHud: ${config.showHud},\n  depth: ${config.depth},\n  multiPv: ${config.multiPv},\n  arrowColor: '${config.arrowColor}'\n}`;
  return source
    .replace(/const DEFAULT_SETTINGS = \{[\s\S]*?\};/, `const DEFAULT_SETTINGS = ${block};`)
    .replace(/let settings = \{[\s\S]*?\};/, `let settings = ${block};`)
    .replace(/let currentSettings = \{[\s\S]*?\};/, `let currentSettings = ${block};`);
}

export async function buildCustomExtensionZip(config: ExtensionConfig): Promise<Blob> {
  const zip = new JSZip();

  await Promise.all(
    EXTENSION_FILES.map(async (relPath) => {
      const res = await fetch(`/extension/${relPath}`);
      if (!res.ok) {
        throw new Error(`파일을 불러오지 못했습니다: ${relPath}`);
      }
      if (relPath === 'background.js' || relPath === 'content.js' || relPath === 'popup.js') {
        const raw = await res.text();
        zip.file(relPath, patchDefaultSettings(raw, config));
      } else {
        const buf = await res.arrayBuffer();
        zip.file(relPath, buf);
      }
    })
  );

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
}
