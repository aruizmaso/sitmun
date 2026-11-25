import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {By} from '@angular/platform-browser';
import {MAT_TABS_CONFIG, MatTabGroup} from '@angular/material/tabs';

import { TranslateLoader, TranslatePipe, provideTranslateService } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';

import { EntityFormAlertsComponent } from '@app/components/shared/entity-form-alerts/entity-form-alerts.component';
import { FormToolbarComponent } from '@app/components/shared/form-toolbar/form-toolbar.component';
import {RelationGridComponent} from '@app/components/shared/relation-grid/relation-grid.component';
import { ExternalConfigurationService } from '@app/core/config/external-configuration.service';
import { ExternalService, ResourceService } from '@app/core/hal';
import {ResourceHelper} from '@app/core/hal/resource/resource-helper';
import {
  CodeListService, RoleService, TaskAvailabilityService, TaskService,
  TerritoryService, TranslationService, TaskTypeService, TaskGroupService,
  ConnectionService, CartographyService
} from '@app/domain';
import { SitmunFrontendGuiModule } from '@app/frontend-gui/src/lib/public_api';
import { MaterialModule } from '@app/material-module';
import { LoggerService } from '@app/services/logger.service';
import { configureLoggerForTests, provideErrorHandlerForTests } from '@app/testing/test-helpers';

import { TaskEditFormComponent } from './task-edit-form.component';
import {WfsAttributePermissionsComponent} from './wfs-attribute-permissions.component';
import {usePermissionGridFixture} from './wfs-permissions-grid.fixture';

