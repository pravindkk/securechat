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

    socket.on('key-exchange', async ({ from, publicKey, sharedSecret }) => {
      console.log('Received key exchange from:', from);

      // Bob receives Alice's DH public key and shared secret
      const sharedSecretBytes = new Uint8Array(
        atob(sharedSecret).split('').map(c => c.charCodeAt(0))
      );
      const alicePublicKey = new Uint8Array(
        atob(publicKey).split('').map(c => c.charCodeAt(0))
      );

      // Bob generates his own DH key pair
      const { keyPair: bobKeyPair } = generateSharedSecret();

      // Initialize Bob's ratchet state
      const state = initializeBob(sharedSecretBytes, bobKeyPair);
      // Don't set DHr here - it will be set when the first message arrives

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

        // Store updated messages
        await AsyncStorage.setItem(
          `messages_${username}_${from}`,
          JSON.stringify(updatedMessages)
        );

        // Update UI only if currently chatting with this user
        if (selectedUserRef.current === from) {
          setMessages(prev => [...prev, newMessage]);
        }
      } catch (error) {
        console.error('Error decrypting message:', error);
      }
    });
  };

  const initiateKeyExchange = async (recipient: string) => {
    try {
      // Generate shared secret and Alice's key pair
      const { sharedSecret, keyPair: aliceKeyPair } = generateSharedSecret();

      // Store shared secret for later use when Bob responds
      const sharedSecretBase64 = btoa(
        String.fromCharCode(...sharedSecret)
      );
      await AsyncStorage.setItem(
        `shared_secret_${username}_${recipient}`,
        sharedSecretBase64
      );

      // For now, create a placeholder Bob public key (will be updated when Bob responds)
      const placeholderBobKey = new Uint8Array(32);
      crypto.getRandomValues(placeholderBobKey);

      // Initialize Alice's state with placeholder (will be reinitialized when Bob responds)
      const state = initializeAlice(sharedSecret, placeholderBobKey);

      ratchetStatesRef.current.set(recipient, state);

      // Store state (will be replaced when Bob responds)
      await AsyncStorage.setItem(
        `ratchet_${username}_${recipient}`,
        serializeState(state)
      );

      // Send Alice's DH public key and shared secret to Bob
      const publicKeyBase64 = btoa(
        String.fromCharCode(...state.DHs!.publicKey)
      );

      socketRef.current?.emit('key-exchange', {
        to: recipient,
        publicKey: publicKeyBase64,
        sharedSecret: sharedSecretBase64
      });

      console.log('Key exchange initiated with:', recipient);
    } catch (error) {
      console.error('Error during key exchange:', error);
    }
  };

  const selectUser = async (user: string) => {
    setSelectedUser(user);
    selectedUserRef.current = user;
    setMessages([]);

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
        }
      } else {
        // Initiate key exchange
        await initiateKeyExchange(user);
      }
    }

    // Load messages from storage
    const storedMessages = await AsyncStorage.getItem(`messages_${username}_${user}`);
    if (storedMessages) {
      setMessages(JSON.parse(storedMessages));
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !selectedUser) return;

    try {
      let state = ratchetStatesRef.current.get(selectedUser);

      if (!state) {
        alert('Please wait for key exchange to complete');
        return;
      }

      // Check if key exchange is complete
      const keyExchangeComplete = keyExchangeCompleteRef.current.get(selectedUser);
      if (!keyExchangeComplete) {
        alert('Please wait for key exchange to complete');
        return;
      }

      console.log('Encrypting message:', inputMessage);
      const encryptedMessage = ratchetEncrypt(state, inputMessage);
      console.log('Encrypted message:', encryptedMessage);

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
      alert('Failed to send message');
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
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.userItem}
              onPress={() => selectUser(item)}
            >
              <Text style={styles.userText}>{item}</Text>
            </TouchableOpacity>
          )}
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
    borderColor: '#ddd'
  },
  userText: {
    fontSize: 16,
    color: '#333'
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 20
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
