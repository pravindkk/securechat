// crypto/x3dh.ts
import { randomBytes } from '@stablelib/random';
import { sign, verify, generateKeyPair as ed25519GenerateKeyPair, convertPublicKeyToX25519, convertSecretKeyToX25519 } from '@stablelib/ed25519';
import { sharedKey } from '@stablelib/x25519';
import { HKDF } from '@stablelib/hkdf';
import { SHA256 } from '@stablelib/sha256';
import { encode as encodeBase64, decode as decodeBase64 } from '@stablelib/base64';
import { encode as encodeUTF8 } from '@stablelib/utf8';
import { generateDHKeyPair } from './doubleRatchet';
import { IdentityKeyPair, SignedPreKey, PreKeyBundle } from './types';

export function generateIdentityKeyPair(): IdentityKeyPair {
    // Use Ed25519 for identity keys (for signatures)
    const keyPair = ed25519GenerateKeyPair();
    return {
        privateKey: keyPair.secretKey,
        publicKey: keyPair.publicKey
    };
}

export function generateSignedPreKey(identityPrivateKey: Uint8Array, keyId: number): SignedPreKey {
    const keyPair = generateDHKeyPair();
    // Sign with Ed25519
    const signature = sign(identityPrivateKey, keyPair.publicKey);

    return {
        keyId,
        keyPair,
        signature,
        timestamp: Date.now()
    };
}

export function generateOneTimePreKeys(count: number): Array<{ keyId: number; keyPair: { privateKey: Uint8Array; publicKey: Uint8Array } }> {
    const keys = [];
    for (let i = 0; i < count; i++) {
        keys.push({
            keyId: i,
            keyPair: generateDHKeyPair()
        });
    }
    return keys;
}

export function verifySignedPreKey(
    identityPublicKey: Uint8Array,
    signedPreKeyPublic: Uint8Array,
    signature: Uint8Array
): boolean {
    // Verify Ed25519 signature
    return verify(identityPublicKey, signedPreKeyPublic, signature);
}

export function x3dhInitiatorSharedSecret(
    identityKeyPair: IdentityKeyPair,
    ephemeralKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array },
    recipientIdentityKey: Uint8Array,
    recipientSignedPreKey: Uint8Array,
    recipientOneTimePreKey?: Uint8Array
): Uint8Array {
    // Convert Ed25519 identity keys to X25519 for DH
    const aliceIdentityX25519 = convertSecretKeyToX25519(identityKeyPair.privateKey);
    const bobIdentityX25519 = convertPublicKeyToX25519(recipientIdentityKey);

    console.log('[Alice X3DH] Alice Identity X25519:', encodeBase64(aliceIdentityX25519));
    console.log('[Alice X3DH] Bob Identity X25519:', encodeBase64(bobIdentityX25519));
    console.log('[Alice X3DH] Alice Ephemeral Public:', encodeBase64(ephemeralKeyPair.publicKey));
    console.log('[Alice X3DH] Bob SPK Public:', encodeBase64(recipientSignedPreKey));

    // DH1 = DH(IKa, SPKb) - Alice's identity key with Bob's signed prekey
    const dh1 = sharedKey(aliceIdentityX25519, recipientSignedPreKey);
    console.log('[Alice X3DH] DH1:', encodeBase64(dh1));

    // DH2 = DH(EKa, IKb) - Alice's ephemeral key with Bob's identity key
    const dh2 = sharedKey(ephemeralKeyPair.privateKey, bobIdentityX25519);
    console.log('[Alice X3DH] DH2:', encodeBase64(dh2));

    // DH3 = DH(EKa, SPKb) - Alice's ephemeral key with Bob's signed prekey
    const dh3 = sharedKey(ephemeralKeyPair.privateKey, recipientSignedPreKey);
    console.log('[Alice X3DH] DH3:', encodeBase64(dh3));

    let dhResult: Uint8Array;

    if (recipientOneTimePreKey) {
        // DH4 = DH(EKa, OPKb) - Alice's ephemeral key with Bob's one-time prekey
        const dh4 = sharedKey(ephemeralKeyPair.privateKey, recipientOneTimePreKey);
        dhResult = new Uint8Array([...dh1, ...dh2, ...dh3, ...dh4]);
    } else {
        dhResult = new Uint8Array([...dh1, ...dh2, ...dh3]);
    }

    const hkdf = new HKDF(SHA256, dhResult, new Uint8Array(32), encodeUTF8('X3DH'));
    return hkdf.expand(32);
}

export function x3dhResponderSharedSecret(
    identityKeyPair: IdentityKeyPair,
    signedPreKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array },
    oneTimePreKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array } | null,
    initiatorIdentityKey: Uint8Array,
    initiatorEphemeralKey: Uint8Array
): Uint8Array {
    // Convert Ed25519 identity keys to X25519 for DH
    const bobIdentityX25519 = convertSecretKeyToX25519(identityKeyPair.privateKey);
    const aliceIdentityX25519 = convertPublicKeyToX25519(initiatorIdentityKey);

    console.log('[Bob X3DH] Bob Identity X25519:', encodeBase64(bobIdentityX25519));
    console.log('[Bob X3DH] Alice Identity X25519:', encodeBase64(aliceIdentityX25519));
    console.log('[Bob X3DH] Alice Ephemeral Public:', encodeBase64(initiatorEphemeralKey));
    console.log('[Bob X3DH] Bob SPK Public:', encodeBase64(signedPreKeyPair.publicKey));

    // DH1 = DH(SPKb, IKa) - Bob's signed prekey with Alice's identity key
    const dh1 = sharedKey(signedPreKeyPair.privateKey, aliceIdentityX25519);
    console.log('[Bob X3DH] DH1:', encodeBase64(dh1));

    // DH2 = DH(IKb, EKa) - Bob's identity key with Alice's ephemeral key
    const dh2 = sharedKey(bobIdentityX25519, initiatorEphemeralKey);
    console.log('[Bob X3DH] DH2:', encodeBase64(dh2));

    // DH3 = DH(SPKb, EKa) - Bob's signed prekey with Alice's ephemeral key
    const dh3 = sharedKey(signedPreKeyPair.privateKey, initiatorEphemeralKey);
    console.log('[Bob X3DH] DH3:', encodeBase64(dh3));

    let dhResult: Uint8Array;

    if (oneTimePreKeyPair) {
        // DH4 = DH(OPKb, EKa) - Bob's one-time prekey with Alice's ephemeral key
        const dh4 = sharedKey(oneTimePreKeyPair.privateKey, initiatorEphemeralKey);
        dhResult = new Uint8Array([...dh1, ...dh2, ...dh3, ...dh4]);
    } else {
        dhResult = new Uint8Array([...dh1, ...dh2, ...dh3]);
    }

    const hkdf = new HKDF(SHA256, dhResult, new Uint8Array(32), encodeUTF8('X3DH'));
    return hkdf.expand(32);
}

export function createPreKeyBundle(
    identityKey: Uint8Array,
    signedPreKey: SignedPreKey,
    oneTimePreKey?: { keyId: number; keyPair: { privateKey: Uint8Array; publicKey: Uint8Array } }
): PreKeyBundle {
    return {
        identityKey: encodeBase64(identityKey),
        signedPreKey: encodeBase64(signedPreKey.keyPair.publicKey),
        signedPreKeySignature: encodeBase64(signedPreKey.signature),
        signedPreKeyId: signedPreKey.keyId,
        oneTimePreKey: oneTimePreKey ? encodeBase64(oneTimePreKey.keyPair.publicKey) : undefined,
        oneTimePreKeyId: oneTimePreKey?.keyId
    };
}