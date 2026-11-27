import type {AppCfg} from '../api/model/app-cfg';
import type {AttributeFormField} from './feature-attribute-draft';
import {effectiveWfsAttributeAccess, enforceWfsAttributeTransaction, isNewWfsFeature,
  projectWfsAttributeAccess, VerifiedWfsAttributeSchema, wfsAttributeDelta} from './wfs-attribute-policy';

const schema: VerifiedWfsAttributeSchema = {featureType: '{urn:a}roads', attributes: [
  {name: 'id', namespace: 'urn:a', type: '{http://www.w3.org/2001/XMLSchema}int', geometry: false, generated: false},
  {name: 'name', namespace: 'urn:a', type: '{http://www.w3.org/2001/XMLSchema}string', geometry: false, generated: false},
  {name: 'details', namespace: 'urn:a', type: 'complex', geometry: false, generated: false},
  {name: 'gid', namespace: 'urn:a', type: '{http://www.w3.org/2001/XMLSchema}int', geometry: false, generated: true},
  {name: 'shape', namespace: 'urn:a', type: '{http://www.opengis.net/gml/3.2}PointPropertyType', geometry: true, generated: false}
]};
const endpoint = 'http://localhost/middleware/proxy/1/2/WFS/5/8';
const layer = {id: 'native', type: 'WFS', url: endpoint, featureType: ['a:roads'], options: {profileLayerId: 'layer/8'}};
const task = (fields: string[]) => ({id: 'task/7', type: 'edition', typeId: 0, scope: 'feat-edit', layer: 'layer/8', url: endpoint,
  parameters: {typename: {value: 'a:roads'}}, wfsAttributeSchema: schema,
  wfsAttributePolicy: {version: 1, featureType: schema.featureType, editableAttributes: fields}});
const profile = (...tasks: any[]): AppCfg => ({application: {id: 1, territoryId: 2},
  layers: [{id: 'layer/8', service: 'service/5', layers: ['a:roads']}],
  services: [{id: 'service/5', type: 'WFS', url: endpoint}], tasks, trees: []} as unknown as AppCfg);

