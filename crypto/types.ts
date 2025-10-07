// crypto/types.ts
export interface RatchetState {
    DHs: { privateKey: Uint8Array; publicKey: Uint8Array } | null;
    DHr: Uint8Array | null;
    RK: Uint8Array;
    CKs: Uint8Array | null;
    CKr: Uint8Array | null;
    Ns: number;
    Nr: number;
    PN: number;
    MKSKIPPED: Map<string, Uint8Array>;
}

export interface MessageHeader {
    publicKey: string;
    pn: number;
    n: number;
}

export interface EncryptedMessage {
    header: MessageHeader;
    nonce: string;
    ciphertext: string;
}

export interface IdentityKeyPair {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
}

export interface SignedPreKey {
    keyId: number;
    keyPair: { privateKey: Uint8Array; publicKey: Uint8Array };
    signature: Uint8Array;
    timestamp: number;
}

export interface PreKeyBundle {
    identityKey: string;
    signedPreKey: string;
    signedPreKeySignature: string;
    signedPreKeyId: number;
    oneTimePreKey?: string;
    oneTimePreKeyId?: number;
}