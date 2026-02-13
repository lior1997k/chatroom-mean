import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';

import { SocketService } from './socket';

describe('SocketService', () => {
  let service: SocketService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient()]
    });
    service = TestBed.inject(SocketService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
