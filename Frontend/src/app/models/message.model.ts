export interface Message {
  id?: string;
  kind?: 'text' | 'voice';
  from: string;
  to?: string;
  text?: string;
  mediaUrl?: string;   // voice file URL
  durationMs?: number; // voice length
  timestamp?: string;
}

export interface ChatMessage extends Message {
  status?: 'sent' | 'delivered' | 'read';
}
