// app/services/SecureStorage.ts
import * as SecureStore from 'expo-secure-store';
import { serializeState, deserializeState } from '../../crypto/doubleRatchet';
import type { RatchetState, IdentityKeyPair, SignedPreKey } from '../../crypto/types';
import { encode as encodeBase64, decode as decodeBase64 } from '@stablelib/base64';

export class SecureStorage {
    private static readonly IDENTITY_KEY = 'identity_key';
    private static readonly SIGNED_PREKEY_PREFIX = 'signed_prekey_';
    private static readonly RATCHET_PREFIX = 'ratchet_';
    private static readonly USERNAME_KEY = 'current_username';
    private static readonly CURRENT_SIGNED_PREKEY_ID = 'current_signed_prekey_id';

    async storeIdentityKey(identityKey: IdentityKeyPair): Promise<void> {
        const serialized = JSON.stringify({
            privateKey: encodeBase64(identityKey.privateKey),
            publicKey: encodeBase64(identityKey.publicKey)
        });

        await SecureStore.setItemAsync(SecureStorage.IDENTITY_KEY, serialized, {
            requireAuthentication: false,
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
    }

    async getIdentityKey(): Promise<IdentityKeyPair | null> {
        try {
            const serialized = await SecureStore.getItemAsync(SecureStorage.IDENTITY_KEY);
            if (!serialized) return null;

            const obj = JSON.parse(serialized);
            return {
                privateKey: decodeBase64(obj.privateKey),
                publicKey: decodeBase64(obj.publicKey)
            };
        } catch (error) {
            console.error('Failed to retrieve identity key:', error);
            return null;
        }
    }

    async storeSignedPreKey(signedPreKey: SignedPreKey): Promise<void> {
        const serialized = JSON.stringify({
            keyId: signedPreKey.keyId,
            privateKey: encodeBase64(signedPreKey.keyPair.privateKey),
            publicKey: encodeBase64(signedPreKey.keyPair.publicKey),
            signature: encodeBase64(signedPreKey.signature),
            timestamp: signedPreKey.timestamp
        });

        await SecureStore.setItemAsync(
            `${SecureStorage.SIGNED_PREKEY_PREFIX}${signedPreKey.keyId}`,
            serialized,
            {
                requireAuthentication: false,
                keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            }
        );

        // Store the current key ID for easy retrieval
        await SecureStore.setItemAsync(
            SecureStorage.CURRENT_SIGNED_PREKEY_ID,
            signedPreKey.keyId.toString(),
            {
                requireAuthentication: false,
                keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            }
        );
    }

    async getCurrentSignedPreKeyId(): Promise<number | null> {
        try {
            const keyId = await SecureStore.getItemAsync(SecureStorage.CURRENT_SIGNED_PREKEY_ID);
            return keyId ? parseInt(keyId, 10) : null;
        } catch (error) {
            console.error('Failed to retrieve current signed pre-key ID:', error);
            return null;
        }
    }

    async getSignedPreKey(keyId: number): Promise<SignedPreKey | null> {
        try {
            const serialized = await SecureStore.getItemAsync(
                `${SecureStorage.SIGNED_PREKEY_PREFIX}${keyId}`
            );
            if (!serialized) return null;

            const obj = JSON.parse(serialized);
            return {
                keyId: obj.keyId,
                keyPair: {
                    privateKey: decodeBase64(obj.privateKey),
                    publicKey: decodeBase64(obj.publicKey)
                },
                signature: decodeBase64(obj.signature),
                timestamp: obj.timestamp
            };
        } catch (error) {
            console.error('Failed to retrieve signed pre-key:', error);
            return null;
        }
    }

    async storeRatchetState(username: string, recipient: string, state: RatchetState): Promise<void> {
        const key = `${SecureStorage.RATCHET_PREFIX}${username}_${recipient}`;
        const serialized = serializeState(state);

        await SecureStore.setItemAsync(key, serialized, {
            requireAuthentication: false,
            keychainAccessible: SecureStore.WHEN_UNLOCKED,
        });
    }

    async getRatchetState(username: string, recipient: string): Promise<RatchetState | null> {
        try {
            const key = `${SecureStorage.RATCHET_PREFIX}${username}_${recipient}`;
            const serialized = await SecureStore.getItemAsync(key);

            if (!serialized) return null;
            return deserializeState(serialized);
        } catch (error) {
            console.error('Failed to retrieve ratchet state:', error);
            return null;
        }
    }

    async storeUsername(username: string): Promise<void> {
        await SecureStore.setItemAsync(SecureStorage.USERNAME_KEY, username, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED,
        });
    }

    async getUsername(): Promise<string | null> {
        return await SecureStore.getItemAsync(SecureStorage.USERNAME_KEY);
    }

    async deleteRatchetState(username: string, recipient: string): Promise<void> {
        const key = `${SecureStorage.RATCHET_PREFIX}${username}_${recipient}`;
        await SecureStore.deleteItemAsync(key);
    }

    async clearAll(): Promise<void> {
        try {
            await SecureStore.deleteItemAsync(SecureStorage.IDENTITY_KEY);
            await SecureStore.deleteItemAsync(SecureStorage.USERNAME_KEY);
            await SecureStore.deleteItemAsync(SecureStorage.CURRENT_SIGNED_PREKEY_ID);

            // Note: We can't easily enumerate and delete all SPKs and ratchet states
            // In production, you'd want to track these keys and delete them properly
            console.warn('Some keys may remain in storage. Consider full app reinstall for complete cleanup.');
        } catch (error) {
            console.error('Failed to clear storage:', error);
        }
    }
}

export const secureStorage = new SecureStorage();