import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator
} from 'react-native';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  initializeAlice,
  initializeBob,
  ratchetEncrypt,
  ratchetDecrypt,
  generateSharedSecret,
  serializeState,
  deserializeState,
  RatchetState
} from '../crypto/doubleRatchet';

interface Message {
  id: string;
  from: string;
  text: string;
  timestamp: number;
  isOwn: boolean;
}

const SERVER_URL = 'http://localhost:3000'; // Change this to your server URL

export default function ChatScreen() {
  const [username, setUsername] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [keyExchangeInProgress, setKeyExchangeInProgress] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const ratchetStatesRef = useRef<Map<string, RatchetState>>(new Map());
  const selectedUserRef = useRef<string | null>(null);
  const keyExchangeCompleteRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const connectToServer = async () => {
    if (!username.trim()) {
      alert('Please enter a username');
      return;
    }

    setLoading(true);

    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to server');
      socket.emit('register', username);
      setIsLoggedIn(true);
      setLoading(false);
    });

    socket.on('users', (userList: string[]) => {
      setUsers(userList.filter(u => u !== username));
    });

    socket.on('key-exchange', async ({ from, sharedSecret }) => {
      console.log('Received key exchange from:', from);

      // Bob receives the shared secret from Alice
      const sharedSecretBytes = new Uint8Array(
        atob(sharedSecret).split('').map(c => c.charCodeAt(0))
      );

      // Bob generates his own DH key pair
      const { keyPair: bobKeyPair } = generateSharedSecret();

      // Initialize Bob's ratchet state
      const state = initializeBob(sharedSecretBytes, bobKeyPair);

      ratchetStatesRef.current.set(from, state);

      // Mark key exchange as complete for Bob
      keyExchangeCompleteRef.current.set(from, true);

      // Store state
      await AsyncStorage.setItem(
        `ratchet_${username}_${from}`,
        serializeState(state)
      );

      // Store key exchange completion
      await AsyncStorage.setItem(
        `key_exchange_complete_${username}_${from}`,
        'true'
      );

      // Send Bob's public key back to Alice
      const bobPublicKeyBase64 = btoa(
        String.fromCharCode(...bobKeyPair.publicKey)
      );

      socketRef.current?.emit('key-exchange-response', {
        to: from,
        publicKey: bobPublicKeyBase64
      });

      console.log('Sent key exchange response to:', from);
    });

    socket.on('key-exchange-response', async ({ from, publicKey }) => {
      console.log('Received key exchange response from:', from);

      const bobPublicKey = new Uint8Array(
        atob(publicKey).split('').map(c => c.charCodeAt(0))
      );

      // Get the shared secret from storage
      const sharedSecretKey = `shared_secret_${username}_${from}`;
      const sharedSecretB64 = await AsyncStorage.getItem(sharedSecretKey);

      if (sharedSecretB64) {
        const sharedSecret = new Uint8Array(
          atob(sharedSecretB64).split('').map(c => c.charCodeAt(0))
        );

        // Reinitialize Alice's state with the real Bob public key
        const newState = initializeAlice(sharedSecret, bobPublicKey);
        ratchetStatesRef.current.set(from, newState);

        // Mark key exchange as complete for Alice
        keyExchangeCompleteRef.current.set(from, true);

        // Store updated state
        await AsyncStorage.setItem(
          `ratchet_${username}_${from}`,
          serializeState(newState)
        );

        // Store key exchange completion
        await AsyncStorage.setItem(
          `key_exchange_complete_${username}_${from}`,
          'true'
        );

        console.log('Alice state reinitialized with Bob\'s real public key');

        // Clear key exchange in progress flag
        setKeyExchangeInProgress(false);
      }
    });

    socket.on('message', async ({ from, encryptedMessage, timestamp }) => {
      try {
        let state = ratchetStatesRef.current.get(from);

        if (!state) {
          const storedState = await AsyncStorage.getItem(`ratchet_${username}_${from}`);
          if (storedState) {
            state = deserializeState(storedState);
            ratchetStatesRef.current.set(from, state);
          } else {
            console.error('No ratchet state found for:', from);
            return;
          }
        }

        console.log('Decrypting message from:', from);
        const decryptedText = ratchetDecrypt(state, encryptedMessage);
        console.log('Decrypted message:', decryptedText);

        // Update stored state
        await AsyncStorage.setItem(
          `ratchet_${username}_${from}`,
          serializeState(state)
        );

        const newMessage: Message = {
          id: Date.now().toString(),
          from,
          text: decryptedText,
          timestamp,
          isOwn: false
        };

        // Load existing messages and append new one
        const storedMessages = await AsyncStorage.getItem(`messages_${username}_${from}`);
        const existingMessages = storedMessages ? JSON.parse(storedMessages) : [];
        const updatedMessages = [...existingMessages, newMessage];

        console.log(`Storing message from ${from}, total messages now: ${updatedMessages.length}`);
        console.log(`Storage key: messages_${username}_${from}`);

        // Store updated messages
        await AsyncStorage.setItem(
          `messages_${username}_${from}`,
          JSON.stringify(updatedMessages)
        );

        // Verify storage
        const verification = await AsyncStorage.getItem(`messages_${username}_${from}`);
        console.log(`Verification: stored ${verification ? JSON.parse(verification).length : 0} messages`);

        console.log(`Current selected user: ${selectedUserRef.current}, message from: ${from}`);

        // Update UI only if currently chatting with this user
        if (selectedUserRef.current === from) {
          console.log('Adding message to UI');
          setMessages(prev => [...prev, newMessage]);
        } else {
          console.log('User not viewing this chat, incrementing unread count');
          // Increment unread count if not viewing this chat
          setUnreadCounts(prev => {
            const newCounts = new Map(prev);
            newCounts.set(from, (newCounts.get(from) || 0) + 1);
            return newCounts;
          });
        }
      } catch (error) {
        console.error('Error decrypting message:', error);
      }
    });
  };

  const initiateKeyExchange = async (recipient: string) => {
    try {
      // Set key exchange in progress
      setKeyExchangeInProgress(true);

      // Generate shared secret
      const { sharedSecret } = generateSharedSecret();

      // Store shared secret for later use when Bob responds
      const sharedSecretBase64 = btoa(
        String.fromCharCode(...sharedSecret)
      );
      await AsyncStorage.setItem(
        `shared_secret_${username}_${recipient}`,
        sharedSecretBase64
      );

      // Don't initialize Alice's state yet - wait for Bob's public key
      // Just send the shared secret to Bob
      socketRef.current?.emit('key-exchange', {
        to: recipient,
        sharedSecret: sharedSecretBase64
      });

      console.log('Key exchange initiated with:', recipient);

      // Set a timeout in case Bob doesn't respond
      setTimeout(() => {
        // Check if key exchange completed
        if (!keyExchangeCompleteRef.current.get(recipient)) {
          console.log('Key exchange timeout for:', recipient);
          setKeyExchangeInProgress(false);
        }
      }, 10000); // 10 second timeout
    } catch (error) {
      console.error('Error during key exchange:', error);
      setKeyExchangeInProgress(false);
    }
  };

  const selectUser = async (user: string) => {
    setSelectedUser(user);
    selectedUserRef.current = user;

    // Clear unread count for this user
    setUnreadCounts(prev => {
      const newCounts = new Map(prev);
      newCounts.delete(user);
      return newCounts;
    });

    // Load messages from storage first
    console.log(`Loading messages for ${user}, storage key: messages_${username}_${user}`);
    const storedMessages = await AsyncStorage.getItem(`messages_${username}_${user}`);
    const loadedMessages = storedMessages ? JSON.parse(storedMessages) : [];
    console.log(`Loading messages for ${user}:`, loadedMessages.length, 'messages');
    console.log('Loaded messages:', loadedMessages);
    setMessages(loadedMessages);

    // Check if we have a ratchet state for this user
    let state = ratchetStatesRef.current.get(user);

    if (!state) {
      const storedState = await AsyncStorage.getItem(`ratchet_${username}_${user}`);
      if (storedState) {
        state = deserializeState(storedState);
        ratchetStatesRef.current.set(user, state);

        // Load key exchange completion status
        const keyExchangeComplete = await AsyncStorage.getItem(`key_exchange_complete_${username}_${user}`);
        if (keyExchangeComplete === 'true') {
          keyExchangeCompleteRef.current.set(user, true);
          setKeyExchangeInProgress(false); // Clear the flag if key exchange is already complete
        }
      } else {
        // Initiate key exchange
        await initiateKeyExchange(user);
      }
    } else {
      // State exists, check if key exchange is complete
      const keyExchangeComplete = await AsyncStorage.getItem(`key_exchange_complete_${username}_${user}`);
      if (keyExchangeComplete === 'true') {
        keyExchangeCompleteRef.current.set(user, true);
        setKeyExchangeInProgress(false); // Clear the flag if key exchange is already complete
      }
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !selectedUser) return;

    try {
      let state = ratchetStatesRef.current.get(selectedUser);

      if (!state) {
        console.log('No ratchet state found for:', selectedUser);
        alert('Please wait for key exchange to complete');
        return;
      }

      // Check if key exchange is complete
      const keyExchangeComplete = keyExchangeCompleteRef.current.get(selectedUser);
      console.log('Key exchange complete status:', keyExchangeComplete);
      if (!keyExchangeComplete) {
        alert('Please wait for key exchange to complete');
        return;
      }

      console.log('Encrypting message:', inputMessage);
      console.log('Ratchet state before encryption:', {
        Ns: state.Ns,
        Nr: state.Nr,
        hasDHs: !!state.DHs,
        hasDHr: !!state.DHr
      });

      const encryptedMessage = ratchetEncrypt(state, inputMessage);
      console.log('Encrypted message created');

      // Update stored state
      await AsyncStorage.setItem(
        `ratchet_${username}_${selectedUser}`,
        serializeState(state)
      );

      socketRef.current?.emit('message', {
        to: selectedUser,
        encryptedMessage
      });

      const newMessage: Message = {
        id: Date.now().toString(),
        from: username,
        text: inputMessage,
        timestamp: Date.now(),
        isOwn: true
      };

      const updatedMessages = [...messages, newMessage];
      setMessages(updatedMessages);

      // Store messages
      await AsyncStorage.setItem(
        `messages_${username}_${selectedUser}`,
        JSON.stringify(updatedMessages)
      );

      setInputMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message: ' + error.message);
    }
  };

  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>SecureChat</Text>
        <Text style={styles.subtitle}>End-to-End Encrypted Messaging</Text>

        <TextInput
          style={styles.input}
          placeholder="Enter your username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={styles.button}
          onPress={connectToServer}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  if (!selectedUser) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Select a User to Chat</Text>

        <FlatList
          data={users}
          keyExtractor={(item) => item}
          renderItem={({ item }) => {
            const unreadCount = unreadCounts.get(item) || 0;
            return (
              <TouchableOpacity
                style={styles.userItem}
                onPress={() => selectUser(item)}
              >
                <Text style={styles.userText}>{item}</Text>
                {unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No users online</Text>
          }
        />

        <TouchableOpacity
          style={[styles.button, { marginTop: 20 }]}
          onPress={() => {
            socketRef.current?.disconnect();
            setIsLoggedIn(false);
            setUsername('');
            setSelectedUser(null);
            selectedUserRef.current = null;
          }}
        >
          <Text style={styles.buttonText}>Disconnect</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          setSelectedUser(null);
          selectedUserRef.current = null;
        }}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{selectedUser}</Text>
      </View>

      {keyExchangeInProgress && (
        <View style={styles.keyExchangeNotice}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.keyExchangeText}>Establishing secure connection...</Text>
        </View>
      )}

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            style={[
              styles.messageContainer,
              item.isOwn ? styles.ownMessage : styles.otherMessage
            ]}
          >
            <Text style={styles.messageText}>{item.text}</Text>
            <Text style={styles.timestamp}>
              {new Date(item.timestamp).toLocaleTimeString()}
            </Text>
          </View>
        )}
        contentContainerStyle={styles.messagesList}
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.messageInput}
          placeholder="Type a message..."
          value={inputMessage}
          onChangeText={setInputMessage}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 60,
    marginBottom: 10,
    color: '#333'
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 40,
    color: '#666'
  },
  input: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd'
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center'
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  userItem: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  userText: {
    fontSize: 16,
    color: '#333'
  },
  unreadBadge: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700'
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 20
  },
  keyExchangeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E3F2FD',
    padding: 12,
    marginBottom: 10,
    borderRadius: 8
  },
  keyExchangeText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    marginBottom: 10
  },
  backButton: {
    fontSize: 16,
    color: '#007AFF',
    marginRight: 15
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333'
  },
  messagesList: {
    paddingVertical: 10
  },
  messageContainer: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 15,
    marginBottom: 10
  },
  ownMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF'
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd'
  },
  messageText: {
    fontSize: 16,
    color: '#333'
  },
  timestamp: {
    fontSize: 10,
    color: '#999',
    marginTop: 4
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#ddd'
  },
  messageInput: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 20,
    marginRight: 10,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#ddd'
  },
  sendButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '600'
  }
});
