// Test X3DH key exchange (Node.js version)
import { randomBytes } from 'crypto';
import { sign, verify, generateKeyPair as ed25519GenerateKeyPair, convertPublicKeyToX25519, convertSecretKeyToX25519 } from '@stablelib/ed25519';
import { sharedKey, scalarMultBase, SECRET_KEY_LENGTH } from '@stablelib/x25519';
import { HKDF } from '@stablelib/hkdf';
import { SHA256 } from '@stablelib/sha256';
import { encode as encodeBase64 } from '@stablelib/base64';
import { encode as encodeUTF8 } from '@stablelib/utf8';

// Use crypto.getRandomValues polyfill for Node.js
if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = {
        getRandomValues: (arr) => {
            const bytes = randomBytes(arr.length);
            arr.set(bytes);
            return arr;
        }
    };
}

console.log('🧪 Testing X3DH Key Exchange...\n');

// Alice (initiator) setup
console.log('1️⃣ Alice generates her identity key...');
const aliceIdentity = ed25519GenerateKeyPair();
console.log('   ✅ Alice identity key generated');

// Bob (responder) setup
console.log('2️⃣ Bob generates his identity key and signed pre-key...');
const bobIdentity = ed25519GenerateKeyPair();

// Bob generates signed pre-key (X25519)
const bobSPKPrivate = new Uint8Array(SECRET_KEY_LENGTH);
globalThis.crypto.getRandomValues(bobSPKPrivate);
const bobSPKPublic = scalarMultBase(bobSPKPrivate);

// Bob signs his pre-key with his Ed25519 identity key
const bobSPKSignature = sign(bobIdentity.secretKey, bobSPKPublic);
console.log('   ✅ Bob identity key generated');
console.log('   ✅ Bob signed pre-key generated');

// Verify Bob's signed pre-key
console.log('3️⃣ Alice verifies Bob\'s signed pre-key signature...');
const signatureValid = verify(bobIdentity.publicKey, bobSPKPublic, bobSPKSignature);
console.log('   ✅ Signature valid:', signatureValid);

if (!signatureValid) {
    console.error('   ❌ FAILED: Signature verification failed!');
    process.exit(1);
}

// Alice generates ephemeral key
console.log('4️⃣ Alice generates ephemeral key and computes shared secret...');
const aliceEphemeralPrivate = new Uint8Array(SECRET_KEY_LENGTH);
globalThis.crypto.getRandomValues(aliceEphemeralPrivate);
const aliceEphemeralPublic = scalarMultBase(aliceEphemeralPrivate);

// Convert Ed25519 identity keys to X25519 for DH
const aliceIdentityX25519 = convertSecretKeyToX25519(aliceIdentity.secretKey);
const bobIdentityX25519Public = convertPublicKeyToX25519(bobIdentity.publicKey);

// Alice computes shared secret
// DH1 = DH(IKa, SPKb)
const dh1_alice = sharedKey(aliceIdentityX25519, bobSPKPublic);
// DH2 = DH(EKa, IKb)
const dh2_alice = sharedKey(aliceEphemeralPrivate, bobIdentityX25519Public);
// DH3 = DH(EKa, SPKb)
const dh3_alice = sharedKey(aliceEphemeralPrivate, bobSPKPublic);

const dhResult_alice = new Uint8Array([...dh1_alice, ...dh2_alice, ...dh3_alice]);
const hkdf_alice = new HKDF(SHA256, dhResult_alice, new Uint8Array(32), encodeUTF8('X3DH'));
const aliceSharedSecret = hkdf_alice.expand(32);

console.log('   ✅ Alice computed shared secret:', encodeBase64(aliceSharedSecret));

// Bob responds to key exchange
console.log('5️⃣ Bob computes shared secret using Alice\'s ephemeral key...');

// Convert Ed25519 identity keys to X25519 for DH
const bobIdentityX25519 = convertSecretKeyToX25519(bobIdentity.secretKey);
const aliceIdentityX25519Public = convertPublicKeyToX25519(aliceIdentity.publicKey);

// Bob computes shared secret
// DH1 = DH(SPKb, IKa)
const dh1_bob = sharedKey(bobSPKPrivate, aliceIdentityX25519Public);
// DH2 = DH(IKb, EKa)
const dh2_bob = sharedKey(bobIdentityX25519, aliceEphemeralPublic);
// DH3 = DH(SPKb, EKa)
const dh3_bob = sharedKey(bobSPKPrivate, aliceEphemeralPublic);

const dhResult_bob = new Uint8Array([...dh1_bob, ...dh2_bob, ...dh3_bob]);
const hkdf_bob = new HKDF(SHA256, dhResult_bob, new Uint8Array(32), encodeUTF8('X3DH'));
const bobSharedSecret = hkdf_bob.expand(32);

console.log('   ✅ Bob computed shared secret:', encodeBase64(bobSharedSecret));

// Compare shared secrets
console.log('6️⃣ Comparing shared secrets...');
const secretsMatch = aliceSharedSecret.every((byte, i) => byte === bobSharedSecret[i]);

if (secretsMatch) {
    console.log('   ✅ SUCCESS: Shared secrets match!');
    console.log('\n✨ X3DH key exchange works correctly!\n');
    process.exit(0);
} else {
    console.error('   ❌ FAILED: Shared secrets DO NOT match!');
    console.error('   Alice:', encodeBase64(aliceSharedSecret));
    console.error('   Bob:  ', encodeBase64(bobSharedSecret));
    process.exit(1);
}
