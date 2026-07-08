import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TrackQueue } from './track-queue';

describe('TrackQueue', () => {
  let component: TrackQueue;
  let fixture: ComponentFixture<TrackQueue>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrackQueue],
    }).compileComponents();

    fixture = TestBed.createComponent(TrackQueue);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
