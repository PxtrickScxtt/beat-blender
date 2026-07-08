import { TestBed } from '@angular/core/testing';

import { Mixer } from './mixer';

describe('Mixer', () => {
  let service: Mixer;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Mixer);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
