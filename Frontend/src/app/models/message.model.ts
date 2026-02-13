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
  } | null;
  timestamp?: string;
  reactions?: Array<{ emoji: string; users: string[] }>;
  editedAt?: string | null;
  deletedAt?: string | null;
}

export interface ChatMessage extends Message {
  id: string;
  status?: 'sent' | 'delivered' | 'read';
}
