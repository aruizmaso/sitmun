import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { serializeWfsAttributeTransaction } from '../../src/app/utils/wfs-attribute-transaction';
import type { WfsAttributeSchema } from '../../src/app/utils/wfs-attribute-schema';
import { transactionWriter } from './native-transaction';

const ns = 'http://menorca';
const gml = 'http://www.opengis.net/gml';
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml');
const schema: WfsAttributeSchema = { featureType: `{${ns}}shops`, namespaces: { menorca: ns, gml }, issues: [],
  fields: ['id', 'gml:name', 'name', 'category', 'city', 'municipality', 'scope', 'geom'].map(key => ({
    name: key.split(':').at(-1)!, namespace: key.startsWith('gml:') ? gml : ns, type: 'string',
    minOccurs: '0', maxOccurs: '1', nillable: true, defaultValue: null, fixedValue: null, facets: [], reasons: []
  })) };
const parent = {
  options: { featureType: ['menorca:shops'] }, capabilities: { 'xmlns:menorca': ns },
  map: { crs: 'EPSG:3857' }, getFeatureTypeMetadata: async () => ({ geometries: [{ name: 'geom' }] }),
  sitmunLoadAttributeTransaction: async () => (xml: Element, inserts: Feature[], updates: Feature[], geometry: string) =>
    serializeWfsAttributeTransaction(xml, inserts, updates, schema, geometry)
};
const captured = { 'menorca:name': 'Botiga', category: 'shop', city: 'Maó', municipality: 'Maó', scope: 'provided' };

