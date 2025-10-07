// crypto/doubleRatchet.ts
import 'react-native-get-random-values';
import { randomBytes } from '@stablelib/random';
import { sharedKey, scalarMultBase, SECRET_KEY_LENGTH, SHARED_KEY_LENGTH } from '@stablelib/x25519';
import { HKDF } from '@stablelib/hkdf';
import { HMAC } from '@stablelib/hmac';
import { SHA256 } from '@stablelib/sha256';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { encode as encodeBase64, decode as decodeBase64 } from '@stablelib/base64';
import { encode as encodeUTF8, decode as decodeUTF8 } from '@stablelib/utf8';
import { RatchetState, MessageHeader, EncryptedMessage } from './types';

const MAX_SKIP = 1000;

// Utility functions
function concatArrayBuffers(...buffers: Uint8Array[]): Uint8Array {
    const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
        result.set(buffer, offset);
        offset += buffer.length;
    }
    return result;
}

export function generateDHKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
    const privateKey = randomBytes(SECRET_KEY_LENGTH);
    const publicKey = scalarMultBase(privateKey);
    return { privateKey, publicKey };
}

function DH(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    return sharedKey(privateKey, publicKey);
}

function hkdf(
    inputKeyMaterial: Uint8Array,
    salt: Uint8Array,
    info: string,
    length: number
): Uint8Array {
    const hkdfInstance = new HKDF(SHA256, inputKeyMaterial, salt, encodeUTF8(info));
    return hkdfInstance.expand(length);
}

// Signal-compliant KDF_RK
function KDF_RK(rootKey: Uint8Array, dhOutput: Uint8Array): { rootKey: Uint8Array; chainKey: Uint8Array } {
    const output = hkdf(
        dhOutput,
        rootKey,
        'SIGNAL_ROOT_KEY',
        SHARED_KEY_LENGTH * 2
    );

    return {
        rootKey: output.slice(0, SHARED_KEY_LENGTH),
        chainKey: output.slice(SHARED_KEY_LENGTH, SHARED_KEY_LENGTH * 2)
    };
}

// Signal-compliant KDF_CK using HMAC-SHA-256
function KDF_CK(chainKey: Uint8Array): { messageKey: Uint8Array; chainKey: Uint8Array } {
    const hmacMK = new HMAC(SHA256, chainKey);
    hmacMK.update(new Uint8Array([0x01]));
    const messageKey = hmacMK.digest();

    const hmacCK = new HMAC(SHA256, chainKey);
    hmacCK.update(new Uint8Array([0x02]));
    const nextChainKey = hmacCK.digest();

    return { messageKey, chainKey: nextChainKey };
}

function ENCRYPT(
    messageKey: Uint8Array,
    plaintext: Uint8Array,
    associatedData: Uint8Array
): { nonce: Uint8Array; ciphertext: Uint8Array } {
    const cipher = new XChaCha20Poly1305(messageKey);
    const nonce = randomBytes(24);
    const ciphertext = cipher.seal(nonce, plaintext, associatedData);
    return { nonce, ciphertext };
}

function DECRYPT(
    messageKey: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    associatedData: Uint8Array
): Uint8Array {
    const cipher = new XChaCha20Poly1305(messageKey);
    const plaintext = cipher.open(nonce, ciphertext, associatedData);
    if (plaintext === null) {
        throw new Error('Decryption failed: authentication tag mismatch');
    }
    return plaintext;
}

function encodeHeader(header: MessageHeader): Uint8Array {
    return encodeUTF8(JSON.stringify(header));
}

export function initializeAlice(sharedSecret: Uint8Array, bobPublicKey: Uint8Array): RatchetState {
    const rootKey = hkdf(sharedSecret, new Uint8Array(SHARED_KEY_LENGTH), 'SIGNAL_ROOT', SHARED_KEY_LENGTH);
    const DHs = generateDHKeyPair();
    const dhOutput = DH(DHs.privateKey, bobPublicKey);
    const { rootKey: newRootKey, chainKey: sendingChainKey } = KDF_RK(rootKey, dhOutput);

    return {
        DHs,
        DHr: bobPublicKey,
        RK: newRootKey,
        CKs: sendingChainKey,
        CKr: null,
        Ns: 0,
        Nr: 0,
        PN: 0,
        MKSKIPPED: new Map()
    };
}

export function initializeBob(sharedSecret: Uint8Array, bobKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array }): RatchetState {
    const rootKey = hkdf(sharedSecret, new Uint8Array(SHARED_KEY_LENGTH), 'SIGNAL_ROOT', SHARED_KEY_LENGTH);

    return {
        DHs: bobKeyPair,
        DHr: null,
        RK: rootKey,
        CKs: null,
        CKr: null,
        Ns: 0,
        Nr: 0,
        PN: 0,
        MKSKIPPED: new Map()
    };
}

function DHRatchet(state: RatchetState, header: MessageHeader): void {
    const receivedPublicKey = decodeBase64(header.publicKey);
    state.PN = state.Ns;
    state.Ns = 0;
    state.Nr = 0;
    state.DHr = receivedPublicKey;

    if (state.DHs) {
        const dhOutput = DH(state.DHs.privateKey, receivedPublicKey);
        const { rootKey: newRootKey, chainKey: receivingChainKey } = KDF_RK(state.RK, dhOutput);
        state.RK = newRootKey;
        state.CKr = receivingChainKey;
    }

    state.DHs = generateDHKeyPair();
    const dhOutput = DH(state.DHs.privateKey, receivedPublicKey);
    const { rootKey: finalRootKey, chainKey: sendingChainKey } = KDF_RK(state.RK, dhOutput);
    state.RK = finalRootKey;
    state.CKs = sendingChainKey;
}

