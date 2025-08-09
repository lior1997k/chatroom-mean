import { TestBed } from '@angular/core/testing';

import { AudioRecorder } from './audio-recorder';

describe('AudioRecorder', () => {
  let service: AudioRecorder;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AudioRecorder);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
