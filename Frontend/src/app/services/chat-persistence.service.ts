import { Injectable } from '@angular/core';
import { ChatMessage } from '../models/message.model';

const STORAGE_KEYS = {
  PUBLIC_MESSAGES: 'chat_public_messages',
  PRIVATE_CHATS: 'chat_private_chats',
  PINNED_USERS: 'chat_pinned_users',
  DRAFTS: 'chat_drafts',
  UNREAD_COUNTS: 'chat_unread_counts',
  USERS_LIST: 'chat_users_list',
  MAX_MESSAGES: 500, // Keep last 500 messages per chat
};

@Injectable({
  providedIn: 'root',
})
export class ChatPersistenceService {
  // Save public messages
  savePublicMessages(messages: ChatMessage[]): void {
    try {
      // Keep only last N messages to avoid storage overflow
      const toSave = messages.slice(-STORAGE_KEYS.MAX_MESSAGES);
      localStorage.setItem(STORAGE_KEYS.PUBLIC_MESSAGES, JSON.stringify(toSave));
    } catch (e) {
      console.warn('Failed to save public messages:', e);
    }
  }

  // Load public messages
  loadPublicMessages(): ChatMessage[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PUBLIC_MESSAGES);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('Failed to load public messages:', e);
      return [];
    }
  }

  // Save private chats
  savePrivateChats(chats: Record<string, ChatMessage[]>): void {
    try {
      // Limit messages per chat
      const limited: Record<string, ChatMessage[]> = {};
      for (const [user, messages] of Object.entries(chats)) {
        limited[user] = messages.slice(-STORAGE_KEYS.MAX_MESSAGES);
      }
      localStorage.setItem(STORAGE_KEYS.PRIVATE_CHATS, JSON.stringify(limited));
    } catch (e) {
      console.warn('Failed to save private chats:', e);
    }
  }

  // Load private chats
  loadPrivateChats(): Record<string, ChatMessage[]> {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PRIVATE_CHATS);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      console.warn('Failed to load private chats:', e);
      return {};
    }
  }

  // Save pinned users
  savePinnedUsers(users: string[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PINNED_USERS, JSON.stringify(users));
    } catch (e) {
      console.warn('Failed to save pinned users:', e);
    }
  }

  // Load pinned users
  loadPinnedUsers(): string[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PINNED_USERS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('Failed to load pinned users:', e);
      return [];
    }
  }

  // Save drafts
  saveDrafts(drafts: Record<string, string>): void {
    try {
      localStorage.setItem(STORAGE_KEYS.DRAFTS, JSON.stringify(drafts));
    } catch (e) {
      console.warn('Failed to save drafts:', e);
    }
  }

  // Load drafts
  loadDrafts(): Record<string, string> {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DRAFTS);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      console.warn('Failed to load drafts:', e);
      return {};
    }
  }

  // Save unread counts
  saveUnreadCounts(counts: Record<string, number>): void {
    try {
      localStorage.setItem(STORAGE_KEYS.UNREAD_COUNTS, JSON.stringify(counts));
    } catch (e) {
      console.warn('Failed to save unread counts:', e);
    }
  }

  // Load unread counts
  loadUnreadCounts(): Record<string, number> {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.UNREAD_COUNTS);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      console.warn('Failed to load unread counts:', e);
      return {};
    }
  }

  // Save users list (for private chats sidebar)
  saveUsersList(users: string[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.USERS_LIST, JSON.stringify(users));
    } catch (e) {
      console.warn('Failed to save users list:', e);
    }
  }

  // Load users list
  loadUsersList(): string[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USERS_LIST);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('Failed to load users list:', e);
      return [];
    }
  }

  // Clear all chat data
  clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.PUBLIC_MESSAGES);
      localStorage.removeItem(STORAGE_KEYS.PRIVATE_CHATS);
      localStorage.removeItem(STORAGE_KEYS.PINNED_USERS);
      localStorage.removeItem(STORAGE_KEYS.DRAFTS);
      localStorage.removeItem(STORAGE_KEYS.UNREAD_COUNTS);
      localStorage.removeItem(STORAGE_KEYS.USERS_LIST);
    } catch (e) {
      console.warn('Failed to clear chat data:', e);
    }
  }
}
