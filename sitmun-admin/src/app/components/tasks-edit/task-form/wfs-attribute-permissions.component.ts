import {HttpClient} from '@angular/common/http';
import {ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {ICellRendererAngularComp} from '@ag-grid-community/angular';
import {ICellRendererParams} from '@ag-grid-community/core';
import {TranslatePipe, TranslateService} from '@ngx-translate/core';
import {EMPTY, Subject, Subscription, catchError, defer, firstValueFrom, of, switchMap} from 'rxjs';
import {CartographyService} from '@app/domain';
import {CartographyParameter} from '@app/domain/cartography/models/cartography-parameter.model';
import {WfsAttributePolicy, WfsAttributeSchema, WfsPermissionRow, isCompatibleWfsPolicy, isWfsIdentity, wfsPermissionRows, wfsPolicyFromRows} from '@app/domain/task/models/wfs-attribute-policy';
import {DataGridComponent} from '@app/frontend-gui/src/lib/data-grid/data-grid.component';

type PermissionCellParams = ICellRendererParams<WfsPermissionRow> & {
  toggle: (row: WfsPermissionRow, checked: boolean) => void;
};

@Component({
  selector: 'app-wfs-permission-checkbox',
  standalone: true,
  imports: [MatCheckboxModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <mat-checkbox [checked]="params.data?.editable === true" [disabled]="!params.data"
      [aria-label]="('wfsAttributePolicy.editable' | translate) + ' ' + (params.data?.name || '')"
      (change)="params.data && params.toggle(params.data, $event.checked)" />
  `
})
export class WfsPermissionCheckboxComponent implements ICellRendererAngularComp {
  @Input() params!: PermissionCellParams;
  agInit(params: PermissionCellParams): void { this.params = params; }
  refresh(params: PermissionCellParams): boolean { this.params = params; return true; }
}

@Component({
  selector: 'app-wfs-attribute-permissions',
  standalone: true,
  imports: [TranslatePipe, MatButtonModule, DataGridComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <p>{{ 'wfsAttributePolicy.help' | translate }}</p>
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
    return this.policy.obsoleteAttributes ?? [];
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
        const missing = this.policy.editableAttributes.filter((identity) => !current.has(identity));
        if (missing.length) {
          const updated = {
            ...this.policy,
            editableAttributes: this.policy.editableAttributes.filter((identity) => current.has(identity)),
            obsoleteAttributes: [...new Set([...(this.policy.obsoleteAttributes ?? []), ...missing])]
          };
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
      {...readOnly('wfsAttributePolicy.editable', 'editable'), cellClass: 'sitmun-centered-cell',
        cellRenderer: WfsPermissionCheckboxComponent, filter: false,
        cellRendererParams: {toggle: (row: WfsPermissionRow, checked: boolean) => this.toggle(row, checked)}},
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
    if (!this.schema || this.loading || this.incompatiblePolicy) return;
    const current = this.rows.find((item) => item.identity === row.identity);
    if (!current) return;
    current.editable = editable;
    row.editable = editable;
    const policy = wfsPolicyFromRows(this.schema.featureType, this.rows,
      isCompatibleWfsPolicy(this.policy, this.schema) ? this.policy : undefined);
    this.policy = policy;
    this.policyChange.emit(policy);
  }
}
