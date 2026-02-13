import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ChatComponent } from './chat';
import { AuthService } from '../../services/auth';
import { SocketService } from '../../services/socket';

describe('Chat', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;
  const socketMock = {
    connect: jasmine.createSpy('connect'),
    getMessages: () => of([]),
    getPrivateMessages: () => of([]),
    onOnlineUsers: () => of([]),
    onEvent: () => of(),
    emitEvent: jasmine.createSpy('emitEvent'),
    typingPublicStart: jasmine.createSpy('typingPublicStart'),
    typingPublicStop: jasmine.createSpy('typingPublicStop'),
    typingPrivateStart: jasmine.createSpy('typingPrivateStart'),
    typingPrivateStop: jasmine.createSpy('typingPrivateStop')
  };

  const authMock = {
    getToken: () => 'fake-token',
    getUsername: () => 'test-user'
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: SocketService, useValue: socketMock },
        { provide: AuthService, useValue: authMock }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
