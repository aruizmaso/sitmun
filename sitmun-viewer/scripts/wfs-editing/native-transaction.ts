import WFS from 'ol/format/WFS';
import { between, nativeSource } from './native-source';

/** Native sender and real OpenLayers serializer, with only HTTP substituted. */
export function transactionWriter(ajax: jest.Mock): (...args: unknown[]) => Promise<unknown> {
  const method = between(
    nativeSource('TC/ol/layer/Vector.js'),
    '    async sendTransaction(',
    '\n    setDraggable('
  );
  return new Function('WFS', 'TC', 'Consts', 'return async function(' + method)(
    WFS, { ajax }, { mimeType: { XML: 'application/xml' } }
  );
}
