# Testing Instructions for SecureChat

## The Issue
Users tyt and eic have mismatched cryptographic keys between local storage and the server, causing "authentication tag mismatch" errors during decryption.

## How to Fix & Test

### Option 1: Clean Reset (Recommended)
1. **Stop the app completely**
2. **For EACH user (tyt and eic):**
   - Open the app
   - Click "Clear All Data (Dev)" button
   - Close the app completely
3. **Restart the app**
4. **Re-register BOTH users** with their usernames and passwords
5. **Login with both users** (on separate devices/simulators)
6. **Test messaging** - should work now!

### Option 2: Delete Users from Database (Quick)
1. **Stop the app**
2. **Connect to PostgreSQL:**
   ```bash
   psql -U postgres -d securechat
   ```
3. **Delete the users:**
   ```sql
   DELETE FROM messages WHERE from_username IN ('tyt', 'eic') OR to_username IN ('tyt', 'eic');
   DELETE FROM pre_keys WHERE user_id IN (SELECT id FROM users WHERE username IN ('tyt', 'eic'));
   DELETE FROM users WHERE username IN ('tyt', 'eic');
   ```
4. **Clear app storage** for both users
5. **Re-register** both users

### Option 3: Full Database Reset
```bash
psql -U postgres -d securechat -c "DROP TABLE IF EXISTS messages, pre_keys, users CASCADE;"
```
Then restart the server (it will recreate tables).

## What Was Fixed

1. **`CryptoService.initializeUser()`** - No longer regenerates SPK on login
2. **Login validation** - Now checks if local identity key matches server
3. **Clear data** - Properly clears SPK references

## Common Errors

### "Local keys do not match server"
- Means identity key mismatch
- **Solution**: Clear data and re-register

### "Decryption failed: authentication tag mismatch"
- Means the shared secret derivation used different keys
- **Solution**: Ensure BOTH users re-register with fresh keys

### "No signed pre-key found"
- Means SPK is missing locally
- **Solution**: Re-register the user

## Verification

After fixing, you should see matching values in logs:
```
Alice X3DH] Alice Identity X25519: <value>
[Bob X3DH] Alice Identity X25519: <same value>

[Alice X3DH] Bob Identity X25519: <value>
[Bob X3DH] Bob Identity X25519: <same value>

[Alice X3DH] Shared secret: <value>
[Bob X3DH] Shared secret: <same value>  ✓
```