describe('WFS attribute authorization projection and wire policy', () => {
  it.each([7, ['{urn:a}id']])('ignores v2 reserved keys in v1: %p', (reserved) => {
    const original = task(['{urn:a}id']);
    const configured = {...original, wfsAttributePolicy: {...original.wfsAttributePolicy,
      hiddenAttributes: reserved, generatedAttributes: reserved}};
    const access = effectiveWfsAttributeAccess(profile(configured), layer);
    expect(access.editable.has('{urn:a}id')).toBe(true);
    expect(access.hidden?.has('{urn:a}id')).toBe(false);
    expect(access.generated?.has('{urn:a}id')).toBe(false);
  });

  it('does not accept malformed v2 lists', () => {
    const configured = {...task([]), wfsAttributePolicy: {version: 2, featureType: schema.featureType,
      editableAttributes: ['{urn:a}id'], hiddenAttributes: [], generatedAttributes: [7]}};
    expect(effectiveWfsAttributeAccess(profile(configured), layer).editable.size).toBe(0);
  });
  it('unions visibility but lets configurable generation override edit permissions and inserts', () => {
    const first = {...task([]), wfsAttributePolicy: {version: 2, featureType: schema.featureType,
      editableAttributes: [], hiddenAttributes: ['{urn:a}id'], generatedAttributes: ['{urn:a}name']}};
    const second = {...task([]), wfsAttributePolicy: {version: 2, featureType: schema.featureType,
      editableAttributes: ['{urn:a}id', '{urn:a}name'], hiddenAttributes: [], generatedAttributes: []}};
    const access = effectiveWfsAttributeAccess(profile(first, second), layer);
    expect(access.hidden?.size).toBe(0);
    expect(access.editable.has('{urn:a}id')).toBe(true);
    expect(access.editable.has('{urn:a}name')).toBe(false);
    const transaction = new DOMParser().parseFromString(`<w:Transaction xmlns:w="http://www.opengis.net/wfs" xmlns:a="urn:a">
      <w:Insert><a:roads><a:name>forged</a:name><a:id>7</a:id></a:roads></w:Insert></w:Transaction>`, 'text/xml').documentElement;
    enforceWfsAttributeTransaction(transaction, access, {a: 'urn:a'});
    expect(transaction.getElementsByTagNameNS('urn:a', 'name')).toHaveLength(0);
    expect(transaction.getElementsByTagNameNS('urn:a', 'id')).toHaveLength(1);
  });

  it('shows hidden ordinary fields on insert but keeps hidden generated fields out of both forms', () => {
    const configured = {...task([]), wfsAttributePolicy: {version: 2, featureType: schema.featureType,
      editableAttributes: [], hiddenAttributes: ['{urn:a}id', '{urn:a}gid'],
      generatedAttributes: []}};
    const access = effectiveWfsAttributeAccess(profile(configured), layer);
    const fields: AttributeFormField[] = schema.attributes.filter((field) => !field.geometry).map((attribute) => ({
      name: attribute.name, value: undefined, present: false, editable: true, reasons: [],
      schema: {...attribute, type: 'string', minOccurs: '0', maxOccurs: '1', nillable: true,
        defaultValue: null, fixedValue: null, facets: [], reasons: []}
    }));
    expect(projectWfsAttributeAccess(fields, access, false, 'protected').map((field) => field.name))
      .not.toContain('id');
    const inserted = projectWfsAttributeAccess(fields, access, true, 'protected');
    expect(inserted.map((field) => field.name)).toContain('id');
    expect(inserted.map((field) => field.name)).not.toContain('gid');
  });

  it('unions only authorized task destinations and known ordinary fields, with no implicit mobile migration', () => {
    const wrong = {...task(['{urn:a}details']), layer: 'layer/9'};
    const access = effectiveWfsAttributeAccess(profile(task(['{urn:a}id', '{urn:a}gid']), task(['{urn:a}name']), wrong), layer);
    expect([...access.editable].sort()).toEqual(['{urn:a}id', '{urn:a}name']);
    expect(effectiveWfsAttributeAccess(profile({...task([]), wfsAttributePolicy: undefined, fields: {id: {editable: true}}}), layer).editable.size).toBe(0);
  });

  it('keeps protected values read-only, allows normal id on inserts, and hides only explicitly generated fields', () => {
    const fields: AttributeFormField[] = schema.attributes.filter((field) => !field.geometry).map((attribute) => ({
      name: attribute.name, value: attribute.name === 'id' ? 123 : attribute.name, present: true, editable: true, reasons: [],
      schema: {...attribute, type: 'string', minOccurs: '0', maxOccurs: '1', nillable: true,
        defaultValue: null, fixedValue: null, facets: [], reasons: []}
    }));
    const access = effectiveWfsAttributeAccess(profile(task(['{urn:a}name'])), layer);
    const existing = projectWfsAttributeAccess(fields, access, false, 'protected', 'generated');
    expect(existing.find((field) => field.name === 'id')).toMatchObject({editable: false, value: 123});
    expect(existing.find((field) => field.name === 'name')?.editable).toBe(true);
    expect(existing.find((field) => field.name === 'gid')?.editable).toBe(false);
    expect(existing.find((field) => field.name === 'gid')?.reasons).toContain('generated');
    expect(projectWfsAttributeAccess(fields, access, true, 'protected').find((field) => field.name === 'gid')?.editable).toBe(false);
  });

  it('explains that generated attributes are read-only because they are marked as generated', () => {
    const fields: AttributeFormField[] = [{name: 'name', schema: {
      name: 'name', namespace: 'urn:a', type: 'string', minOccurs: '0', maxOccurs: '1',
      nillable: true, defaultValue: null, fixedValue: null, facets: [], reasons: []
    }, value: 'server value', present: true, editable: true, reasons: []}];
    const access = {...effectiveWfsAttributeAccess(profile(task([])), layer),
      generated: new Set(['{urn:a}name'])};
    expect(projectWfsAttributeAccess(fields, access, false, 'protected', 'generated')[0])
      .toMatchObject({editable: false, reasons: ['generated']});
    expect(projectWfsAttributeAccess(fields, {...access, generated: new Set()}, false, 'protected', 'generated')[0].reasons)
      .toContain('protected');
  });

  it('uses added draft membership until confirmation, not the presence of a native id', () => {
    const added = {id: 'local.1'};
    const control = {getLayerEditData: () => ({addedFeaturesLayer: {features: [added]}})};
    const restored = {id: 'local.1', sitmunInsertConfirmed: false};
    expect(isNewWfsFeature(control, restored)).toBe(true);
    restored.sitmunInsertConfirmed = true;
    expect(isNewWfsFeature(control, restored)).toBe(false);
    expect(isNewWfsFeature(control, {id: 'server.2'})).toBe(false);
  });

  it('does not resend protected structured, scalar or lexically equivalent data on geometry changes', () => {
    const access = {schema, editable: new Set<string>()};
    const before = {id: 7, name: 'original', details: {a: 1, nested: [true, {b: 2}]}};
    expect(wfsAttributeDelta(before, {id: '07', name: 'original', details: {nested: [true, {b: 2}], a: 1}}, access)).toEqual({});
    expect(wfsAttributeDelta(before, {...before, details: {a: 2}}, access)).toEqual({details: {a: 2}});
    const jsonDeclaredAsString = {...access, schema: {...schema, attributes: schema.attributes.map((field) =>
      field.name === 'details' ? {...field, type: '{http://www.w3.org/2001/XMLSchema}string'} : field)}};
    expect(wfsAttributeDelta(before, JSON.parse(JSON.stringify(before)), jsonDeclaredAsString)).toEqual({});
  });

  it('does not invent clears for the exact shops.529 auxiliary-copy shape', () => {
    const before = Object.freeze({'gml:boundedBy': [1, 2], 'menorca:gid': 529,
      'menorca:name': undefined, 'menorca:category': undefined, 'menorca:city': undefined,
      'menorca:municipality': undefined, 'menorca:scope': undefined});
    const after = Object.freeze({'gml:boundedBy': [3, 4], 'menorca:gid': 529});
    expect(wfsAttributeDelta(before, after, {editable: new Set()})).toEqual({});
    expect(Object.hasOwn(before, 'menorca:scope')).toBe(true);
    expect(Object.hasOwn(after, 'menorca:scope')).toBe(false);
    expect(wfsAttributeDelta(before, {...after, 'menorca:scope': null}, {editable: new Set()}))
      .toEqual({'menorca:scope': null});
  });

  it.each([
    [{}, {}, {}],
    [{}, {name: undefined}, {}],
    [{name: undefined}, {}, {}],
    [{name: undefined}, {name: undefined}, {}],
    [{name: 'known'}, {}, {}],
    [{name: 'known'}, {name: undefined}, {}],
    [{name: null}, {}, {}],
    [{name: null}, {name: undefined}, {}],
    [{}, {name: null}, {name: null}],
    [{name: undefined}, {name: null}, {name: null}],
    [{name: 'known'}, {name: null}, {name: null}],
    [{name: null}, {name: null}, {}],
    [{name: null}, {name: 'new'}, {name: 'new'}],
    [{name: 'known'}, {name: 'new'}, {name: 'new'}],
    [{name: 'known'}, {name: ''}, {name: ''}],
    [{}, {enabled: false, count: 0}, {enabled: false, count: 0}],
    [{enabled: false, count: 0}, {enabled: false, count: 0}, {}]
  ])('preserves explicit write intent without mutating inputs: %j -> %j', (before, after, expected) => {
    Object.freeze(before);
    Object.freeze(after);
    expect(wfsAttributeDelta(before, after, {schema, editable: new Set()})).toEqual(expected);
  });

  it('ignores inherited keys, geometry and bounds while preserving XSD and structural equality', () => {
    const before = Object.freeze({shape: [1, 2], 'gml:boundedBy': [1, 2], id: 7,
      details: {a: 1, b: [false, 0]}});
    const after = Object.assign(Object.create({name: 'inherited'}), {shape: [3, 4],
      'gml:boundedBy': [3, 4], id: '07', details: {b: [false, 0], a: 1}});
    expect(wfsAttributeDelta(before, Object.freeze(after), {schema, editable: new Set()})).toEqual({});
  });

  it.each(['http://www.opengis.net/wfs', 'http://www.opengis.net/wfs/2.0'])('rejects the whole wire batch for protected Update properties (%s)', (namespace) => {
    const reference = namespace.endsWith('2.0') ? 'ValueReference' : 'Name';
    const transaction = new DOMParser().parseFromString(`<w:Transaction xmlns:w="${namespace}" xmlns:a="urn:a">
      <w:Insert><a:roads><a:gid>99</a:gid><a:id>7</a:id></a:roads></w:Insert>
      <w:Update typeName="a:roads"><w:Property><w:${reference}>a:name</w:${reference}><w:Value>new</w:Value></w:Property></w:Update>
    </w:Transaction>`, 'text/xml').documentElement;
    const access = {schema, editable: new Set(['{urn:a}id'])};
    expect(() => enforceWfsAttributeTransaction(transaction, access, {a: 'urn:a'})).toThrow('attributeForbidden');
    expect(transaction.getElementsByTagNameNS('urn:a', 'gid')).toHaveLength(0);
    expect(transaction.getElementsByTagNameNS('urn:a', 'id')[0].textContent).toBe('7');
    access.editable.add('{urn:a}name');
    expect(() => enforceWfsAttributeTransaction(transaction, access, {a: 'urn:a'})).not.toThrow();
    const name = transaction.getElementsByTagNameNS(namespace, reference)[0];
    name.textContent = 'alias:name';
    enforceWfsAttributeTransaction(transaction, access, {a: 'urn:a', alias: 'urn:a'});
    expect(name.lookupNamespaceURI('alias')).toBe('urn:a');
  });

  it.each(['http://www.opengis.net/wfs', 'http://www.opengis.net/wfs/2.0'])(
    'projects and serializes empty-namespace permissions without accepting a qualified grant (%s)', (namespace) => {
      const unqualified: VerifiedWfsAttributeSchema = {...schema, attributes: [
        {name: 'name', namespace: '', type: '{http://www.w3.org/2001/XMLSchema}string', geometry: false, generated: false},
        {name: 'protected', namespace: '', type: '{http://www.w3.org/2001/XMLSchema}string', geometry: false, generated: false}
      ]};
      const permittedTask = {...task(['{}name', '{urn:a}protected']), wfsAttributeSchema: unqualified};
      const access = effectiveWfsAttributeAccess(profile(permittedTask), layer);
      expect([...access.editable]).toEqual(['{}name']);
      const fields: AttributeFormField[] = unqualified.attributes.map((attribute) => ({
        name: attribute.name, value: 'original', present: true, editable: true, reasons: [],
        schema: {...attribute, type: 'string', minOccurs: '0', maxOccurs: '1', nillable: true,
          defaultValue: null, fixedValue: null, facets: [], reasons: []}
      }));
      expect(projectWfsAttributeAccess(fields, access, false, 'protected').map((field) => field.editable))
        .toEqual([true, false]);
      const reference = namespace.endsWith('2.0') ? 'ValueReference' : 'Name';
      const xml = (field: string) => new DOMParser().parseFromString(`
        <w:Transaction xmlns:w="${namespace}" xmlns:a="urn:a">
          <w:Update typeName="a:roads"><w:Property><w:${reference}>${field}</w:${reference}>
            <w:Value>pending-value</w:Value></w:Property></w:Update>
        </w:Transaction>`, 'text/xml').documentElement;
      const permitted = xml('name');
      expect(() => enforceWfsAttributeTransaction(permitted, access, {})).not.toThrow();
      const pending = xml('protected');
      expect(() => enforceWfsAttributeTransaction(pending, access, {}))
        .toThrow(expect.objectContaining({message: 'attributeForbidden', attributes: ['{}protected']}));
      expect(pending.getElementsByTagNameNS(namespace, 'Value')[0].textContent).toBe('pending-value');
      expect(wfsAttributeDelta({name: 'original', protected: 'original'},
        {name: 'original', protected: 'original'}, access)).toEqual({});
      const revoked = effectiveWfsAttributeAccess(profile({...permittedTask,
        wfsAttributePolicy: {...permittedTask.wfsAttributePolicy, editableAttributes: ['{urn:a}name']}}), layer);
      expect(() => enforceWfsAttributeTransaction(permitted, revoked, {}))
        .toThrow(expect.objectContaining({attributes: ['{}name']}));
    });
});
