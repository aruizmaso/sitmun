import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideTranslateService} from '@ngx-translate/core';
import {Subject, of, throwError} from 'rxjs';
import {CartographyService} from '@app/domain';
import {TaskPropertiesContract} from '@app/domain/task/models/task-properties';
import {WfsAttributeSchema} from '@app/domain/task/models/wfs-attribute-policy';
import {WfsAttributePermissionsComponent, WfsPermissionHeaderComponent} from './wfs-attribute-permissions.component';
import {usePermissionGridFixture} from './wfs-permissions-grid.fixture';

describe('WFS attribute permission configuration', () => {
  let fixture: ComponentFixture<WfsAttributePermissionsComponent>;
  let http: HttpTestingController;
  const schema: WfsAttributeSchema = {featureType: '{urn:a}roads', attributes: [
    {name: 'name', namespace: 'urn:a', type: 'string', geometry: false, generated: false},
    {name: 'id', namespace: 'urn:a', type: 'int', geometry: false, generated: false},
    {name: 'gid', namespace: 'urn:a', type: 'int', geometry: false, generated: true},
    {name: 'shape', namespace: 'urn:a', type: 'PointPropertyType', geometry: true, generated: false}
  ]};
  const saved = {version: 1, featureType: schema.featureType, editableAttributes: ['{urn:a}name']};

  beforeEach(() => {
    TestBed.configureTestingModule({imports: [WfsAttributePermissionsComponent],
      providers: [provideTranslateService(), provideHttpClient(), provideHttpClientTesting(),
        {provide: CartographyService, useValue: {
          resourceService: {getResourceUrl: (path: string) => '/api/' + path},
          fetchRawById: () => of({getRelationArrayEx: () => of([
            {name: 'name', value: 'Descriptive label', format: 'Text', type: 'INFO', order: 3}
          ])})
         }}]});
    usePermissionGridFixture();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WfsAttributePermissionsComponent);
    fixture.componentRef.setInput('cartographyId', 8);
    fixture.componentRef.setInput('policy', saved);
    fixture.detectChanges();
  });
  afterEach(() => { http.verify(); fixture.destroy(); });

  async function load(response = schema): Promise<void> {
    const loading = fixture.componentInstance.load();
    http.expectOne('/api/cartographies/8/wfs-attribute-schema').flush(response);
    await loading;
    fixture.detectChanges();
  }

  it('reports obsolete identities without granting permissions or erasing them when editing other fields', async () => {
    fixture.componentRef.setInput('policy', {...saved, editableAttributes: ['{urn:a}name', '{}removed', '{urn:other}name'], extra: 'preserve'});
    fixture.detectChanges();
    const changed = jest.fn(); fixture.componentInstance.policyChange.subscribe(changed);
    await load();
    const boxes: HTMLInputElement[] = Array.from(fixture.nativeElement.querySelectorAll('input[type=checkbox]'));
    // The grid fixture renders cells only; AG Grid renders the two header controls.
    expect(boxes).toHaveLength(9);
    const rows = fixture.componentInstance.rows;
    expect(rows.find((row) => row.name === 'name')).toMatchObject({editable: true});
    expect(rows.find((row) => row.name === 'id')).toMatchObject({editable: false});
    expect(rows.map((row) => row.identity)).toEqual(expect.not.arrayContaining(['{}removed', '{urn:other}name']));
    expect(changed).toHaveBeenCalledWith({...saved, extra: 'preserve', obsoleteAttributes: ['{}removed', '{urn:other}name']});
    expect(fixture.componentInstance.obsoleteAttributes).toEqual(['{}removed', '{urn:other}name']);
    expect(fixture.nativeElement.textContent).toContain('Descriptive label');
    fixture.componentInstance.toggle(rows.find((row) => row.name === 'id')!, true);
    expect(changed).toHaveBeenLastCalledWith({version: 2, featureType: schema.featureType,
      editableAttributes: ['{urn:a}name', '{urn:a}id'], hiddenAttributes: [], generatedAttributes: [],
      obsoleteAttributes: ['{}removed', '{urn:other}name'], extra: 'preserve'});
    await load();
    expect(fixture.componentInstance.rows.find((row) => row.name === 'id')?.editable).toBe(true);
    expect(fixture.componentInstance.obsoleteAttributes).toEqual(['{}removed', '{urn:other}name']);
  });

  it.each([
    {version: 2, featureType: schema.featureType, editableAttributes: ['{urn:a}name']},
    {version: 1, featureType: '{urn:b}roads', editableAttributes: ['{urn:a}name']},
    {version: 1, featureType: schema.featureType, editableAttributes: ['invalid']},
    {version: 1, featureType: schema.featureType, editableAttributes: [5]}
  ])('preserves incompatible policy and prevents editing: %p', async (policy) => {
    fixture.componentRef.setInput('policy', policy);
    fixture.detectChanges();
    const changed = jest.fn(); fixture.componentInstance.policyChange.subscribe(changed);
    await load();
    expect(fixture.componentInstance.policy).toEqual(policy);
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role=grid]')).toBeNull();
    fixture.componentInstance.toggle(fixture.componentInstance.rows[0], true);
    expect(changed).not.toHaveBeenCalled();
  });

  it('does not clean a policy on malformed schema response', async () => {
    const changed = jest.fn(); fixture.componentInstance.policyChange.subscribe(changed);
    const loading = fixture.componentInstance.load();
    http.expectOne('/api/cartographies/8/wfs-attribute-schema').flush({featureType: schema.featureType});
    await loading;
    expect(fixture.componentInstance.error).toBe(true);
    expect(fixture.componentInstance.policy).toEqual(saved);
    expect(changed).not.toHaveBeenCalled();
  });

  it.each([
    {featureType: schema.featureType, attributes: [{name: 'id', namespace: 'urn:a', geometry: false, generated: false}]},
    {featureType: schema.featureType, attributes: [{...schema.attributes[1], type: ''}]},
    {featureType: schema.featureType, attributes: [schema.attributes[1], {...schema.attributes[1], geometry: true}]}
  ])('rejects incomplete or ambiguous schema without changing saved permissions: %p', async (response) => {
    const original = {...saved, editableAttributes: ['{urn:a}name', '{urn:a}removed']};
    fixture.componentRef.setInput('policy', original);
    fixture.detectChanges();
    const changed = jest.fn(); fixture.componentInstance.policyChange.subscribe(changed);
    const loading = fixture.componentInstance.load();
    http.expectOne('/api/cartographies/8/wfs-attribute-schema').flush(response);
    await loading;
    fixture.detectChanges();
    expect(fixture.componentInstance.error).toBe(true);
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
    expect(fixture.componentInstance.schema).toBeUndefined();
    expect(fixture.componentInstance.policy).toEqual(original);
    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps a removed and later rediscovered attribute unchecked until explicitly selected', async () => {
    fixture.componentRef.setInput('policy', {...saved, editableAttributes: ['{urn:a}removed']});
    fixture.detectChanges();
    await load();
    expect(fixture.componentInstance.policy).toEqual({...saved, editableAttributes: [],
      obsoleteAttributes: ['{urn:a}removed']});
    await load({...schema, attributes: [...schema.attributes,
      {name: 'removed', namespace: 'urn:a', type: 'string', geometry: false, generated: false}]});
    const returned = fixture.componentInstance.rows.find((row) => row.identity === '{urn:a}removed')!;
    expect(returned.editable).toBe(false);
    fixture.componentInstance.toggle(returned, true);
    expect(fixture.componentInstance.policy).toEqual({...saved, version: 2, editableAttributes: ['{urn:a}removed'],
      hiddenAttributes: [], generatedAttributes: []});
  });

  it.each([7, ['{urn:a}id']])('ignores reserved v2 values in v1 and rebuilds them on migration: %p', async (reserved) => {
    fixture.componentRef.setInput('policy', {...saved, hiddenAttributes: reserved, generatedAttributes: reserved,
      obsoleteHiddenAttributes: reserved, extra: 'preserved'});
    fixture.detectChanges();
    await load();
    expect(fixture.componentInstance.error).toBe(false);
    expect(fixture.componentInstance.rows.find((row) => row.name === 'id')).toMatchObject({visible: true, generated: false});
    fixture.componentInstance.toggle(fixture.componentInstance.rows.find((row) => row.name === 'id')!, true);
    expect(fixture.componentInstance.policy).toMatchObject({version: 2, hiddenAttributes: [], generatedAttributes: [], extra: 'preserved'});
    expect(fixture.componentInstance.policy).not.toHaveProperty('obsoleteHiddenAttributes');
  });

  it('archives service-generated edit grants and does not restore them when the field becomes ordinary', async () => {
    await load({...schema, attributes: schema.attributes.map((item) => item.name === 'name' ? {...item, generated: true} : item)});
    expect(fixture.componentInstance.policy).toMatchObject({editableAttributes: [], obsoleteAttributes: ['{urn:a}name']});
    await load();
    const name = fixture.componentInstance.rows.find((row) => row.name === 'name')!;
    expect(name.editable).toBe(false);
    fixture.componentInstance.toggle(name, true);
    expect(fixture.componentInstance.policy).not.toHaveProperty('obsoleteAttributes');
    await load();
    expect(fixture.componentInstance.rows.find((row) => row.name === 'name')?.editable).toBe(true);
  });

  it('keeps obsolete warnings independently until each returning rule is reassigned', async () => {
    fixture.componentRef.setInput('policy', {version: 2, featureType: schema.featureType,
      editableAttributes: ['{urn:a}removed'], hiddenAttributes: ['{urn:a}removed'],
      generatedAttributes: ['{urn:a}removed']});
    fixture.detectChanges();
    await load();
    await load({...schema, attributes: [...schema.attributes,
      {name: 'removed', namespace: 'urn:a', type: 'string', geometry: false, generated: false}]});
    const row = fixture.componentInstance.rows.find((item) => item.name === 'removed')!;
    expect(row).toMatchObject({editable: false, visible: true, generated: false});
    fixture.componentInstance.setPermission(row, 'visible', false);
    expect(fixture.componentInstance.policy).not.toHaveProperty('obsoleteHiddenAttributes');
    expect(fixture.componentInstance.policy).toMatchObject({obsoleteAttributes: ['{urn:a}removed'],
      obsoleteGeneratedAttributes: ['{urn:a}removed']});
    fixture.componentInstance.setPermission(row, 'generated', true);
    expect(fixture.componentInstance.policy).not.toHaveProperty('obsoleteGeneratedAttributes');
    fixture.componentInstance.setPermission(row, 'visible', true);
    fixture.componentInstance.setPermission(row, 'editable', true);
    expect(fixture.componentInstance.policy).not.toHaveProperty('obsoleteAttributes');
    await load({...schema, attributes: [...schema.attributes,
      {name: 'removed', namespace: 'urn:a', type: 'string', geometry: false, generated: false}]});
    expect(fixture.componentInstance.rows.find((item) => item.name === 'removed')?.editable).toBe(true);
  });

  it('starts ordinary fields unchecked without a policy and never grants geometry or generated identifiers', async () => {
    fixture.componentRef.setInput('policy', undefined); fixture.detectChanges();
    await load();
    expect(fixture.componentInstance.rows.map((row) => [row.name, row.editable, row.visible, row.generated]))
      .toEqual([['name', false, true, false], ['id', false, true, false], ['gid', false, true, true]]);
  });

  it('enforces visibility and generation conflicts and preserves their saved policy', async () => {
    await load();
    const component = fixture.componentInstance;
    const name = component.rows.find((row) => row.name === 'name')!;
    const gid = component.rows.find((row) => row.name === 'gid')!;
    component.setPermission(name, 'visible', false);
    expect(name).toMatchObject({visible: false, editable: false});
    component.setPermission(name, 'editable', true);
    expect(name.editable).toBe(false);
    component.setPermission(name, 'visible', true);
    component.setPermission(name, 'generated', true);
    expect(name).toMatchObject({generated: true, editable: false});
    component.setPermission(name, 'editable', true);
    expect(name).toMatchObject({generated: false, editable: true});
    component.setPermission(gid, 'generated', false);
    component.setPermission(gid, 'editable', true);
    expect(gid).toMatchObject({generated: true, editable: false, serviceGenerated: true});
    expect(component.policy).toMatchObject({version: 2, hiddenAttributes: [], generatedAttributes: []});
  });

  it('applies bulk changes only to filtered eligible rows', async () => {
    await load();
    const component = fixture.componentInstance;
    const name = component.rows.find((row) => row.name === 'name')!;
    const id = component.rows.find((row) => row.name === 'id')!;
    component.grid = {gridApi: {forEachNodeAfterFilter: (visit: (node: unknown) => void) =>
      [name].forEach((data) => visit({data}))}} as any;
    component.toggleFiltered('visible', false);
    expect(name).toMatchObject({visible: false, editable: false});
    expect(id.visible).toBe(true);
    component.toggleFiltered('editable', true);
    expect(name.editable).toBe(false);
    component.toggleFiltered('visible', true);
    component.setPermission(name, 'generated', true);
    component.toggleFiltered('editable', true);
    expect(name).toMatchObject({visible: true, editable: true, generated: false});
    expect(id.editable).toBe(false);
  });

  it('does not emit for empty, ineligible or unchanged bulk actions', async () => {
    await load();
    const component = fixture.componentInstance;
    const changed = jest.fn();
    component.policyChange.subscribe(changed);
    let rows: typeof component.rows = [];
    component.grid = {gridApi: {forEachNodeAfterFilter: (visit: (node: unknown) => void) =>
      rows.forEach((data) => visit({data}))}} as any;
    component.toggleFiltered('visible', false);
    rows = [component.rows.find((row) => row.serviceGenerated)!];
    component.toggleFiltered('editable', true);
    component.toggleFiltered('visible', true);
    expect(changed).not.toHaveBeenCalled();
  });

  it('assigns bulk controls only to the corresponding grid headers', async () => {
    await load();
    const columns: any[] = fixture.componentInstance.columns;
    expect(columns[0].headerComponent).toBe(WfsPermissionHeaderComponent);
    expect(columns[1].headerComponent).toBe(WfsPermissionHeaderComponent);
    expect(columns[2].headerComponent).toBeUndefined();
    expect(fixture.nativeElement.querySelector('app-wfs-attribute-permissions > mat-checkbox')).toBeNull();
  });

  it('does not carry a previous task selection into another task on the same cartography', async () => {
    await load();
    fixture.componentRef.setInput('policy', {version: 1, featureType: schema.featureType, editableAttributes: []});
    fixture.detectChanges();
    expect(fixture.componentInstance.rows.every((row) => !row.editable)).toBe(true);
  });

  it('invalidates an in-flight response when the task changes on the same cartography', async () => {
    fixture.componentRef.setInput('taskContext', {id: 1}); fixture.detectChanges();
    const pendingLoad = fixture.componentInstance.load();
    const pending = http.expectOne('/api/cartographies/8/wfs-attribute-schema');
    fixture.componentRef.setInput('taskContext', {id: 2});
    fixture.componentRef.setInput('policy', {...saved, editableAttributes: []});
    fixture.detectChanges();
    pending.flush(schema);
    await pendingLoad;
    expect(fixture.componentInstance.schema).toBeUndefined();
    expect(fixture.componentInstance.loading).toBe(false);
  });

  it('keeps selections on a failed refresh and leaves new attributes unchecked', async () => {
    await load();
    await load({...schema, attributes: [...schema.attributes,
      {name: 'new', namespace: 'urn:a', type: 'string', geometry: false, generated: false}]});
    expect(fixture.componentInstance.rows.find((row) => row.name === 'new')?.editable).toBe(false);
    const failed = fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=status]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[role=grid]')).toBeNull();
    http.expectOne('/api/cartographies/8/wfs-attribute-schema').flush({}, {status: 422, statusText: 'Failed'});
    await failed; fixture.detectChanges();
    expect(fixture.componentInstance.rows.find((row) => row.name === 'name')?.editable).toBe(true);
    expect(fixture.componentInstance.policy).toEqual(saved);
  });

  it('uses the Material button and read-only metadata with a technical-name fallback', async () => {
    expect(fixture.nativeElement.querySelector('button[mat-raised-button][color=primary]')).not.toBeNull();
    fixture.componentRef.setInput('cartographyId', null); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
    fixture.componentRef.setInput('cartographyId', 8); fixture.detectChanges();
    await load();
    expect(fixture.componentInstance.columns.every((column) => column.editable === false)).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('input:not([type=checkbox]), select, textarea')).toHaveLength(0);
  });

  it('does not emit or erase saved configuration after discovery failure or an obsolete response', async () => {
    const original = {...saved, editableAttributes: ['{urn:a}name', '{urn:a}removed']};
    fixture.componentRef.setInput('policy', original); fixture.detectChanges();
    const changed = jest.fn(); fixture.componentInstance.policyChange.subscribe(changed);
    const failedLoad = fixture.componentInstance.load();
    http.expectOne('/api/cartographies/8/wfs-attribute-schema').flush({}, {status: 422, statusText: 'Unverifiable schema'});
    await failedLoad; fixture.detectChanges();
    expect(fixture.componentInstance.policy).toEqual(original);
    expect(changed).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
    const pendingLoad = fixture.componentInstance.load();
    const pending = http.expectOne('/api/cartographies/8/wfs-attribute-schema');
    fixture.componentRef.setInput('cartographyId', 9); fixture.detectChanges();
    pending.flush(schema); await pendingLoad;
    expect(fixture.componentInstance.schema).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['layer', 'parameters'])('allows editing while %s metadata is pending and retains it after enrichment', async (pending) => {
    const layers = new Subject<any>();
    const parameters = new Subject<any[]>();
    jest.spyOn(TestBed.inject(CartographyService), 'fetchRawById').mockReturnValue(layers);
    const changed = jest.fn();
    fixture.componentInstance.policyChange.subscribe(changed);
    const loading = fixture.componentInstance.load();
    http.expectOne('/api/cartographies/8/wfs-attribute-schema').flush(schema);
    await loading;
    if (pending === 'parameters') layers.next({getRelationArrayEx: () => parameters});
    fixture.detectChanges();
    expect(fixture.componentInstance.loading).toBe(false);
    expect(fixture.nativeElement.querySelector('[role=status]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role=grid]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Descriptive label');
    const id = fixture.componentInstance.rows.find((row) => row.name === 'id')!;
    fixture.componentInstance.toggle(id, true);
    const policy = fixture.componentInstance.policy;
    expect(changed).toHaveBeenCalledTimes(1);
    if (pending === 'layer') layers.next({getRelationArrayEx: () => parameters});
    parameters.next([{name: 'name', value: 'Descriptive label', type: 'INFO', order: 1}]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Descriptive label');
    expect(fixture.componentInstance.rows.find((row) => row.name === 'id')?.editable).toBe(true);
    expect(fixture.componentInstance.policy).toEqual(policy);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it.each(['layer', 'parameters'])('keeps technical names and policy on %s metadata error', async (stage) => {
    const error = throwError(() => new Error('Optional metadata unavailable'));
    jest.spyOn(TestBed.inject(CartographyService), 'fetchRawById').mockReturnValue(
      stage === 'layer' ? error : of({getRelationArrayEx: () => error}) as any);
    const changed = jest.fn();
    fixture.componentInstance.policyChange.subscribe(changed);
    await load();
    expect(fixture.componentInstance.error).toBe(false);
    expect(fixture.componentInstance.policy).toEqual(saved);
    expect(fixture.componentInstance.presentation(fixture.componentInstance.rows[0])).toBeUndefined();
    expect(fixture.nativeElement.querySelector('[role=grid]')).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['task', 'cartography', 'reload', 'destroy'])('ignores late metadata after %s', async (change) => {
    const first = new Subject<any[]>();
    const second = new Subject<any[]>();
    jest.spyOn(TestBed.inject(CartographyService), 'fetchRawById')
      .mockReturnValueOnce(of({getRelationArrayEx: () => first}) as any)
      .mockReturnValue(of({getRelationArrayEx: () => second}) as any);
    await load();
    const changed = jest.fn();
    fixture.componentInstance.policyChange.subscribe(changed);
    if (change === 'task') fixture.componentRef.setInput('taskContext', {id: 2});
    if (change === 'cartography') fixture.componentRef.setInput('cartographyId', 9);
    if (change === 'task' || change === 'cartography') fixture.detectChanges();
    if (change === 'reload') {
      await load();
      second.next([{name: 'name', value: 'Current label', type: 'INFO', order: 1}]);
    }
    if (change === 'destroy') fixture.destroy();
    first.next([{name: 'name', value: 'Old label', type: 'INFO', order: 1}]);
    expect(changed).not.toHaveBeenCalled();
    if (change === 'reload') {
      expect(fixture.componentInstance.presentation(fixture.componentInstance.rows[0])?.value).toBe('Current label');
    } else if (change !== 'destroy') {
      expect(fixture.componentInstance.schema).toBeUndefined();
    } else {
      expect(fixture.componentInstance.presentation(fixture.componentInstance.rows[0])).toBeUndefined();
    }
  });

  it('persists a versioned policy without altering legacy mobile fields or unknown properties', () => {
    const properties = {fields: [{name: 'id', editable: true}], other: {preserve: true}};
    const updated = TaskPropertiesContract.withWfsAttributePolicy(properties, saved);
    expect(updated['fields']).toBe(properties.fields);
    expect(updated['other']).toBe(properties.other);
    expect(TaskPropertiesContract.getWfsAttributePolicy(updated)).toEqual(saved);
    expect(properties).not.toHaveProperty('wfsAttributePolicy');
  });
});

describe('WFS permission grid header', () => {
  it('updates its checkbox on filtering and policy changes and removes grid listeners', () => {
    TestBed.configureTestingModule({imports: [WfsPermissionHeaderComponent], providers: [provideTranslateService()]});
    const fixture = TestBed.createComponent(WfsPermissionHeaderComponent);
    const listeners = new Map<string, () => void>();
    const api = {
      addEventListener: jest.fn((event: string, listener: () => void) => listeners.set(event, listener)),
      removeEventListener: jest.fn((event: string) => listeners.delete(event))
    };
    const updates = new Subject<boolean>();
    const column = {getSort: () => null, addEventListener: jest.fn(), removeEventListener: jest.fn()};
    let all = false;
    let some = true;
    const toggle = jest.fn();
    const eGridHeader = document.createElement('div');
    fixture.componentInstance.agInit({
      api, column, eGridHeader, kind: 'visible', displayName: 'Visible', all: () => all, some: () => some,
      eligible: () => true, toggle, updates
    } as any);
    fixture.detectChanges();
    const checkbox: HTMLInputElement = fixture.nativeElement.querySelector('input[type=checkbox]');
    expect(checkbox.indeterminate).toBe(true);
    expect(eGridHeader.getAttribute('aria-checked')).toBe('mixed');
    eGridHeader.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', bubbles: true}));
    expect(toggle).toHaveBeenCalledWith('visible', true);
    expect(fixture.nativeElement.textContent).toContain('Visible');
    checkbox.click();
    expect(toggle).toHaveBeenCalledWith('visible', true);
    all = true;
    some = false;
    listeners.get('filterChanged')!();
    fixture.detectChanges();
    expect(checkbox.checked).toBe(true);
    expect(checkbox.indeterminate).toBe(false);
    all = false;
    updates.next(true);
    fixture.detectChanges();
    expect(checkbox.checked).toBe(false);
    fixture.destroy();
    expect(listeners.size).toBe(0);
    expect(column.removeEventListener).toHaveBeenCalled();
    expect(updates.observed).toBe(false);
  });
});
