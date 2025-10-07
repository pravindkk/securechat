// app/services/SocketService.ts
import { io, Socket } from 'socket.io-client';

export interface Message {
    id: string;
    from: string;
    to: string;
    text: string;
    timestamp: number;
    isOwn: boolean;
}

export class SocketService {
    private socket: Socket | null = null;
    private serverUrl: string;

    constructor(serverUrl: string) {
        this.serverUrl = serverUrl;
    }

    async connect(username: string, token: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = io(this.serverUrl, {
                auth: { token },
                transports: ['websocket'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
            });

            this.socket.on('connect', () => {
                console.log('Connected to server');
                this.socket?.emit('register', username);
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                console.error('Connection error:', error);
                reject(error);
            });
        });
    }

    onUsers(callback: (users: string[]) => void): void {
        this.socket?.on('users', callback);
    }

    onKeyExchange(callback: (data: any) => void): void {
        this.socket?.on('key-exchange', callback);
    }

    onKeyExchangeResponse(callback: (data: any) => void): void {
        this.socket?.on('key-exchange-response', callback);
    }

    onMessage(callback: (data: any) => void): void {
        this.socket?.on('message', callback);
    }

    onMessageAck(callback: (data: any) => void): void {
        this.socket?.on('message_delivered', callback);
    }

    emitKeyExchange(to: string, data: any): void {
        this.socket?.emit('key-exchange', { to, ...data });
    }

    emitKeyExchangeResponse(to: string, data: any): void {
        this.socket?.emit('key-exchange-response', { to, ...data });
    }

    emitMessage(to: string, encryptedMessage: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('Socket not connected'));
                return;
            }

            // Generate a simple UUID v4
            const messageId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });

            let settled = false;

            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    console.error(`⏱️ Message ${messageId} timed out after 30 seconds`);
                    reject(new Error('Message timeout'));
                }
            }, 30000);

            console.log(`📤 Sending message ${messageId} to ${to}`);

            this.socket.emit('message', {
                messageId,
                to,
                encryptedMessage
            }, (ack: any) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    console.log(`📥 Received ack for message ${messageId}:`, ack);

                    if (ack && ack.success) {
                        console.log(`✅ Message ${messageId} acknowledged successfully`);
                        resolve(messageId);
                    } else {
                        console.error(`❌ Message ${messageId} failed:`, ack?.error);
                        reject(new Error(ack?.error || 'Failed to send message'));
                    }
                } else {
                    console.warn(`⚠️ Ack received for ${messageId} but promise already settled`);
                }
            });
        });
    }

    emitMessageAck(messageId: string): void {
        this.socket?.emit('message_ack', { messageId });
    }

    disconnect(): void {
        this.socket?.disconnect();
        this.socket = null;
    }

    isConnected(): boolean {
        return this.socket?.connected || false;
    }
}