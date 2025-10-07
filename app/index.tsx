// app/index.tsx
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
    ActivityIndicator,
    Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cryptoService } from './services/CryptoService';
import { secureStorage } from './services/SecureStorage';
import { SocketService, Message } from './services/SocketService';

const SERVER_URL = 'http://localhost:3000'; // Change for production

export default function ChatScreen() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [users, setUsers] = useState<string[]>([]);
    const [selectedUser, setSelectedUser] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
    const [keyExchangeInProgress, setKeyExchangeInProgress] = useState(false);

    const socketServiceRef = useRef<SocketService | null>(null);
    const selectedUserRef = useRef<string | null>(null);
    const keyExchangeCompleteRef = useRef<Map<string, boolean>>(new Map());
    const authTokenRef = useRef<string | null>(null);

    useEffect(() => {
        return () => {
            socketServiceRef.current?.disconnect();
        };
    }, []);

    const register = async () => {
        if (!username.trim() || !password.trim()) {
            Alert.alert('Error', 'Please enter username and password');
            return;
        }

        setLoading(true);

        try {
            // Initialize crypto keys
            await cryptoService.initializeUser();

            // Get pre-key bundle to send to server
            const bundle = await cryptoService.getMyPreKeyBundle();

            // Register with server
            const response = await fetch(`${SERVER_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    password,
                    identityKey: bundle.identityKey,
                    signedPreKey: bundle.signedPreKey,
                    signedPreKeySignature: bundle.signedPreKeySignature,
                    signedPreKeyId: bundle.signedPreKeyId
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Registration failed');
            }

            Alert.alert('Success', 'Account created! Please login.');
            setPassword('');
        } catch (error: any) {
            Alert.alert('Error', error.message);
        } finally {
            setLoading(false);
        }
    };

    const login = async () => {
        if (!username.trim() || !password.trim()) {
            Alert.alert('Error', 'Please enter username and password');
            return;
        }

        setLoading(true);

        try {
            // Authenticate with server
            const response = await fetch(`${SERVER_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            const token = data.token;

            // Store credentials
            await secureStorage.storeUsername(username);
            authTokenRef.current = token;

            // Initialize crypto if needed
            await cryptoService.initializeUser();

            // Fetch and validate our keys match the server
            try {
                const bundleResponse = await fetch(`${SERVER_URL}/api/prekeys/${username}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (bundleResponse.ok) {
                    const serverBundle = await bundleResponse.json();

                    // Validate that our local identity key matches the server
                    const localBundle = await cryptoService.getMyPreKeyBundle();

                    if (localBundle.identityKey !== serverBundle.identityKey) {
                        throw new Error('Local keys do not match server. Please re-register or clear data and register again.');
                    }

                    if (localBundle.signedPreKeyId !== serverBundle.signedPreKeyId) {
                        console.warn('SPK ID mismatch - session establishment may fail');
                    }
                }
            } catch (error: any) {
                console.error('Key validation error:', error);
                Alert.alert('Key Mismatch', error.message || 'Local keys do not match server. Please re-register.');
                throw error;
            }

            // Connect to socket
            const socketService = new SocketService(SERVER_URL);
            socketServiceRef.current = socketService;

            await socketService.connect(username, token);

            // Setup socket listeners
            setupSocketListeners(socketService);

            setIsLoggedIn(true);
            setPassword('');
        } catch (error: any) {
            Alert.alert('Error', error.message);
        } finally {
            setLoading(false);
        }
    };

    const setupSocketListeners = (socketService: SocketService) => {
        socketService.onUsers((userList: string[]) => {
            setUsers(userList.filter(u => u !== username));
        });

        socketService.onKeyExchange(async ({ from, bundle, ephemeralPublicKey }) => {
            console.log('Received key exchange from:', from);
            setKeyExchangeInProgress(true);

            try {
                // Verify and accept the key exchange
                const state = await cryptoService.respondToSession(
                    username,
                    from,
                    bundle.identityKey,
                    ephemeralPublicKey
                );

                keyExchangeCompleteRef.current.set(from, true);
                await AsyncStorage.setItem(`key_exchange_complete_${username}_${from}`, 'true');

                // Send confirmation back
                const myBundle = await cryptoService.getMyPreKeyBundle();
                socketService.emitKeyExchangeResponse(from, { bundle: myBundle });

                setKeyExchangeInProgress(false);
                console.log('Key exchange completed with:', from);
            } catch (error: any) {
                console.error('Key exchange failed:', error);
                Alert.alert('Error', 'Failed to establish secure connection');
                setKeyExchangeInProgress(false);
            }
        });

        socketService.onKeyExchangeResponse(async ({ from, bundle }) => {
            console.log('Received key exchange response from:', from);

            // Now mark key exchange as complete for Alice (initiator)
            keyExchangeCompleteRef.current.set(from, true);
            await AsyncStorage.setItem(`key_exchange_complete_${username}_${from}`, 'true');
            setKeyExchangeInProgress(false);

            console.log('Key exchange completed with:', from);
        });

        socketService.onMessage(async ({ messageId, from, encryptedMessage, timestamp }) => {
            try {
                console.log('Received message from:', from);

                const decryptedText = await cryptoService.decryptMessage(username, from, encryptedMessage);

                const newMessage: Message = {
                    id: messageId,
                    from,
                    to: username,
                    text: decryptedText,
                    timestamp,
                    isOwn: false
                };

                // Store message
                const storedMessages = await AsyncStorage.getItem(`messages_${username}_${from}`);
                const existingMessages = storedMessages ? JSON.parse(storedMessages) : [];
                const updatedMessages = [...existingMessages, newMessage];
                await AsyncStorage.setItem(`messages_${username}_${from}`, JSON.stringify(updatedMessages));

                // Update UI
                if (selectedUserRef.current === from) {
                    setMessages(prev => [...prev, newMessage]);
                } else {
                    setUnreadCounts(prev => {
                        const newCounts = new Map(prev);
                        newCounts.set(from, (newCounts.get(from) || 0) + 1);
                        return newCounts;
                    });
                }

                // Send acknowledgment
                socketService.emitMessageAck(messageId);
            } catch (error: any) {
                console.error('Error processing message:', error);
                Alert.alert('Error', 'Failed to decrypt message');
            }
        });
    };

    const initiateKeyExchange = async (recipient: string) => {
        setKeyExchangeInProgress(true);

        try {
            // Get recipient's pre-key bundle from server
            const response = await fetch(`${SERVER_URL}/api/prekeys/${recipient}`, {
                headers: {
                    'Authorization': `Bearer ${authTokenRef.current}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to get recipient keys');
            }

            const recipientBundle = await response.json();

            // Initiate session
            const { ephemeralPublicKey } = await cryptoService.initiateSession(
                username,
                recipient,
                recipientBundle
            );

            // Send key exchange to recipient
            const myBundle = await cryptoService.getMyPreKeyBundle();
            socketServiceRef.current?.emitKeyExchange(recipient, {
                bundle: myBundle,
                ephemeralPublicKey
            });

            console.log('Key exchange initiated with:', recipient);
            // Don't mark as complete yet - wait for Bob's response

            // Set timeout
            setTimeout(() => {
                if (!keyExchangeCompleteRef.current.get(recipient)) {
                    console.log('Key exchange timeout for:', recipient);
                    setKeyExchangeInProgress(false);
                    Alert.alert('Error', 'Connection timeout. Please try again.');
                }
            }, 30000);
        } catch (error: any) {
            console.error('Key exchange error:', error);
            Alert.alert('Error', error.message);
            setKeyExchangeInProgress(false);
        }
    };

    const selectUser = async (user: string) => {
        setSelectedUser(user);
        selectedUserRef.current = user;

        // Clear unread count
        setUnreadCounts(prev => {
            const newCounts = new Map(prev);
            newCounts.delete(user);
            return newCounts;
        });

        // Load messages
        const storedMessages = await AsyncStorage.getItem(`messages_${username}_${user}`);
        const loadedMessages = storedMessages ? JSON.parse(storedMessages) : [];
        setMessages(loadedMessages);

        // Check if session exists
        const state = await secureStorage.getRatchetState(username, user);
        const keyExchangeComplete = await AsyncStorage.getItem(`key_exchange_complete_${username}_${user}`);

        if (!state && keyExchangeComplete !== 'true') {
            await initiateKeyExchange(user);
        } else if (state || keyExchangeComplete === 'true') {
            // Session exists or key exchange was completed
            keyExchangeCompleteRef.current.set(user, true);
            setKeyExchangeInProgress(false);
        }
    };

    const sendMessage = async () => {
        if (!inputMessage.trim() || !selectedUser) return;

        const keyExchangeComplete = keyExchangeCompleteRef.current.get(selectedUser);
        if (!keyExchangeComplete) {
            Alert.alert('Error', 'Please wait for secure connection to establish');
            return;
        }

        const messageText = inputMessage; // Capture the message text before clearing
        const tempMessageId = Date.now().toString(); // Temporary ID

        // Optimistic UI update - show message immediately with "sending" status
        const optimisticMessage: Message = {
            id: tempMessageId,
            from: username,
            to: selectedUser,
            text: messageText,
            timestamp: Date.now(),
            isOwn: true,
            status: 'sending'
        };

        setMessages(prev => [...prev, optimisticMessage]);
        setInputMessage(''); // Clear input immediately

        try {
            console.log('Encrypting message...');
            const encrypted = await cryptoService.encryptMessage(username, selectedUser, messageText);
            console.log('Message encrypted, sending via socket...');

            if (!socketServiceRef.current) {
                throw new Error('Socket not connected');
            }

            const messageId = await socketServiceRef.current.emitMessage(selectedUser, encrypted);
            console.log('Message sent with ID:', messageId);

            // Update message with real ID and "sent" status
            const sentMessage: Message = {
                id: messageId,
                from: username,
                to: selectedUser,
                text: messageText,
                timestamp: optimisticMessage.timestamp,
                isOwn: true,
                status: 'sent'
            };

            setMessages(prev =>
                prev.map(msg => msg.id === tempMessageId ? sentMessage : msg)
            );

            // Store message
            const storedMessages = await AsyncStorage.getItem(`messages_${username}_${selectedUser}`);
            const existingMessages = storedMessages ? JSON.parse(storedMessages) : [];
            const updatedMessages = [...existingMessages, sentMessage];
            await AsyncStorage.setItem(
                `messages_${username}_${selectedUser}`,
                JSON.stringify(updatedMessages)
            );

            console.log('✅ Message sent successfully and UI updated');
        } catch (error: any) {
            console.error('❌ Error sending message:', error);
            console.error('Error details:', error.message, error.stack);

            // Update message status to "failed"
            setMessages(prev =>
                prev.map(msg =>
                    msg.id === tempMessageId
                        ? { ...msg, status: 'failed' as const }
                        : msg
                )
            );

            Alert.alert('Error', `Failed to send message: ${error.message}`);
        }
    };

    const clearAllData = async () => {
        Alert.alert(
            'Clear All Data',
            'This will delete all keys, messages, and sessions. Are you sure?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: async () => {
                        await secureStorage.clearAll();
                        await AsyncStorage.clear();
                        Alert.alert('Success', 'All data cleared! Please restart the app.');
                    }
                }
            ]
        );
    };

    const logout = async () => {
        socketServiceRef.current?.disconnect();
        setIsLoggedIn(false);
        setUsername('');
        setPassword('');
        setSelectedUser(null);
        selectedUserRef.current = null;
        keyExchangeCompleteRef.current.clear();
    };

    if (!isLoggedIn) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>SecureChat</Text>
                <Text style={styles.subtitle}>End-to-End Encrypted Messaging</Text>

                <TextInput
                    style={styles.input}
                    placeholder="Username"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                />

                <TextInput
                    style={styles.input}
                    placeholder="Password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                />

                <TouchableOpacity style={styles.button} onPress={login} disabled={loading}>
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Login</Text>}
                </TouchableOpacity>

                <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={register} disabled={loading}>
                    <Text style={styles.buttonText}>Register</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.button, { backgroundColor: '#FF3B30', marginTop: 20 }]}
                    onPress={clearAllData}
                >
                    <Text style={styles.buttonText}>Clear All Data (Dev)</Text>
                </TouchableOpacity>
            </View>
        );
    }

    if (!selectedUser) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>Chats</Text>

                <FlatList
                    data={users}
                    keyExtractor={(item) => item}
                    renderItem={({ item }) => {
                        const unreadCount = unreadCounts.get(item) || 0;
                        return (
                            <TouchableOpacity style={styles.userItem} onPress={() => selectUser(item)}>
                                <Text style={styles.userText}>{item}</Text>
                                {unreadCount > 0 && (
                                    <View style={styles.unreadBadge}>
                                        <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        );
                    }}
                    ListEmptyComponent={<Text style={styles.emptyText}>No users online</Text>}
                />

                <TouchableOpacity style={[styles.button, { marginTop: 20 }]} onPress={logout}>
                    <Text style={styles.buttonText}>Logout</Text>
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
                    <View style={[styles.messageContainer, item.isOwn ? styles.ownMessage : styles.otherMessage]}>
                        <Text style={[styles.messageText, item.isOwn && styles.ownMessageText]}>{item.text}</Text>
                        <View style={styles.messageFooter}>
                            <Text style={[styles.timestamp, item.isOwn && styles.ownTimestamp]}>
                                {new Date(item.timestamp).toLocaleTimeString()}
                            </Text>
                            {item.isOwn && item.status && (
                                <Text style={[styles.statusIndicator, item.isOwn && styles.ownTimestamp]}>
                                    {item.status === 'sending' && ' ⏳'}
                                    {item.status === 'sent' && ' ✓'}
                                    {item.status === 'delivered' && ' ✓✓'}
                                    {item.status === 'failed' && ' ✗'}
                                </Text>
                            )}
                        </View>
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
    container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
    title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginTop: 60, marginBottom: 10, color: '#333' },
    subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 40, color: '#666' },
    input: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 20, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },
    button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 10, alignItems: 'center' },
    secondaryButton: { backgroundColor: '#5AC8FA', marginTop: 10 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    userItem: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#ddd', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    userText: { fontSize: 16, color: '#333' },
    unreadBadge: { backgroundColor: '#007AFF', borderRadius: 12, minWidth: 24, height: 24, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
    unreadBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    emptyText: { textAlign: 'center', color: '#999', marginTop: 20 },
    keyExchangeNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E3F2FD', padding: 12, marginBottom: 10, borderRadius: 8 },
    keyExchangeText: { marginLeft: 10, fontSize: 14, color: '#007AFF', fontWeight: '500' },
    header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ddd', marginBottom: 10 },
    backButton: { fontSize: 16, color: '#007AFF', marginRight: 15 },
    headerTitle: { fontSize: 18, fontWeight: '600', color: '#333' },
    messagesList: { paddingVertical: 10 },
    messageContainer: { maxWidth: '80%', padding: 12, borderRadius: 15, marginBottom: 10 },
    ownMessage: { alignSelf: 'flex-end', backgroundColor: '#007AFF' },
    otherMessage: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
    messageText: { fontSize: 16, color: '#333' },
    ownMessageText: { color: '#fff' },
    messageFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    timestamp: { fontSize: 10, color: '#999' },
    ownTimestamp: { color: '#E3F2FD' },
    statusIndicator: { fontSize: 10, marginLeft: 4 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', paddingTop: 10, borderTopWidth: 1, borderTopColor: '#ddd' },
    messageInput: { flex: 1, backgroundColor: '#fff', padding: 12, borderRadius: 20, marginRight: 10, maxHeight: 100, borderWidth: 1, borderColor: '#ddd' },
    sendButton: { backgroundColor: '#007AFF', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20 },
    sendButtonText: { color: '#fff', fontWeight: '600' }
});