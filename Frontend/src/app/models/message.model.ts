export interface Attachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  durationSeconds?: number;
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
  } | null;
  forwardedFrom?: {
    messageId: string;
    from: string;
    text: string;
    scope?: 'public' | 'private';
    attachment?: Attachment | null;
  } | null;
  attachment?: Attachment | null;
  attachments?: Attachment[];
  timestamp?: string;
  readAt?: string | null;
  reactions?: Array<{ emoji: string; users: string[] }>;
  editedAt?: string | null;
  deletedAt?: string | null;
}

export interface ChatMessage extends Message {
  id: string;
  status?: 'sent' | 'delivered' | 'read';
}
