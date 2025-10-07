// server/messageQueue.js
const database = require('./database');

class MessageQueue {
    constructor(io) {
        this.io = io;
        this.users = new Map();
    }

    registerUser(username, socketId) {
        this.users.set(username, socketId);
    }

    unregisterUser(username) {
        this.users.delete(username);
    }

    async queueMessage(messageId, from, to, encryptedMessage) {
        await database.storeMessage(messageId, from, to, encryptedMessage);

        const recipientSocketId = this.users.get(to);
        if (recipientSocketId) {
            await this.deliverMessage(messageId, from, to, encryptedMessage, recipientSocketId);
        }
    }

    async deliverMessage(messageId, from, to, encryptedMessage, socketId) {
        return new Promise((resolve) => {
            // Get the actual socket instance
            const socket = this.io.sockets.sockets.get(socketId);

            if (!socket) {
                resolve(false);
                return;
            }

            socket.emit('message', {
                messageId,
                from,
                encryptedMessage,
                timestamp: Date.now()
            });

            const ackEvent = `ack_${messageId}`;
            let ackHandler;

            const timeout = setTimeout(() => {
                if (ackHandler) {
                    socket.off(ackEvent, ackHandler);
                }
                resolve(false);
            }, 10000);

            ackHandler = async () => {
                clearTimeout(timeout);
                await database.markMessageDelivered(messageId);
                resolve(true);
            };

            socket.once(ackEvent, ackHandler);
        });
    }

    async deliverUndeliveredMessages(username, socketId) {
        const messages = await database.getUndeliveredMessages(username);

        for (const msg of messages) {
            await this.deliverMessage(
                msg.id,
                msg.from_username,
                username,
                msg.encrypted_content,
                socketId
            );
        }
    }

    getOnlineUsers() {
        return Array.from(this.users.keys());
    }
}

module.exports = MessageQueue;