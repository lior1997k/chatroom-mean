export interface Message {
  id?: string;
  from: string;
  to?: string;
  text: string;
  timestamp?: string;
}

export interface ChatMessage extends Message {
  id: string;
  status?: 'sent' | 'delivered' | 'read';
}
