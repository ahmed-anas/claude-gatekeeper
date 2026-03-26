import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/home/testuser'),
}));
jest.mock('../../src/status', () => ({
  getHookStatus: jest.fn(() => ({ permissionRequest: false, preToolUse: false })),
}));

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;

import { setEnabled } from '../../src/enable';
import { getHookStatus } from '../../src/status';
import { homedir } from 'os';

const mockHomedir = homedir as jest.MockedFunction<typeof homedir>;
const mockGetHookStatus = getHookStatus as jest.MockedFunction<typeof getHookStatus>;

let consoleOutput: string[];

beforeEach(() => {
  jest.clearAllMocks();
  mockHomedir.mockReturnValue('/home/testuser');
  consoleOutput = [];
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('setEnabled', () => {
  it('writes enabled:false when currently enabled', () => {
    // loadConfig reads config -> returns enabled:true (default)
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes('config.json')) {
        return JSON.stringify({ enabled: true });
      }
      throw new Error('ENOENT');
    });
    mockExistsSync.mockReturnValue(true);

    setEnabled(false);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      expect.stringContaining('"enabled": false')
    );
    expect(consoleOutput.some((l) => l.includes('disabled'))).toBe(true);
  });

  it('writes enabled:true when currently disabled', () => {
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes('config.json')) {
        return JSON.stringify({ enabled: false });
      }
      throw new Error('ENOENT');
    });
    mockExistsSync.mockReturnValue(true);
    mockGetHookStatus.mockReturnValue({ permissionRequest: true, preToolUse: true });

    setEnabled(true);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      expect.stringContaining('"enabled": true')
    );
    expect(consoleOutput.some((l) => l.includes('enabled'))).toBe(true);
  });

  it('prints "already enabled" when already enabled', () => {
    // Default config has enabled: true
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes('config.json')) {
        return JSON.stringify({ enabled: true });
      }
      throw new Error('ENOENT');
    });

    setEnabled(true);

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(consoleOutput.some((l) => l.toLowerCase().includes('already enabled'))).toBe(true);
  });

  it('prints "already disabled" when already disabled', () => {
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes('config.json')) {
        return JSON.stringify({ enabled: false });
      }
      throw new Error('ENOENT');
    });

    setEnabled(false);

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(consoleOutput.some((l) => l.toLowerCase().includes('already disabled'))).toBe(true);
  });

  it('creates config with enabled:false when no config exists', () => {
    // No config file -> loadConfig returns defaults (enabled: true)
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    mockExistsSync.mockReturnValue(false);

    setEnabled(false);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      expect.stringContaining('"enabled": false')
    );
  });

  it('prints warning about setup when enabling with no hooks registered', () => {
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes('config.json')) {
        return JSON.stringify({ enabled: false });
      }
      throw new Error('ENOENT');
    });
    mockExistsSync.mockReturnValue(true);
    mockGetHookStatus.mockReturnValue({ permissionRequest: false, preToolUse: false });

    setEnabled(true);

    expect(consoleOutput.some((l) => l.includes('setup'))).toBe(true);
  });
});
