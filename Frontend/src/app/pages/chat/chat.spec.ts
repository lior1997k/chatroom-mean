import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
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

  it('should parse and expose search filter chips', () => {
    component.messageSearchQuery = 'ride has:media type:video from:test';
    expect(component.searchFilterChips()).toEqual(['has:media', 'type:video', 'from:test']);
  });

  it('should remove a selected search chip', () => {
    component.messageSearchQuery = 'hello has:media type:image';
    component.removeSearchFilterChip('type:image');
    expect(component.messageSearchQuery).toBe('hello has:media');
  });

  it('should append filter token without replacing search text', () => {
    component.searchOpen = true;
    component.messageSearchQuery = 'hello there';
    component.applySearchFilterTokenFromMenu('type:image');
    expect(component.messageSearchQuery).toBe('hello there type:image');
  });

  it('should not auto-jump when applying filter token', fakeAsync(() => {
    component.searchOpen = true;
    component.publicMessages = [
      {
        id: 'm-1',
        from: 'alice',
        text: 'photo one',
        timestamp: new Date().toISOString(),
        attachments: [{ url: '/uploads/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 1, isImage: true }]
      } as any
    ];

    const scrollSpy = spyOn<any>(component, 'scrollToMessage').and.stub();
    component.applySearchFilterTokenFromMenu('type:image');
    tick(230);

    expect(component.searchMatchIds).toEqual(['m-1']);
    expect(scrollSpy).not.toHaveBeenCalled();
  }));

  it('should retry a single failed upload item', () => {
    const file = new File(['payload'], 'failed.jpg', { type: 'image/jpeg' });
    component.uploadProgressItems = [
      {
        id: 'failed-1',
        name: 'failed.jpg',
        progress: 0,
        status: 'failed',
        file,
        error: 'network'
      }
    ];
    component.persistedFailedUploadNames = ['failed.jpg'];

    const uploadSpy = spyOn<any>(component, 'uploadAttachmentFiles').and.stub();
    component.retryUploadItem('failed-1');

    expect(uploadSpy).toHaveBeenCalledWith([file]);
    expect(component.uploadProgressItems.length).toBe(0);
    expect(component.persistedFailedUploadNames).toEqual([]);
  });

  it('should format resumable chunk details for display', () => {
    expect(component.formatChunkIndexes([2, 0, 2, 1])).toBe('1, 2, 3');
    expect(component.resumableProgressPercent([0, 2, 2], 5)).toBe(40);
  });

  it('should cycle voice playback speed per attachment', () => {
    const attachment = { url: '/uploads/vn.webm', name: 'voice.webm', mimeType: 'audio/webm', size: 10, isImage: false } as any;
    expect(component.voicePlaybackRateLabel(attachment)).toBe('1x');

    component.toggleVoicePlaybackRate(attachment);
    expect(component.voicePlaybackRateLabel(attachment)).toBe('1.5x');

    component.toggleVoicePlaybackRate(attachment);
    expect(component.voicePlaybackRateLabel(attachment)).toBe('2x');

    component.toggleVoicePlaybackRate(attachment);
    expect(component.voicePlaybackRateLabel(attachment)).toBe('1x');
  });

  it('should expose default waveform bars for audio attachments', () => {
    const attachment = { url: '/uploads/vn.webm', name: 'voice.webm', mimeType: 'audio/webm', size: 10, isImage: false } as any;
    const bars = component.voiceWaveformBars(attachment);
    expect(bars.length).toBeGreaterThan(0);
  });

  it('should group private media timeline by date buckets', () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    component.selectedUser = 'alice';
    component.privateChats['alice'] = [
      {
        id: '1',
        from: 'alice',
        to: 'test-user',
        text: 'today',
        timestamp: now.toISOString(),
        attachment: { url: '/uploads/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 1, isImage: true },
        attachments: [{ url: '/uploads/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 1, isImage: true }]
      } as any,
      {
        id: '2',
        from: 'alice',
        to: 'test-user',
        text: 'yesterday',
        timestamp: yesterday.toISOString(),
        attachment: { url: '/uploads/b.jpg', name: 'b.jpg', mimeType: 'image/jpeg', size: 1, isImage: true },
        attachments: [{ url: '/uploads/b.jpg', name: 'b.jpg', mimeType: 'image/jpeg', size: 1, isImage: true }]
      } as any
    ];

    const groups = component.privateMediaTimelineGroups();
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.some((g) => g.label === 'Today')).toBeTrue();
  });

  it('should open viewer when timeline thumbnail is clicked', fakeAsync(() => {
    const now = new Date().toISOString();
    component.selectedUser = 'alice';
    component.privateMediaTimelineOpen = true;
    component.privateChats['alice'] = [
      {
        id: 'img-1',
        from: 'alice',
        to: 'test-user',
        text: 'image',
        timestamp: now,
        attachment: { url: '/uploads/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 5, isImage: true },
        attachments: [{ url: '/uploads/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 5, isImage: true }]
      } as any
    ];

    const clickSpy = spyOn(component, 'openTimelineAttachment').and.callThrough();
    const dialogSpy = spyOn((component as any).dialog, 'open').and.returnValue({
      afterClosed: () => of(null)
    } as any);
    fixture.detectChanges();

    const timelineButton = fixture.nativeElement.querySelector('button[data-timeline-thumb="true"]') as HTMLButtonElement | null;
    expect(timelineButton).toBeTruthy();

    timelineButton?.dispatchEvent(new Event('click', { bubbles: true }));
    tick(1);

    expect(clickSpy).toHaveBeenCalled();
    expect(dialogSpy).toHaveBeenCalled();
  }));
});
