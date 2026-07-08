import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MixDeck } from './mix-deck';

describe('MixDeck', () => {
  let component: MixDeck;
  let fixture: ComponentFixture<MixDeck>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MixDeck],
    }).compileComponents();

    fixture = TestBed.createComponent(MixDeck);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
