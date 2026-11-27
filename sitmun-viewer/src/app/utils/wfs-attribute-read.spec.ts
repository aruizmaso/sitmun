import { AttributeFormField } from './feature-attribute-draft';
import { attributeFormFields } from './wfs-attribute-fields';
import { mergeVerifiedGeoJsonProperties, verifiedGeoJsonFeature } from './wfs-attribute-read';
import { WfsAttributeSchema } from './wfs-attribute-schema';

const schema: WfsAttributeSchema = {
  featureType: '{http://menorca}shops',
  namespaces: {menorca: 'http://menorca', other: 'urn:other'},
  issues: [],
  fields: [
    {name: 'employees', namespace: 'http://menorca', type: 'int', minOccurs: '0', maxOccurs: '1',
      nillable: true, defaultValue: null, fixedValue: null, facets: [], reasons: []},
    {name: 'active', namespace: 'http://menorca', type: 'boolean', minOccurs: '0', maxOccurs: '1',
      nillable: true, defaultValue: null, fixedValue: null, facets: [], reasons: []},
    {name: 'code', namespace: 'http://menorca', type: 'string', minOccurs: '0', maxOccurs: '1',
      nillable: true, defaultValue: null, fixedValue: null, facets: [], reasons: []},
    {name: 'count', namespace: 'http://menorca', type: 'int', minOccurs: '0', maxOccurs: '1',
      nillable: true, defaultValue: null, fixedValue: null, facets: [], reasons: []},
    {name: 'name', namespace: 'http://menorca', type: 'string', minOccurs: '0', maxOccurs: '1',
      nillable: true, defaultValue: null, fixedValue: null, facets: [], reasons: []},
    {name: 'code', namespace: 'urn:other', type: 'string', minOccurs: '0', maxOccurs: '1',
      nillable: true, defaultValue: null, fixedValue: null, facets: [], reasons: []}
  ]
};

const fields: AttributeFormField[] = schema.fields.map((field) => ({
  name: field.namespace === 'urn:other' ? 'other:code' : `menorca:${field.name}`,
  schema: field, value: undefined, present: false, editable: true, verified: true, reasons: []
}));

describe('explicit WFS JSON attribute reads', () => {
  it('accepts only the requested single feature identity and a GeoJSON FeatureCollection', () => {
    const response = {type: 'FeatureCollection', features: [
      {type: 'Feature', id: 'shops.534', properties: {employees: null}}
    ]};
    expect(verifiedGeoJsonFeature(response, 'shops.534').properties).toEqual({employees: null});
    expect(() => verifiedGeoJsonFeature({...response, features: [
      {type: 'Feature', id: 'shops.535', properties: {employees: null}}
    ]}, 'shops.534')).toThrow('invalidFeatureIdentity');
    expect(() => verifiedGeoJsonFeature({...response, features: [
      ...response.features, ...response.features
    ]}, 'shops.534')).toThrow('invalidFeatureCollection');
    expect(() => verifiedGeoJsonFeature({type: 'Feature', id: 'shops.534', properties: {}}, 'shops.534'))
      .toThrow('invalidFeatureCollection');
    expect(() => verifiedGeoJsonFeature({...response, name: 'menorca:other'}, 'shops.534', 'menorca:shops'))
      .toThrow('invalidFeatureType');
  });

  it('merges only explicit local properties with unique schema QNames and preserves unrelated data', () => {
    const result = mergeVerifiedGeoJsonProperties(
      {'menorca:active': true, untouched: 'keep'},
      schema,
      fields,
      {employees: null, active: false, code: 'ambiguous'}
    );
    expect(result.data).toEqual({
      'menorca:employees': null, 'menorca:active': true, untouched: 'keep'
    });
    expect(result.unknownFields).toEqual(new Set(['{http://menorca}code', '{urn:other}code']));
    expect(attributeFormFields(schema, result.data, undefined, false, (key) => key)
      .find((field) => field.schema?.name === 'employees')).toMatchObject({present: true, value: null});
  });

  it('keeps absent JSON properties absent and preserves empty, zero, false and null distinctly', () => {
    const controlSchema = {...schema, fields: schema.fields.slice(0, 5)};
    const controlFields = fields.slice(0, 5);
    const result = mergeVerifiedGeoJsonProperties({}, controlSchema, controlFields,
      {employees: null, active: false, code: '', count: 0, name: 'shop'});
    expect(result.data).toEqual({
      'menorca:employees': null, 'menorca:active': false, 'menorca:code': '',
      'menorca:count': 0, 'menorca:name': 'shop'
    });
    expect(Object.hasOwn(result.data, 'menorca:missing')).toBe(false);
    expect(result.unknownFields).toEqual(new Set());
    const absent = mergeVerifiedGeoJsonProperties({}, controlSchema, controlFields, {});
    expect(absent.data).toEqual({});
    expect(absent.unknownFields).toEqual(new Set());
  });
});