function trySkippedMessageKeys(
    state: RatchetState,
    header: MessageHeader,
    nonce: Uint8Array,
    ciphertext: Uint8Array
): Uint8Array | null {
    const key = `${header.publicKey}-${header.n}`;
    const messageKey = state.MKSKIPPED.get(key);

    if (messageKey) {
        state.MKSKIPPED.delete(key);
        const headerBytes = encodeHeader(header);
        return DECRYPT(messageKey, nonce, ciphertext, headerBytes);
    }

    return null;
}

function skipMessageKeys(state: RatchetState, until: number): void {
    if (!state.CKr) return;

    if (state.Nr + MAX_SKIP < until) {
        throw new Error(`Too many message keys to skip: ${until - state.Nr} > ${MAX_SKIP}`);
    }

    if (state.DHr && state.CKr) {
        while (state.Nr < until) {
            const { messageKey, chainKey } = KDF_CK(state.CKr);
            const key = `${encodeBase64(state.DHr)}-${state.Nr}`;
            state.MKSKIPPED.set(key, messageKey);
            state.CKr = chainKey;
            state.Nr += 1;
        }
    }
}

export function ratchetEncrypt(state: RatchetState, plaintext: string): string {
    if (!state.CKs || !state.DHs) {
        throw new Error('Cannot encrypt: sending chain not initialized');
    }

    const { messageKey, chainKey } = KDF_CK(state.CKs);
    state.CKs = chainKey;

    const header: MessageHeader = {
        publicKey: encodeBase64(state.DHs.publicKey),
        pn: state.PN,
        n: state.Ns
    };

    state.Ns += 1;

    const plaintextBytes = encodeUTF8(plaintext);
    const headerBytes = encodeHeader(header);
    const { nonce, ciphertext } = ENCRYPT(messageKey, plaintextBytes, headerBytes);

    return JSON.stringify({
        header,
        nonce: encodeBase64(nonce),
        ciphertext: encodeBase64(ciphertext)
    });
}

export function ratchetDecrypt(state: RatchetState, encryptedMessage: string): string {
    const message: EncryptedMessage = JSON.parse(encryptedMessage);
    const header = message.header;
    const nonce = decodeBase64(message.nonce);
    const ciphertext = decodeBase64(message.ciphertext);

    const skippedPlaintext = trySkippedMessageKeys(state, header, nonce, ciphertext);
    if (skippedPlaintext) {
        return decodeUTF8(skippedPlaintext);
    }

    const receivedPublicKey = decodeBase64(header.publicKey);
    if (state.DHr === null || encodeBase64(state.DHr) !== header.publicKey) {
        skipMessageKeys(state, header.pn);
        DHRatchet(state, header);
    }

    skipMessageKeys(state, header.n);

    if (!state.CKr) {
        throw new Error('Cannot decrypt: receiving chain not initialized');
    }

    const { messageKey, chainKey } = KDF_CK(state.CKr);
    state.CKr = chainKey;
    state.Nr += 1;

    const headerBytes = encodeHeader(header);
    const plaintext = DECRYPT(messageKey, nonce, ciphertext, headerBytes);

    return decodeUTF8(plaintext);
}

export function serializeState(state: RatchetState): string {
    return JSON.stringify({
        DHs: state.DHs ? {
            privateKey: encodeBase64(state.DHs.privateKey),
            publicKey: encodeBase64(state.DHs.publicKey)
        } : null,
        DHr: state.DHr ? encodeBase64(state.DHr) : null,
        RK: encodeBase64(state.RK),
        CKs: state.CKs ? encodeBase64(state.CKs) : null,
        CKr: state.CKr ? encodeBase64(state.CKr) : null,
        Ns: state.Ns,
        Nr: state.Nr,
        PN: state.PN,
        MKSKIPPED: Array.from(state.MKSKIPPED.entries()).map(([k, v]) => [k, encodeBase64(v)])
    });
}

export function deserializeState(serialized: string): RatchetState {
    const obj = JSON.parse(serialized);
    return {
        DHs: obj.DHs ? {
            privateKey: decodeBase64(obj.DHs.privateKey),
            publicKey: decodeBase64(obj.DHs.publicKey)
        } : null,
        DHr: obj.DHr ? decodeBase64(obj.DHr) : null,
        RK: decodeBase64(obj.RK),
        CKs: obj.CKs ? decodeBase64(obj.CKs) : null,
        CKr: obj.CKr ? decodeBase64(obj.CKr) : null,
        Ns: obj.Ns,
        Nr: obj.Nr,
        PN: obj.PN,
        MKSKIPPED: new Map(obj.MKSKIPPED.map(([k, v]: [string, string]) => [k, decodeBase64(v)]))
    };
}

export function generateSharedSecret(): { sharedSecret: Uint8Array; keyPair: { privateKey: Uint8Array; publicKey: Uint8Array } } {
    const keyPair = generateDHKeyPair();
    const sharedSecret = randomBytes(SHARED_KEY_LENGTH);
    return { sharedSecret, keyPair };
}

export type { RatchetState, MessageHeader, EncryptedMessage } from './types';