describe('SITNA WFS transactions', () => {
  it.each([
    { featureType: ['menorca:shops'] },
    { featureType: 'menorca:shops' },
    { featureType: ['shops'], featurePrefix: 'menorca' },
    { featureType: ['shops'], featureNS: 'menorca' }
  ])('uses the schema geometry and qualified layer name: %j', async (options) => {
    const feature = new Feature(new Point([587581, 4419497]));
    feature.setId('shops.408');
    feature.set('gml:boundedBy', [587581, 4419497, 587581, 4419497]);
    feature.setProperties(captured);
    feature.set('id', 'business-id');
    const ajax = jest.fn().mockResolvedValue({ data: new DOMParser().parseFromString(
      '<wfs:TransactionResponse xmlns:wfs="http://www.opengis.net/wfs" version="1.1.0"><wfs:TransactionSummary><wfs:totalInserted>1</wfs:totalInserted><wfs:totalUpdated>1</wfs:totalUpdated><wfs:totalDeleted>1</wfs:totalDeleted></wfs:TransactionSummary></wfs:TransactionResponse>', 'text/xml'
    ) });
    const wrapped = { wrap: { feature } };
    await transactionWriter(ajax).call({ getLayer: async () => {}, parent: { ...parent, options } }, [wrapped], [wrapped], [wrapped]);
    expect(ajax).toHaveBeenCalledTimes(1);
    const transaction = new DOMParser().parseFromString(ajax.mock.calls[0][0].data, 'text/xml').documentElement;

    const inserted = transaction.getElementsByTagNameNS('http://menorca', 'shops')[0];
    expect(inserted.tagName).toBe('menorca:shops');
    expect(inserted.hasAttribute('fid')).toBe(false);
    expect(inserted.hasAttributeNS('http://www.opengis.net/gml/3.2', 'id')).toBe(false);
    expect(feature.getId()).toBe('shops.408');
    expect(inserted.getElementsByTagNameNS('http://menorca', 'id')[0].textContent).toBe('business-id');
    expect(inserted.getElementsByTagNameNS(ns, 'geom')).toHaveLength(1);
    expect(inserted.getElementsByTagNameNS(ns, 'name')).toHaveLength(1);
    expect(inserted.getElementsByTagNameNS(ns, 'name')[0].textContent).toBe('Botiga');
    expect(inserted.getElementsByTagNameNS(gml, 'name')).toHaveLength(0);
    expect(inserted.getElementsByTagNameNS(ns, 'scope')[0].textContent).toBe('provided');
    expect(inserted.getElementsByTagNameNS(gml, 'Point')[0].getAttribute('srsName')).toBe('EPSG:3857');
    expect(inserted.getElementsByTagNameNS(gml, 'pos')[0].textContent).toBe('587581 4419497');
    expect(inserted.getElementsByTagNameNS('http://menorca', 'geometry')).toHaveLength(0);
    expect(feature.getGeometryName()).toBe('geometry');
    expect(feature.getGeometry()).toBeInstanceOf(Point);
    expect(feature.get('gml:boundedBy')).toEqual([587581, 4419497, 587581, 4419497]);
    expect(inserted.getElementsByTagNameNS('http://menorca', 'category')[0].textContent).toBe('shop');
    expect(transaction.outerHTML).not.toContain('boundedBy');
    for (const operation of ['Update', 'Delete']) {
      const node = transaction.getElementsByTagNameNS('http://www.opengis.net/wfs', operation)[0];
      expect(node.getAttribute('typeName')).toBe('menorca:shops');
      expect(node.getAttribute('xmlns:menorca')).toBe('http://menorca');
      expect(node.getElementsByTagNameNS('http://www.opengis.net/ogc', 'FeatureId')[0].getAttribute('fid')).toBe('shops.408');
    }
  });

  it('rejects inserts without schema geometry instead of sending an invalid transaction', async () => {
    const ajax = jest.fn();
    const send = transactionWriter(ajax);
    const request = send.call({ getLayer: async () => {}, parent: {
      getFeatureTypeMetadata: async () => ({ geometries: [] })
    } }, [{ wrap: { feature: new Feature(new Point([0, 0])) } }], [], []);

    await expect(request).rejects.toMatchObject({ stage: 'preparation', outcome: 'notSent', reason: expect.stringContaining('DescribeFeatureType') });
    expect(ajax).not.toHaveBeenCalled();
  });

  it('runs the viewer attribute serializer before the existing POST and propagates serialization errors', async () => {
    const ajax = jest.fn();
    const feature = new Feature(new Point([0, 0]));
    feature.setId('shops.1');
    const serialize = jest.fn((_transaction: Element) => { throw new Error('Invalid structured attribute'); });
    await expect(transactionWriter(ajax).call({ getLayer: async () => {}, parent: {
      options: { featureType: ['menorca:shops'] }, capabilities: { 'xmlns:menorca': 'http://menorca' },
      sitmunLoadAttributeTransaction: async () => serialize
    } }, [], [{ wrap: { feature } }], [])).rejects.toMatchObject({ reason: 'Invalid structured attribute' });
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(serialize.mock.calls[0][0]).toBeInstanceOf(Element);
    expect(ajax).not.toHaveBeenCalled();
    expect(feature.getGeometry()?.getCoordinates()).toEqual([0, 0]);
  });

  it('runs the mandatory field policy even without an attribute panel and preserves conflicting identities', async () => {
    const ajax = jest.fn();
    const feature = new Feature(new Point([0, 0])); feature.setId('shops.1');
    const policy = jest.fn(() => { throw Object.assign(new Error('attributeForbidden'), {attributes: ['{http://menorca}name']}); });
    await expect(transactionWriter(ajax).call({getLayer: async () => {}, parent: {
      options: {featureType: ['menorca:shops']}, capabilities: {'xmlns:menorca': 'http://menorca'},
      sitmunPrepareAttributeTransaction: policy
    }}, [], [{wrap: {feature}}], [])).rejects.toMatchObject({attributes: ['{http://menorca}name']});
    expect(policy).toHaveBeenCalledTimes(1);
    expect(ajax).not.toHaveBeenCalled();
  });

  it('does not report a malformed successful HTTP response as a saved transaction', async () => {
    const ajax = jest.fn().mockResolvedValue({data: new DOMParser().parseFromString('<not-a-transaction/>', 'text/xml')});
    const feature = new Feature(new Point([0, 0])); feature.setId('shops.1');
    await expect(transactionWriter(ajax).call({getLayer: async () => {}, parent: {
      options: {featureType: ['menorca:shops']}, capabilities: {'xmlns:menorca': 'http://menorca'}
    }}, [], [{wrap: {feature}}], [])).rejects.toMatchObject({
      stage: 'response', outcome: 'unknown', reason: 'Unverified WFS transaction response'
    });
  });

  it('ignores GeoServer placeholder insert results when an update has no inserts', async () => {
    const response = parse(`<wfs:TransactionResponse xmlns:wfs="http://www.opengis.net/wfs"
      xmlns:ogc="http://www.opengis.net/ogc" version="1.1.0">
      <wfs:TransactionSummary><wfs:totalInserted>0</wfs:totalInserted>
      <wfs:totalUpdated>1</wfs:totalUpdated><wfs:totalDeleted>0</wfs:totalDeleted></wfs:TransactionSummary>
      <wfs:TransactionResults/><wfs:InsertResults><wfs:Feature>
      <ogc:FeatureId fid="none"/></wfs:Feature></wfs:InsertResults></wfs:TransactionResponse>`);
    const ajax = jest.fn().mockResolvedValue({ data: response });
    const feature = new Feature({ name: 'Prova' }); feature.setId('shops.537');
    await expect(transactionWriter(ajax).call({ getLayer: async () => {}, parent }, [], [{ wrap: { feature } }], []))
      .resolves.toMatchObject({ insertIds: [] });
    expect(ajax).toHaveBeenCalledTimes(1);
  });

  it('does not accept GeoServer placeholder as a persistent id in a mixed transaction', async () => {
    const response = parse(`<wfs:TransactionResponse xmlns:wfs="http://www.opengis.net/wfs"
      xmlns:ogc="http://www.opengis.net/ogc"><wfs:TransactionSummary>
      <wfs:totalInserted>1</wfs:totalInserted><wfs:totalUpdated>1</wfs:totalUpdated>
      <wfs:totalDeleted>0</wfs:totalDeleted></wfs:TransactionSummary>
      <wfs:InsertResults><wfs:Feature><ogc:FeatureId fid="none"/></wfs:Feature></wfs:InsertResults>
      </wfs:TransactionResponse>`);
    const ajax = jest.fn().mockResolvedValue({ data: response });
    const insert = new Feature(new Point([1, 2])); insert.setProperties(captured);
    const update = new Feature({ category: 'new' }); update.setId('shops.537');
    await expect(transactionWriter(ajax).call({ getLayer: async () => {}, parent },
      [{ wrap: { feature: insert } }], [{ wrap: { feature: update } }], []))
      .resolves.toMatchObject({ insertIds: [null] });
  });

  it('retains WFS 2.0 ResourceId values for accepted inserts without using draft ids', async () => {
    const ajax = jest.fn().mockResolvedValue({ data: new DOMParser().parseFromString(`
      <wfs:TransactionResponse xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0">
        <wfs:TransactionSummary><wfs:totalInserted>2</wfs:totalInserted></wfs:TransactionSummary>
        <wfs:InsertResults>
          <wfs:Feature><fes:ResourceId rid="shops.42"/></wfs:Feature>
          <wfs:Feature><fes:ResourceId rid="shops.41"/></wfs:Feature>
        </wfs:InsertResults>
      </wfs:TransactionResponse>`, 'text/xml') });
    const inserts = ['draft.a', 'draft.b'].map((id) => {
      const feature = new Feature(new Point([0, 0])); feature.setId(id);
      return { wrap: { feature } };
    });
    await expect(transactionWriter(ajax).call({ getLayer: async () => {}, parent }, inserts, [], []))
      .resolves.toMatchObject({ insertIds: ['shops.42', 'shops.41'] });
    expect(ajax).toHaveBeenCalledTimes(1);
  });

  it('settles a native serializer exception before POST rather than hanging', async () => {
    const ajax = jest.fn();
    const insert = new Feature(new Point([1, 2])); insert.setProperties(captured);
    const invalidUpdate = new Feature({ name: 'no fid' });
    await expect(transactionWriter(ajax).call({ getLayer: async () => {}, parent },
      [{ wrap: { feature: insert } }], [{ wrap: { feature: invalidUpdate } }], []))
      .rejects.toMatchObject({ stage: 'serialization', outcome: 'notSent' });
    expect(ajax).not.toHaveBeenCalled();
    expect(insert.get('menorca:name')).toBe('Botiga');
  }, 1000);

  it.each(['name', 'unknown:name'])('stops a mixed lot before transport for an unverified key %s', async (key) => {
    const ajax = jest.fn();
    const insert = new Feature(new Point([1, 2])); insert.set(key, 'no namespace evidence');
    const update = new Feature({ category: 'changed' }); update.setId('shops.1');
    await expect(transactionWriter(ajax).call({ getLayer: async () => {}, parent },
      [{ wrap: { feature: insert } }], [{ wrap: { feature: update } }], []))
      .rejects.toMatchObject({ stage: 'serialization', outcome: 'notSent' });
    expect(ajax).not.toHaveBeenCalled();
    expect(insert.get(key)).toBe('no namespace evidence');
  });

  it.each([
    ['confirmed', { data: parse('<ExceptionReport xmlns="http://www.opengis.net/ows/1.1"><Exception exceptionCode="InvalidParameterValue"/></ExceptionReport>') }, 'rejected'],
    ['unconfirmed', { data: parse('<ExceptionReport xmlns="http://www.opengis.net/ows/1.1"><Exception exceptionCode="NoApplicableCode"/></ExceptionReport>') }, 'unknown'],
    ['permission', { status: 403, problem: { status: 403, instance: '/proxy', properties: { origin: 'backend-config' } } }, 'permission'],
    ['bare 403', { status: 403 }, 'unknown'],
    ['network', new Error('Lost connection'), 'unknown']
  ])('classifies %s after one POST', async (mode, reply, outcome) => {
    const ajax = ['confirmed', 'unconfirmed'].includes(mode as string)
      ? jest.fn().mockResolvedValue(reply) : jest.fn().mockRejectedValue(reply);
    const update = new Feature({ category: 'new' }); update.setId('shops.1');
    await expect(transactionWriter(ajax).call({ getLayer: async () => {}, parent }, [], [{ wrap: { feature: update } }], []))
      .rejects.toMatchObject({ outcome });
    expect(ajax).toHaveBeenCalledTimes(1);
  });

  it('settles a POST with no response as unknown and aborts only the waiting request', async () => {
    jest.useFakeTimers();
    try {
      const ajax = jest.fn().mockImplementation(() => new Promise(() => undefined));
      const update = new Feature({ category: 'new' }); update.setId('shops.1');
      const settled = expect(transactionWriter(ajax).call({ getLayer: async () => {}, parent }, [], [{ wrap: { feature: update } }], []))
        .rejects.toMatchObject({ stage: 'post', outcome: 'unknown' });
      await jest.advanceTimersByTimeAsync(30000);
      await settled;
      expect(ajax).toHaveBeenCalledTimes(1);
      expect(ajax.mock.calls[0][0].signal.aborted).toBe(true);
    } finally { jest.useRealTimers(); }
  });
});
