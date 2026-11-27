import {HttpClient} from '@angular/common/http';
import {ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {ICellRendererAngularComp} from '@ag-grid-community/angular';
import {ICellRendererParams, IHeaderParams} from '@ag-grid-community/core';
import {IHeaderAngularComp} from '@ag-grid-community/angular';
import {TranslatePipe, TranslateService} from '@ngx-translate/core';
import {EMPTY, Subject, Subscription, catchError, defer, firstValueFrom, of, switchMap} from 'rxjs';
import {CartographyService} from '@app/domain';
import {CartographyParameter} from '@app/domain/cartography/models/cartography-parameter.model';
import {WfsAttributePolicy, WfsAttributeSchema, WfsPermissionRow, isCompatibleWfsPolicy, isWfsIdentity, wfsPermissionRows, wfsPolicyFromRows} from '@app/domain/task/models/wfs-attribute-policy';
import {DataGridComponent} from '@app/frontend-gui/src/lib/data-grid/data-grid.component';

type PermissionCellParams = ICellRendererParams<WfsPermissionRow> & {
  kind: 'editable' | 'visible' | 'generated';
  toggle: (row: WfsPermissionRow, kind: 'editable' | 'visible' | 'generated', checked: boolean) => void;
};

@Component({
  selector: 'app-wfs-permission-checkbox',
  standalone: true,
  imports: [MatCheckboxModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <mat-checkbox [checked]="params.data?.[params.kind] === true"
      [disabled]="!params.data || (params.kind === 'editable' && (!params.data.visible || params.data.serviceGenerated)) || (params.kind === 'generated' && params.data.serviceGenerated)"
      [aria-label]="('wfsAttributePolicy.' + params.kind | translate) + ' ' + (params.data?.name || '') + ' ' + (params.data?.namespace || '')"
      (change)="params.data && params.toggle(params.data, params.kind, $event.checked)" />
    @if (params.kind === 'generated' && params.data?.serviceGenerated) {
      <span>{{ 'wfsAttributePolicy.serviceGenerated' | translate }}</span>
    }
  `
})
export class WfsPermissionCheckboxComponent implements ICellRendererAngularComp {
  @Input() params!: PermissionCellParams;
  agInit(params: PermissionCellParams): void { this.params = params; }
  refresh(params: PermissionCellParams): boolean { this.params = params; return true; }
}

type PermissionHeaderParams = IHeaderParams & {
  kind: 'visible' | 'editable';
  all: (kind: 'visible' | 'editable') => boolean;
  some: (kind: 'visible' | 'editable') => boolean;
  eligible: (kind: 'visible' | 'editable') => boolean;
  toggle: (kind: 'visible' | 'editable', checked: boolean) => void;
  updates: Subject<boolean>;
};

@Component({
  selector: 'app-wfs-permission-header',
  standalone: true,
  imports: [MatCheckboxModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <mat-checkbox [checked]="checked" [indeterminate]="indeterminate" [disabled]="disabled"
      [aria-label]="('wfsAttributePolicy.' + (params.kind === 'visible' ? 'allVisible' : 'allEditable')) | translate"
      (click)="$event.stopPropagation()" (change)="params.toggle(params.kind, $event.checked)" />
    <span (click)="sort($event)">{{ params.displayName }}{{ sortIndicator }}</span>
  `
})
export class WfsPermissionHeaderComponent implements IHeaderAngularComp, OnDestroy {
  params!: PermissionHeaderParams;
  checked = false;
  indeterminate = false;
  disabled = true;
  sortIndicator = '';
  private readonly changeDetector = inject(ChangeDetectorRef);
  private subscription?: Subscription;
  private readonly update = () => {
    this.checked = this.params.all(this.params.kind);
    this.indeterminate = this.params.some(this.params.kind);
    this.disabled = !this.params.eligible(this.params.kind);
    this.params.eGridHeader.setAttribute('aria-checked', this.indeterminate ? 'mixed' : String(this.checked));
    this.params.eGridHeader.setAttribute('aria-disabled', String(this.disabled));
    this.changeDetector.markForCheck();
  };
  private readonly onHeaderKeydown = (event: KeyboardEvent) => {
    if (event.key !== ' ' || event.target !== this.params.eGridHeader) return;
    event.preventDefault();
    event.stopPropagation();
    if (!this.disabled) this.params.toggle(this.params.kind, !this.checked);
  };
  private readonly updateSort = () => {
    const sort = this.params.column.getSort();
    this.sortIndicator = sort === 'asc' ? ' ↑' : sort === 'desc' ? ' ↓' : '';
    this.changeDetector.markForCheck();
  };

  agInit(params: PermissionHeaderParams): void {
    this.params = params;
    params.eGridHeader.addEventListener('keydown', this.onHeaderKeydown, true);
    params.api.addEventListener('filterChanged', this.update);
    params.api.addEventListener('modelUpdated', this.update);
    params.column.addEventListener('sortChanged', this.updateSort);
    this.subscription = params.updates.subscribe(this.update);
    this.update();
    this.updateSort();
  }

  refresh(params: PermissionHeaderParams): boolean {
    this.params = params;
    this.update();
    this.updateSort();
    return true;
  }

  sort(event: MouseEvent): void {
    if (this.params.enableSorting) this.params.progressSort(event.shiftKey);
  }

  ngOnDestroy(): void {
    this.params.api.removeEventListener('filterChanged', this.update);
    this.params.eGridHeader.removeEventListener('keydown', this.onHeaderKeydown, true);
    this.params.eGridHeader.removeAttribute('aria-checked');
    this.params.eGridHeader.removeAttribute('aria-disabled');
    this.params.api.removeEventListener('modelUpdated', this.update);
    this.params.column.removeEventListener('sortChanged', this.updateSort);
    this.subscription?.unsubscribe();
  }
}

@Component({
  selector: 'app-wfs-attribute-permissions',
  standalone: true,
  imports: [TranslatePipe, MatButtonModule, MatCheckboxModule, DataGridComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <p>{{ 'wfsAttributePolicy.help' | translate }}</p>
    <p>{{ 'wfsAttributePolicy.presentationWarning' | translate }}</p>
    <p>{{ 'wfsAttributePolicy.mobileWarning' | translate }}</p>
    <button mat-raised-button color="primary" class="sitmun-mat-button-margin" type="button"
      [disabled]="!cartographyId || loading" [attr.aria-busy]="loading" (click)="load()">{{ 'wfsAttributePolicy.load' | translate }}</button>
    @if (loading) { <p role="status">{{ 'common.loading' | translate }}</p> }
    @if (error) { <p role="alert">{{ 'wfsAttributePolicy.loadError' | translate }}</p> }
    @if (incompatiblePolicy) { <p role="alert">{{ 'wfsAttributePolicy.incompatible' | translate }}</p> }
    @if (schema && !loading && !incompatiblePolicy) {
      <p><code>{{ schema.featureType }}</code></p>
      @if (obsoleteAttributes.length) {
        <p>{{ 'wfsAttributePolicy.obsolete' | translate }}</p>
        <ul>
          @for (identity of obsoleteAttributes; track identity) {
            <li><code>{{ identity }}</code></li>
          }
        </ul>
      }
      <app-data-grid [columnDefs]="columns" [getAll]="getRows" [eventRefreshSubscription]="refresh"
        [globalSearch]="true" [actionButton]="false" [hideDuplicateButton]="true"
        [hideSearchReplaceButton]="true" [hideReplaceButton]="true" changeTracking="disabled" />
    }
  `
})
export class WfsAttributePermissionsComponent implements OnChanges, OnDestroy {
  @ViewChild(DataGridComponent) grid?: DataGridComponent;
  @Input() cartographyId: number | null = null;
  @Input() taskContext: unknown;
  @Input() formats: readonly {value: string; description: string}[] = [];
  @Input() policy: unknown;
  @Output() readonly policyChange = new EventEmitter<WfsAttributePolicy>();
  private readonly http = inject(HttpClient);
  private readonly cartographies = inject(CartographyService);
  private readonly translate = inject(TranslateService);
  private revision = 0;
  private metadataSubscription?: Subscription;
  private parameters: CartographyParameter[] = [];
  schema?: WfsAttributeSchema;
  rows: WfsPermissionRow[] = [];
  loading = false;
  error = false;
  incompatiblePolicy = false;
  readonly refresh = new Subject<boolean>();
  readonly getRows = () => of(this.rows);
  columns = this.createColumns();

  get obsoleteAttributes(): string[] {
    if (!this.schema || !isCompatibleWfsPolicy(this.policy, this.schema)) return [];
    return [...new Set([...(this.policy.obsoleteAttributes ?? []), ...(this.policy.version === 2 ? this.policy.obsoleteHiddenAttributes ?? [] : []),
      ...(this.policy.version === 2 ? this.policy.obsoleteGeneratedAttributes ?? [] : [])])];
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['cartographyId'] && !changes['taskContext']) {
      if (changes['policy'] && this.schema) {
        this.incompatiblePolicy = this.policy != null && !isCompatibleWfsPolicy(this.policy, this.schema);
        this.rows = wfsPermissionRows(this.policy, this.schema);
        this.sortRows();
        this.refresh.next(true);
      }
      if (changes['formats']) this.columns = this.createColumns();
      return;
    }
    this.revision++;
    this.metadataSubscription?.unsubscribe();
    this.schema = undefined;
    this.rows = [];
    this.parameters = [];
    this.loading = false;
    this.error = false;
    this.incompatiblePolicy = false;
  }

  ngOnDestroy(): void {
    this.revision++;
    this.metadataSubscription?.unsubscribe();
    this.refresh.complete();
  }

  async load(): Promise<void> {
    if (!this.cartographyId || this.loading) return;
    const revision = ++this.revision;
    const id = this.cartographyId;
    this.metadataSubscription?.unsubscribe();
    this.loading = true;
    this.error = false;
    try {
      const schema = await firstValueFrom(this.http.get<WfsAttributeSchema>(
        this.cartographies.resourceService.getResourceUrl(`cartographies/${id}/wfs-attribute-schema`)));
      if (this.revision !== revision || this.cartographyId !== id) return;
      if (!schema || !isWfsIdentity(schema.featureType) || !Array.isArray(schema.attributes)
        || schema.attributes.length > 4096
        || schema.attributes.some((field) => !field || typeof field.name !== 'string'
          || typeof field.namespace !== 'string' || typeof field.geometry !== 'boolean'
          || typeof field.generated !== 'boolean' || typeof field.type !== 'string' || !field.type.trim()
          || !isWfsIdentity(`{${field.namespace}}${field.name}`))
        || new Set(schema.attributes.map((field) => `{${field.namespace}}${field.name}`)).size !== schema.attributes.length) {
        throw new Error('Invalid WFS schema');
      }
      this.schema = schema;
      this.incompatiblePolicy = this.policy != null && !isCompatibleWfsPolicy(this.policy, schema);
      this.rows = wfsPermissionRows(this.policy, schema);
      if (isCompatibleWfsPolicy(this.policy, schema)) {
        const current = new Set(this.rows.map((row) => row.identity));
        const editable = new Set(this.rows.filter((row) => !row.serviceGenerated).map((row) => row.identity));
        const updated = {...this.policy};
        let changed = false;
        for (const [active, obsolete] of [['editableAttributes', 'obsoleteAttributes'],
          ['hiddenAttributes', 'obsoleteHiddenAttributes'], ['generatedAttributes', 'obsoleteGeneratedAttributes']] as const) {
          if (updated.version === 1 && active !== 'editableAttributes') continue;
          const values = updated[active] ?? [];
          const eligible = active === 'editableAttributes' ? editable : current;
          const missing = values.filter((identity) => !eligible.has(identity));
          if (!missing.length) continue;
          updated[active] = values.filter((identity) => eligible.has(identity));
          updated[obsolete] = [...new Set([...(updated[obsolete] ?? []), ...missing])];
          changed = true;
        }
        if (changed) {
          this.policy = updated;
          this.policyChange.emit(updated);
        }
      }
      this.parameters = [];
      this.sortRows();
      this.loading = false;
      this.refresh.next(true);
      // Metadata only enriches existing rows; it never determines permissions.
      this.metadataSubscription = defer(() => this.cartographies.fetchRawById(id)).pipe(
        switchMap((layer) => layer.getRelationArrayEx(CartographyParameter, 'parameters')),
        catchError(() => EMPTY)
      ).subscribe((parameters) => {
        if (this.revision !== revision || this.cartographyId !== id) return;
        this.parameters = parameters.filter((parameter) => parameter.type === 'INFO');
        this.sortRows();
        this.refresh.next(true);
      });
    } catch {
      if (this.revision === revision) this.error = true; // Never emit or erase saved policy on failure.
    } finally { if (this.revision === revision) this.loading = false; }
  }

  presentation(row: WfsPermissionRow): CartographyParameter | undefined {
    const matches = this.parameters.filter((parameter) => parameter.name === row.name);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private sortRows(): void {
    this.rows.sort((a, b) => Number(this.presentation(a)?.order ?? Number.MAX_SAFE_INTEGER) - Number(this.presentation(b)?.order ?? Number.MAX_SAFE_INTEGER));
  }

  private createColumns() {
    const readOnly = (header: string, field: string) => ({
      headerName: this.translate.instant(header), field, editable: false, cellClass: 'read-only-cell'
    });
    return [
      ...(['editable', 'visible', 'generated'] as const).map((kind) => ({
        ...readOnly(`wfsAttributePolicy.${kind}`, kind), cellClass: 'sitmun-centered-cell',
        cellRenderer: WfsPermissionCheckboxComponent, filter: false,
        ...(kind === 'generated' ? {} : {
          headerComponent: WfsPermissionHeaderComponent,
          headerComponentParams: {kind, all: (type: 'visible' | 'editable') => this.allFiltered(type),
            some: (type: 'visible' | 'editable') => this.someFiltered(type),
            eligible: (type: 'visible' | 'editable') => this.filteredRows(type).length > 0,
            toggle: (type: 'visible' | 'editable', checked: boolean) => this.toggleFiltered(type, checked),
            updates: this.refresh}
        }),
        cellRendererParams: {kind, toggle: (row: WfsPermissionRow, type: typeof kind, checked: boolean) =>
          this.setPermission(row, type, checked)}
      })),
      readOnly('common.form.name', 'name'),
      {...readOnly('common.form.label', 'label'), valueGetter: ({data}: {data?: WfsPermissionRow}) =>
        data ? this.presentation(data)?.value || data.name : ''},
      readOnly('wfsAttributePolicy.namespace', 'namespace'),
      {...readOnly('wfsAttributePolicy.format', 'format'), valueGetter: ({data}: {data?: WfsPermissionRow}) => {
        const format = data ? this.presentation(data)?.format : null;
        return this.formats.find((item) => item.value === (format || 'AUTO'))?.description || format || '';
      }},
      {...readOnly('wfsAttributePolicy.order', 'order'), valueGetter: ({data}: {data?: WfsPermissionRow}) =>
        data ? this.presentation(data)?.order ?? '' : ''}
    ];
  }

  toggle(row: WfsPermissionRow, editable: boolean): void {
    this.setPermission(row, 'editable', editable);
  }

  private filteredRows(kind: 'visible' | 'editable'): WfsPermissionRow[] {
    const rows: WfsPermissionRow[] = [];
    this.grid?.gridApi?.forEachNodeAfterFilter((node: {data?: WfsPermissionRow}) => {
      if (node.data && (kind === 'visible' || node.data.visible && !node.data.serviceGenerated)) rows.push(node.data);
    });
    return rows;
  }

  allFiltered(kind: 'visible' | 'editable'): boolean {
    const rows = this.filteredRows(kind);
    return rows.length > 0 && rows.every((row) => row[kind]);
  }

  someFiltered(kind: 'visible' | 'editable'): boolean {
    const rows = this.filteredRows(kind);
    return rows.some((row) => row[kind]) && !rows.every((row) => row[kind]);
  }

  toggleFiltered(kind: 'visible' | 'editable', checked: boolean): void {
    let changed = false;
    for (const row of this.filteredRows(kind)) changed = this.changeRow(row, kind, checked) || changed;
    if (changed) this.saveRows();
  }

  setPermission(row: WfsPermissionRow, kind: 'visible' | 'editable' | 'generated', checked: boolean): void {
    if (!this.schema || this.loading || this.incompatiblePolicy) return;
    const current = this.rows.find((item) => item.identity === row.identity);
    if (!current) return;
    if (this.changeRow(current, kind, checked)) this.saveRows();
  }

  private changeRow(row: WfsPermissionRow, kind: 'visible' | 'editable' | 'generated', checked: boolean): boolean {
    const before = [row.visible, row.editable, row.generated];
    if (kind === 'visible') {
      row.visible = checked;
      if (!checked) row.editable = false;
    } else if (kind === 'generated' && !row.serviceGenerated) {
      row.generated = checked;
      if (checked) row.editable = false;
    } else if (kind === 'editable' && row.visible && !row.serviceGenerated) {
      row.editable = checked;
      if (checked) row.generated = false;
    }
    return before[0] !== row.visible || before[1] !== row.editable || before[2] !== row.generated;
  }

  private saveRows(): void {
    if (!this.schema || this.loading || this.incompatiblePolicy) return;
    const policy = wfsPolicyFromRows(this.schema.featureType, this.rows,
      isCompatibleWfsPolicy(this.policy, this.schema) ? this.policy : undefined);
    this.policy = policy;
    this.policyChange.emit(policy);
    this.refresh.next(true);
  }
}
