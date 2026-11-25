import { readFileSync } from 'fs';
import { join } from 'path';

/** Read pnpm-patched SITNA sources. Missing dependencies must fail, not skip. */
export function nativeSource(path: string): string {
  return readFileSync(join(__dirname, '../../node_modules/api-sitna', path), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
}

export function between(source: string, start: string, end: string): string {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`SITNA source contract changed: ${start}`);
  return source.slice(first + start.length, last);
}

export function nativeHistoryConstructor(historySource = nativeSource('TC/tool/FeatureHistory.js')): new () => EventTarget & {
  setData(feature: unknown, data: Record<string, unknown>): {
    type: string; oldData: Record<string, unknown>; newData: Record<string, unknown>;
  };
  undo(feature: unknown): number;
  redo(feature: unknown): number;
  canUndo(feature: unknown): boolean;
  sitmunReset?(): void;
} {
  const eventClass = new Function(
    nativeSource('TC/tool/FeatureHistoryEvent.js').replace('export default class', 'return class')
  )();
  const source = historySource
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/^import .*;\n/m, '')
    .replace('export default FeatureHistory;', 'return FeatureHistory;');
  return new Function('FeatureHistoryEvent', source)(eventClass);
}
