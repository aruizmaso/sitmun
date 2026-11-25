import {AsyncPipe} from '@angular/common';
import {Component, Input} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {Observable} from 'rxjs';
import {DataGridComponent} from '@app/frontend-gui/src/lib/data-grid/data-grid.component';
import {WfsPermissionRow} from '@app/domain/task/models/wfs-attribute-policy';
import {WfsAttributePermissionsComponent, WfsPermissionCheckboxComponent} from './wfs-attribute-permissions.component';

// The workspace maps AG Grid to an empty Jest stub. Control only that rendering
// boundary; keep the real permission checkbox, parent form and HTTP/save flow.
@Component({
  selector: 'app-data-grid',
  standalone: true,
  imports: [AsyncPipe, WfsPermissionCheckboxComponent],
  template: `
    <span hidden>{{ eventRefreshSubscription | async }}</span>
    <div role="grid">
      @for (row of getAll() | async; track row.identity) {
        <div role="row">
          <app-wfs-permission-checkbox [params]="$any({data: row, toggle: columnDefs[0].cellRendererParams.toggle})" />
          @for (column of columnDefs.slice(1); track column.field) {
            <span role="gridcell">{{ value(column, row) }}</span>
          }
        </div>
      }
    </div>
  `
})
export class WfsPermissionsGridFixture {
  @Input() columnDefs: any[] = [];
  @Input() getAll!: () => Observable<WfsPermissionRow[]>;
  @Input() eventRefreshSubscription!: Observable<boolean>;
  @Input() globalSearch: unknown;
  @Input() actionButton: unknown;
  @Input() hideDuplicateButton: unknown;
  @Input() hideSearchReplaceButton: unknown;
  @Input() hideReplaceButton: unknown;
  @Input() changeTracking: unknown;

  value(column: any, row: WfsPermissionRow): unknown {
    return column.valueFormatter?.({data: row}) ?? column.valueGetter?.({data: row}) ?? row[column.field];
  }
}

export function usePermissionGridFixture(): void {
  TestBed.overrideComponent(WfsAttributePermissionsComponent, {
    remove: {imports: [DataGridComponent]},
    add: {imports: [WfsPermissionsGridFixture]}
  });
}
