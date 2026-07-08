import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TrackSearch } from './track-search';

describe('TrackSearch', () => {
  let component: TrackSearch;
  let fixture: ComponentFixture<TrackSearch>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrackSearch],
    }).compileComponents();

    fixture = TestBed.createComponent(TrackSearch);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
