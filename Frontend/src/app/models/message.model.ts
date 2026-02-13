export interface Message {
  id?: string;
  from: string;
  to?: string;
  text: string;
  timestamp?: string;
  reactions?: Array<{ emoji: string; users: string[] }>;
}

export interface ChatMessage extends Message {
  id: string;
  status?: 'sent' | 'delivered' | 'read';
}
