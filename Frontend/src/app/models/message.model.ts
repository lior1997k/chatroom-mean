export interface Attachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  durationSeconds?: number;
  waveform?: number[];
  audioKind?: 'voice-note' | 'uploaded-audio';
  width?: number;
  height?: number;
  storageProvider?: 'local' | 's3';
  objectKey?: string;
}

export interface Message {
  id?: string;
  from: string;
  to?: string;
  text: string;
  replyTo?: {
    messageId: string;
    from: string;
    text: string;
    scope?: 'public' | 'private';
    attachment?: Attachment | null;
    attachments?: Attachment[];
  } | null;
  forwardedFrom?: {
    messageId: string;
    from: string;
    text: string;
    scope?: 'public' | 'private';
    attachment?: Attachment | null;
    attachments?: Attachment[];
  } | null;
  attachment?: Attachment | null;
  attachments?: Attachment[];
  timestamp?: string;
  readAt?: string | null;
  audioPlayback?: {
    by?: string;
    progress?: number;
    currentTimeSeconds?: number;
    durationSeconds?: number;
    attachmentKey?: string;
    listenedAt?: string | null;
  } | null;
  reactions?: Array<{ emoji: string; users: string[] }>;
  editedAt?: string | null;
  deletedAt?: string | null;
}

export interface ChatMessage extends Message {
  id: string;
  status?: 'sent' | 'delivered' | 'read';
}
