// app/services/CryptoService.ts
import {
    initializeAlice,
    initializeBob,
    ratchetEncrypt,
    ratchetDecrypt,
    generateDHKeyPair
} from '../../crypto/doubleRatchet';
import {
    generateIdentityKeyPair,
    generateSignedPreKey,
    verifySignedPreKey,
    x3dhInitiatorSharedSecret,
    x3dhResponderSharedSecret,
    createPreKeyBundle
} from '../../crypto/x3dh';
import { secureStorage } from './SecureStorage';
import type { PreKeyBundle, RatchetState } from '../../crypto/types';
import { decode as decodeBase64, encode as encodeBase64 } from '@stablelib/base64';

export class CryptoService {
    async initializeUser(): Promise<void> {
        let identityKey = await secureStorage.getIdentityKey();

        if (!identityKey) {
            identityKey = generateIdentityKeyPair();
            await secureStorage.storeIdentityKey(identityKey);

            // Only generate SPK if this is a new user
            const signedPreKey = generateSignedPreKey(identityKey.privateKey, Date.now());
            await secureStorage.storeSignedPreKey(signedPreKey);
        }
        // Don't regenerate SPK on subsequent logins - keep the one registered with server
    }

    async getMyPreKeyBundle(): Promise<PreKeyBundle> {
        const identityKey = await secureStorage.getIdentityKey();
        if (!identityKey) {
            throw new Error('Identity key not found');
        }

        // Get the current signed pre-key ID (must exist from registration)
        const keyId = await secureStorage.getCurrentSignedPreKeyId();
        if (!keyId) {
            throw new Error('No signed pre-key found. Please register first.');
        }

        const signedPreKey = await secureStorage.getSignedPreKey(keyId);
        if (!signedPreKey) {
            throw new Error('Signed pre-key not found in storage');
        }

        return createPreKeyBundle(identityKey.publicKey, signedPreKey);
    }

    async initiateSession(
        username: string,
        recipient: string,
        recipientBundle: PreKeyBundle
    ): Promise<{ ephemeralPublicKey: string }> {
        console.log('🔑 [Alice] Initiating session with', recipient);

        const identityKey = await secureStorage.getIdentityKey();
        if (!identityKey) {
            throw new Error('Identity key not found');
        }

        const recipientIdentityKey = decodeBase64(recipientBundle.identityKey);
        const recipientSignedPreKey = decodeBase64(recipientBundle.signedPreKey);
        const signature = decodeBase64(recipientBundle.signedPreKeySignature);

        console.log('🔑 [Alice] Verifying signature...');
        if (!verifySignedPreKey(recipientIdentityKey, recipientSignedPreKey, signature)) {
            throw new Error('Invalid signed pre-key signature');
        }

        const ephemeralKeyPair = generateDHKeyPair();
        const recipientOneTimePreKey = recipientBundle.oneTimePreKey
            ? decodeBase64(recipientBundle.oneTimePreKey)
            : undefined;

        console.log('🔑 [Alice] Computing shared secret...');
        const sharedSecret = x3dhInitiatorSharedSecret(
            identityKey,
            ephemeralKeyPair,
            recipientIdentityKey,
            recipientSignedPreKey,
            recipientOneTimePreKey
        );
        console.log('🔑 [Alice] Shared secret:', encodeBase64(sharedSecret));

        console.log('🔑 [Alice] Initializing ratchet state...');
        const aliceState = initializeAlice(sharedSecret, recipientSignedPreKey);

        await secureStorage.storeRatchetState(username, recipient, aliceState);
        console.log('🔑 [Alice] Session initialized, state stored');

        return {
            ephemeralPublicKey: encodeBase64(ephemeralKeyPair.publicKey)
        };
    }

    async respondToSession(
        username: string,
        initiator: string,
        initiatorIdentityKey: string,
        ephemeralPublicKey: string
    ): Promise<RatchetState> {
        console.log('🔑 [Bob] Responding to session from', initiator);

        const identityKey = await secureStorage.getIdentityKey();
        if (!identityKey) {
            throw new Error('Identity key not found');
        }

        // Get Bob's own signed pre-key (the one registered with the server)
        const signedPreKeyId = await secureStorage.getCurrentSignedPreKeyId();
        if (!signedPreKeyId) {
            throw new Error('No signed pre-key found');
        }

        const signedPreKey = await secureStorage.getSignedPreKey(signedPreKeyId);
        if (!signedPreKey) {
            throw new Error('Signed pre-key not found');
        }

        const initiatorIdentity = decodeBase64(initiatorIdentityKey);
        const ephemeralKey = decodeBase64(ephemeralPublicKey);

        console.log('🔑 [Bob] Computing shared secret...');
        const sharedSecret = x3dhResponderSharedSecret(
            identityKey,
            signedPreKey.keyPair,
            null,
            initiatorIdentity,
            ephemeralKey
        );
        console.log('🔑 [Bob] Shared secret:', encodeBase64(sharedSecret));

        console.log('🔑 [Bob] Initializing ratchet state...');
        const bobState = initializeBob(sharedSecret, signedPreKey.keyPair);
        await secureStorage.storeRatchetState(username, initiator, bobState);
        console.log('🔑 [Bob] Session initialized, state stored');

        return bobState;
    }

    async encryptMessage(username: string, recipient: string, plaintext: string): Promise<string> {
        let state = await secureStorage.getRatchetState(username, recipient);

        if (!state) {
            throw new Error('No session established');
        }

        const encrypted = ratchetEncrypt(state, plaintext);
        await secureStorage.storeRatchetState(username, recipient, state);

        return encrypted;
    }

    async decryptMessage(username: string, sender: string, encryptedMessage: string): Promise<string> {
        let state = await secureStorage.getRatchetState(username, sender);

        if (!state) {
            throw new Error('No session established');
        }

        const decrypted = ratchetDecrypt(state, encryptedMessage);
        await secureStorage.storeRatchetState(username, sender, state);

        return decrypted;
    }
}

export const cryptoService = new CryptoService();