import {ComponentFixture, TestBed} from '@angular/core/testing';

import { TranslateLoader, TranslatePipe, provideTranslateService } from '@ngx-translate/core';
import {of} from 'rxjs';

import {ServiceAccessTimelineComponent} from './service-access-timeline.component';

describe('ServiceAccessTimelineComponent', () => {
  let fixture: ComponentFixture<ServiceAccessTimelineComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ServiceAccessTimelineComponent],
      imports: [
        TranslatePipe,
      ],
    providers: [
      provideTranslateService({
          loader: {provide: TranslateLoader, useFactory: () => ({getTranslation: () => of({})})},
        })
    ]}).compileComponents();
    fixture = TestBed.createComponent(ServiceAccessTimelineComponent);
  });

  it('draws 144 cells and leaves a null bucket grey', () => {
    const hours = Array.from({length: 144}, () => null);
    hours[0] = {status: 'up', statusRank: 0, observer: 'proxy'};
    fixture.componentInstance.hours = hours;
    fixture.detectChanges();
    const cells = fixture.nativeElement.querySelectorAll('.service-access-trend .service-access-hour');
    expect(cells).toHaveLength(144);
    expect((cells[0] as HTMLElement).style.backgroundColor).toBe('rgb(46, 125, 50)');
    expect((cells[1] as HTMLElement).style.backgroundColor).not.toBe('rgb(46, 125, 50)');
    expect((cells[1] as HTMLElement).getAttribute('aria-label')).toContain('entity.service.access.noSample');
  });

  it('places five ticks under the strip and labels the last one now', () => {
    fixture.detectChanges();
    const ticks = fixture.nativeElement.querySelectorAll('.service-access-tick');

    expect(ticks).toHaveLength(5);
    expect((ticks[4] as HTMLElement).textContent?.trim()).toBe('entity.service.access.now');
  });

  it('keeps ticks and tooltips on the same bucket until hours changes', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-15T12:09:59'));
    try {
      fixture.componentRef.setInput('hours', Array.from({length: 144}, () => null));
      fixture.detectChanges();
      const firstTicks = fixture.componentInstance.tickLabels;
      const firstTitle = fixture.componentInstance.title(0);
      jest.setSystemTime(new Date('2024-01-15T12:10:01'));
      fixture.detectChanges();
      expect(fixture.componentInstance.tickLabels).toEqual(firstTicks);
      expect(fixture.componentInstance.title(0)).toBe(firstTitle);
      fixture.componentRef.setInput('hours', Array.from({length: 144}, () => null));
      fixture.detectChanges();
      expect(fixture.componentInstance.tickLabels).not.toEqual(firstTicks);
      expect(fixture.componentInstance.title(0)).not.toBe(firstTitle);
    } finally {
      jest.useRealTimers();
    }
  });
});
