// Test X3DH key exchange
import { generateIdentityKeyPair, generateSignedPreKey, x3dhInitiatorSharedSecret, x3dhResponderSharedSecret, verifySignedPreKey } from './x3dh';
import { generateDHKeyPair } from './doubleRatchet';
import { encode as encodeBase64 } from '@stablelib/base64';
import { equal } from '@stablelib/constant-time';

console.log('🧪 Testing X3DH Key Exchange...\n');

// Alice (initiator) setup
console.log('1️⃣ Alice generates her identity key...');
const aliceIdentity = generateIdentityKeyPair();
console.log('   ✅ Alice identity key generated');

// Bob (responder) setup
console.log('2️⃣ Bob generates his identity key and signed pre-key...');
const bobIdentity = generateIdentityKeyPair();
const bobSignedPreKey = generateSignedPreKey(bobIdentity.privateKey, Date.now());
console.log('   ✅ Bob identity key generated');
console.log('   ✅ Bob signed pre-key generated');

// Verify Bob's signed pre-key
console.log('3️⃣ Alice verifies Bob\'s signed pre-key signature...');
const signatureValid = verifySignedPreKey(
    bobIdentity.publicKey,
    bobSignedPreKey.keyPair.publicKey,
    bobSignedPreKey.signature
);
console.log('   ✅ Signature valid:', signatureValid);

if (!signatureValid) {
    console.error('   ❌ FAILED: Signature verification failed!');
    process.exit(1);
}

// Alice initiates key exchange
console.log('4️⃣ Alice generates ephemeral key and computes shared secret...');
const aliceEphemeral = generateDHKeyPair();
const aliceSharedSecret = x3dhInitiatorSharedSecret(
    aliceIdentity,
    aliceEphemeral,
    bobIdentity.publicKey,
    bobSignedPreKey.keyPair.publicKey,
    undefined // No one-time pre-key
);
console.log('   ✅ Alice computed shared secret:', encodeBase64(aliceSharedSecret));

// Bob responds to key exchange
console.log('5️⃣ Bob computes shared secret using Alice\'s ephemeral key...');
const bobSharedSecret = x3dhResponderSharedSecret(
    bobIdentity,
    bobSignedPreKey.keyPair,
    null, // No one-time pre-key
    aliceIdentity.publicKey,
    aliceEphemeral.publicKey
);
console.log('   ✅ Bob computed shared secret:', encodeBase64(bobSharedSecret));

// Compare shared secrets
console.log('6️⃣ Comparing shared secrets...');
const secretsMatch = equal(aliceSharedSecret, bobSharedSecret);

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