describe('TaskEditFormComponent', () => {
  let component: TaskEditFormComponent;
  let fixture: ComponentFixture<TaskEditFormComponent>;

  beforeAll(async () => {
    TestBed.configureTestingModule({
      teardown: { destroyAfterEach: 0 as any },
      declarations: [TaskEditFormComponent, FormToolbarComponent],
      imports: [
        WfsAttributePermissionsComponent,
        RelationGridComponent,
        FormsModule,
        ReactiveFormsModule,
        RouterModule.forRoot([], {}),
        SitmunFrontendGuiModule, EntityFormAlertsComponent,
        MaterialModule,
        MatIconTestingModule,
        NoopAnimationsModule,
        TranslatePipe
      ],
      providers: [
        provideTranslateService({
          loader: {
            provide: TranslateLoader,
            useFactory: () => ({
              getTranslation: () => of({})
            })
          }
        }),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideErrorHandlerForTests(),
        TaskService,
        TaskTypeService,
        TaskGroupService,
        ConnectionService,
        CartographyService,
        RoleService,
        TerritoryService,
        TaskAvailabilityService,
        CodeListService,
        TranslationService,
        ResourceService,
        ExternalService,
        {provide: MAT_TABS_CONFIG, useValue: {animationDuration: '0ms'}},
        {provide: ActivatedRoute, useValue: {params: EMPTY, snapshot: {params: {}, url: []}}},
        { provide: 'ExternalConfigurationService', useClass: ExternalConfigurationService }
      ]
    });
    usePermissionGridFixture();
    await TestBed.compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(TaskEditFormComponent);
    component = fixture.componentInstance;
    const loggerService = TestBed.inject(LoggerService);
    configureLoggerForTests(loggerService);
    component.entityToEdit = component.empty();
    component.postFetchData();
    fixture.detectChanges();
  });

  afterEach(() => fixture?.destroy());
  afterAll(() => TestBed.resetTestingModule());

  

  describe('Grid capability classification', () => {
    it('rolesTable should have picker, updater, and status capabilities', () => {
      const table = component['rolesTable'];
      expect(table.hasPickerAdd()).toBe(true);
      expect(table.hasRelationsUpdater()).toBe(true);
      expect(table.hasStatusColumn()).toBe(true);
      expect(table.hasTemplateDialogs()).toBe(false);
    });

    it('availabilitiesTable should have picker, updater, and status capabilities', () => {
      const table = component['availabilitiesTable'];
      expect(table.hasPickerAdd()).toBe(true);
      expect(table.hasRelationsUpdater()).toBe(true);
      expect(table.hasStatusColumn()).toBe(true);
      expect(table.hasTemplateDialogs()).toBe(false);
    });

    it('parametersTable should have template-dialog, updater, status, and duplicate capabilities', () => {
      const table = component['parametersTable'];
      expect(table.hasTemplateDialogs()).toBe(true);
      expect(table.hasRelationsUpdater()).toBe(true);
      expect(table.hasStatusColumn()).toBe(true);
      expect(table.supportsDuplicate()).toBe(true);
      expect(table.hasPickerAdd()).toBe(false);
    });

    it('fieldsTable should have template-dialog, updater, status, and duplicate capabilities', () => {
      const table = component['fieldsTable'];
      expect(table.hasTemplateDialogs()).toBe(true);
      expect(table.hasRelationsUpdater()).toBe(true);
      expect(table.hasStatusColumn()).toBe(true);
      expect(table.supportsDuplicate()).toBe(true);
      expect(table.hasPickerAdd()).toBe(false);
    });
  });

  describe('Attributes tab and the real parent save flow', () => {
    let http: HttpTestingController;
    const fields = [{name: 'mobile', editable: true, customMobileFlag: 'preserve'}];
    const unknown = {nested: ['preserve', {value: 3}]};
    const links = {
      self: {href: '/api/tasks/7'},
      connection: {href: '/api/tasks/7/connection'},
      cartography: {href: '/api/tasks/7/cartography'}
    };

    beforeEach(() => {
      http = TestBed.inject(HttpTestingController);
      ResourceHelper.setHttp(TestBed.inject(HttpClient));
      ResourceHelper.setRootUri('/api');
      ResourceHelper.setProxyUri(null);
      jest.spyOn(TestBed.inject(ExternalService), 'getRootUri').mockReturnValue('/api');
      jest.spyOn(TestBed.inject(ExternalService), 'getProxyUri').mockReturnValue(null);
      jest.spyOn(component, 'codeList').mockReturnValue([]);
      component.entityID = 7;
    });
    afterEach(() => http.verify());

    async function settle(): Promise<void> {
      // Do not wait for stability while a deliberately controlled HTTP request is pending.
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
    }

    async function openTask(properties: Record<string, unknown>): Promise<void> {
      const fetching = component.fetchOriginal();
      http.expectOne('/api/tasks/7?projection=view').flush({
        id: 7, name: 'Road permissions', groupId: 1, cartographyId: 8, connectionId: null,
        properties, _links: links
      });
      component.entityToEdit = await fetching;
      // A stale registered fields table must be removed by scope configuration,
      // even if the form instance previously displayed a DB task.
      component.dataTables.register(component['fieldsTable']);
      component.postFetchData();
      component.dataLoaded = true;
      expect(component.entityForm.get('scope')?.value).toBe(properties['scope']);
      expect(component.isCartographyEditionScope()).toBe(properties['scope'] === 'feat-edit');
      expect(component.isDBEditionScope()).toBe(properties['scope'] === 'db-edit');
      fixture.detectChanges();
      fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance.selectedIndex = 4;
      fixture.detectChanges();
      await fixture.whenRenderingDone();
      fixture.detectChanges();
    }

    async function loadSchema(namespace: string, includeReturned = false): Promise<void> {
      const button: HTMLButtonElement = fixture.nativeElement.querySelector('app-wfs-attribute-permissions button');
      button.click();
      http.expectOne('/api/cartographies/8/wfs-attribute-schema').flush({
        featureType: '{urn:a}roads',
        attributes: [
          {name: 'name', namespace, type: 'string', geometry: false, generated: false},
          ...(includeReturned ? [
            {name: 'removed', namespace: '', type: 'string', geometry: false, generated: false},
            {name: 'name', namespace: 'urn:other', type: 'string', geometry: false, generated: false}
          ] : [])
        ]
      });
      await settle();
      http.expectOne('/api/cartographies/8').flush({}, {status: 404, statusText: 'Optional presentation unavailable'});
      await settle();
    }

    it.each(['urn:a', ''])('loads, selects, saves and reopens %s identities without modifying mobile fields', async (namespace) => {
      const original = {scope: 'feat-edit', fields, unknown};
      await openTask(original);
      expect(fixture.nativeElement.querySelectorAll('[role="tab"]')).toHaveLength(5);
      expect(fixture.nativeElement.querySelectorAll('app-wfs-attribute-permissions')).toHaveLength(1);
      expect(fixture.nativeElement.querySelector('app-relation-grid')).toBeNull();
      await loadSchema(namespace);
      const checkbox: HTMLInputElement = fixture.nativeElement.querySelector('app-wfs-permission-checkbox input');
      expect(checkbox.checked).toBe(false);
      checkbox.click();
      fixture.detectChanges();
      expect(component.canSaveEntity).toBe(true);
      const expected = {version: 1, featureType: '{urn:a}roads', editableAttributes: [`{${namespace}}name`]};

      const hiddenGridSave = jest.fn();
      const subscription = component['fieldsTable'].saveCommandEvent$.subscribe(hiddenGridSave);
      const saving = component.onSaveButtonClicked();
      const update = http.expectOne({method: 'PUT', url: '/api/tasks/7'});
      expect(update.request.body.properties).toEqual({...original, wfsAttributePolicy: expected});
      const persisted = {id: 7, name: 'Road permissions', groupId: 1, cartographyId: 8,
        connectionId: null, properties: update.request.body.properties, _links: links};
      update.flush(persisted);
      await settle();
      http.expectOne('/api/tasks/7?projection=view').flush(persisted);
      await settle();
      http.expectOne({method: 'DELETE', url: '/api/tasks/7/connection'}).flush(null);
      await settle();
      http.expectOne({method: 'PUT', url: '/api/tasks/7/cartography'}).flush(null);
      await settle();
      http.expectOne('/api/tasks/7?projection=view').flush(persisted);
      await saving;
      expect(hiddenGridSave).not.toHaveBeenCalled();
      subscription.unsubscribe();
      expect(component.entityForm.pristine).toBe(true);

      await openTask(persisted.properties);
      await loadSchema(namespace);
      expect(fixture.nativeElement.querySelector('app-wfs-permission-checkbox input').checked).toBe(true);
      expect(component.entityToEdit.properties['fields']).toEqual(fields);
      expect(component.entityToEdit.properties['unknown']).toEqual(unknown);
      http.expectNone((request) => request.method !== 'GET'); // Reopening never edits layer metadata.
    });

    it.each([false, true])('archives absent identities on save and reopens safely (change another permission: %s)', async (changePermission) => {
      const original = {scope: 'feat-edit', fields, unknown, wfsAttributePolicy: {
        version: 1, featureType: '{urn:a}roads', editableAttributes: ['{}removed', '{urn:other}name']
      }};
      await openTask(original);
      await loadSchema('urn:a');
      let permissions = fixture.debugElement.query(By.directive(WfsAttributePermissionsComponent)).componentInstance as WfsAttributePermissionsComponent;
      expect(permissions.rows.map((row) => row.identity)).toEqual(['{urn:a}name']);
      expect(component.canSaveEntity).toBe(true);
      expect(component.entityForm.dirty).toBe(true);
      const checkbox: HTMLInputElement = fixture.nativeElement.querySelector('app-wfs-permission-checkbox input');
      expect(checkbox.checked).toBe(false);
      if (changePermission) checkbox.click();
      fixture.detectChanges();

      const saving = component.onSaveButtonClicked();
      const update = http.expectOne({method: 'PUT', url: '/api/tasks/7'});
      expect(update.request.body.properties.fields).toEqual(fields);
      expect(update.request.body.properties.unknown).toEqual(unknown);
      expect(update.request.body.properties.wfsAttributePolicy).toEqual({
        version: 1, featureType: '{urn:a}roads', editableAttributes: changePermission ? ['{urn:a}name'] : [],
        obsoleteAttributes: ['{}removed', '{urn:other}name']
      });
      const persisted = {id: 7, name: 'Road permissions', groupId: 1, cartographyId: 8,
        connectionId: null, properties: update.request.body.properties, _links: links};
      update.flush(persisted);
      await settle();
      http.expectOne('/api/tasks/7?projection=view').flush(persisted);
      await settle();
      http.expectOne({method: 'DELETE', url: '/api/tasks/7/connection'}).flush(null);
      await settle();
      http.expectOne({method: 'PUT', url: '/api/tasks/7/cartography'}).flush(null);
      await settle();
      http.expectOne('/api/tasks/7?projection=view').flush(persisted);
      await saving;

      await openTask(persisted.properties);
      await loadSchema('urn:a', true);
      permissions = fixture.debugElement.query(By.directive(WfsAttributePermissionsComponent)).componentInstance;
      expect(permissions.rows.find((row) => row.identity === '{urn:a}name')?.editable).toBe(changePermission);
      expect(permissions.rows.find((row) => row.identity === '{}removed')?.editable).toBe(false);
      expect(permissions.rows.find((row) => row.identity === '{urn:other}name')?.editable).toBe(false);
    });

    it.each(['layer', 'parameters'])('saves the selection while %s metadata remains pending', async (stage) => {
      const original = {scope: 'feat-edit', fields, unknown};
      await openTask(original);
      fixture.nativeElement.querySelector('app-wfs-attribute-permissions button').click();
      http.expectOne('/api/cartographies/8/wfs-attribute-schema').flush({
        featureType: '{urn:a}roads',
        attributes: [{name: 'name', namespace: 'urn:a', type: 'string', geometry: false, generated: false}]
      });
      await settle();
      const layer = http.expectOne('/api/cartographies/8');
      const layerResponse = {_links: {parameters: {href: '/api/cartographies/8/parameters'}}};
      if (stage === 'parameters') layer.flush(layerResponse);
      const parameters = stage === 'parameters' ? http.expectOne('/api/cartographies/8/parameters') : null;
      expect(fixture.nativeElement.querySelector('app-wfs-attribute-permissions [role=status]')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-wfs-attribute-permissions [role=grid]')).not.toBeNull();
      const checkbox: HTMLInputElement = fixture.nativeElement.querySelector('app-wfs-permission-checkbox input');
      checkbox.click();
      fixture.detectChanges();
      expect(component.canSaveEntity).toBe(true);
      const expected = {version: 1, featureType: '{urn:a}roads', editableAttributes: ['{urn:a}name']};
      const saving = component.onSaveButtonClicked();
      const update = http.expectOne({method: 'PUT', url: '/api/tasks/7'});
      expect(update.request.body.properties).toEqual({...original, wfsAttributePolicy: expected});
      if (stage === 'layer') layer.flush(layerResponse);
      const metadata = parameters ?? http.expectOne('/api/cartographies/8/parameters');
      metadata.flush({_embedded: {parameters: [{name: 'name', value: 'Road name', type: 'INFO', order: '1'}]}});
      await settle();
      expect(component.entityForm.get('wfsAttributePolicy')?.value).toEqual(expected);
      expect(fixture.nativeElement.querySelector('app-wfs-permission-checkbox input').checked).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('Road name');
      const persisted = {id: 7, name: 'Road permissions', groupId: 1, cartographyId: 8,
        connectionId: null, properties: update.request.body.properties, _links: links};
      update.flush(persisted);
      await settle();
      http.expectOne('/api/tasks/7?projection=view').flush(persisted);
      await settle();
      http.expectOne({method: 'DELETE', url: '/api/tasks/7/connection'}).flush(null);
      await settle();
      http.expectOne({method: 'PUT', url: '/api/tasks/7/cartography'}).flush(null);
      await settle();
      http.expectOne('/api/tasks/7?projection=view').flush(persisted);
      await saving;
      expect(component.entityForm.get('wfsAttributePolicy')?.value).toEqual(expected);
    });

    it('retains the original DB field grid and its add/edit capabilities', async () => {
      await openTask({scope: 'db-edit', fields, unknown});
      expect(fixture.nativeElement.querySelector('app-wfs-attribute-permissions')).toBeNull();
      const grid = fixture.debugElement.query(By.directive(RelationGridComponent));
      expect(grid.componentInstance.table).toBe(component['fieldsTable']);
      expect(grid.componentInstance.table.hasTemplateDialogs()).toBe(true);
      expect(grid.componentInstance.table.hasRelationsUpdater()).toBe(true);
      http.expectNone('/api/cartographies/8/wfs-attribute-schema');
    });
  });
});
