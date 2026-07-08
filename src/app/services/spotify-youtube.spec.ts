import { TestBed } from '@angular/core/testing';

import { SpotifyYoutube } from './spotify-youtube';

describe('SpotifyYoutube', () => {
  let service: SpotifyYoutube;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SpotifyYoutube);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
