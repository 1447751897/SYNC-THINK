import { describe, expect, it } from 'vitest';
import { MacKeychainBackend, type KeychainCommandRunner } from './macos-keychain-backend.js';

function fixture() {
  const values = new Map<string, string>();
  const runner: KeychainCommandRunner = async (args) => {
    const account = args[args.indexOf('-a') + 1];
    if (args[0] === 'add-generic-password') {
      values.set(account!, args[args.indexOf('-w') + 1]!);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'find-generic-password') {
      const value = values.get(account!);
      return value === undefined
        ? { code: 44, stdout: '', stderr: 'SecKeychainSearchCopyNext: could not be found' }
        : { code: 0, stdout: `${value}\n`, stderr: '' };
    }
    values.delete(account!);
    return { code: 0, stdout: '', stderr: '' };
  };
  return { backend: new MacKeychainBackend(runner), values };
}

describe('MacKeychainBackend', () => {
  it('stores, retrieves, and removes a secret through security-compatible commands', async () => {
    const { backend, values } = fixture();
    const handle = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    await backend.store(handle, 'secret');
    await expect(backend.retrieve(handle)).resolves.toBe('secret');
    await backend.remove(handle);
    expect(values).toHaveLength(0);
  });

  it('maps a missing item to SECRET_NOT_FOUND', async () => {
    const { backend } = fixture();
    await expect(backend.retrieve('01ARZ3NDEKTSV4RRFFQ69G5FAV')).rejects.toMatchObject({
      code: 'SECRET_NOT_FOUND',
    });
  });
});
