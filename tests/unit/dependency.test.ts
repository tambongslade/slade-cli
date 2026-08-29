import { describe, expect, it } from '@jest/globals';
import * as path from 'path';
import {
  compareVersions,
  getNestProjectExecution,
  isNewerVersion,
} from '../../src/utils/dependency.utils';

describe('Dependency Utils', () => {
  describe('semantic version comparison', () => {
    it('does not treat an older registry version as an update', () => {
      expect(isNewerVersion('3.2.1', '3.2.2')).toBe(false);
      expect(compareVersions('3.2.1', '3.2.2')).toBeLessThan(0);
    });

    it('compares numeric version parts instead of lexicographic strings', () => {
      expect(isNewerVersion('3.2.10', '3.2.2')).toBe(true);
      expect(compareVersions('3.2.10', '3.2.2')).toBeGreaterThan(0);
    });

    it('treats a stable release as newer than the matching prerelease', () => {
      expect(isNewerVersion('3.2.2', '3.2.2-beta.1')).toBe(true);
      expect(isNewerVersion('3.2.2-beta.1', '3.2.2')).toBe(false);
    });
  });

  it('runs Nest from the requested parent with a relative target directory', () => {
    const targetDirectory = path.join('tmp', 'ddd-projects', 'joona-pay-cli-smoke');
    const execution = getNestProjectExecution('JoonaPayCliSmoke', {
      directory: targetDirectory,
      skipInstall: true,
    });

    expect(execution.cwd).toBe(path.dirname(path.resolve(targetDirectory)));
    expect(execution.args).toContain('joona-pay-cli-smoke');
    expect(execution.args).not.toContain(path.resolve(targetDirectory));
    expect(execution.args).toContain('--skip-install');
  });
});
