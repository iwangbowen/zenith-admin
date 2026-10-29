import { execFileSync } from 'node:child_process';
import { workspaceRoot } from './test-graph.mjs';

/** Read committed, staged, unstaged and untracked paths. Rename endpoints both count as changes. */
export function collectChangedFiles({ base, root = workspaceRoot, git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) } = {}) {
  try {
    const reference = base ?? git(['merge-base', 'HEAD', 'origin/master']).trim();
    const commit = git(['rev-parse', '--verify', '--end-of-options', `${reference}^{commit}`]).trim();
    const split = (value) => value.split('\0').filter(Boolean);
    return {
      base: commit,
      files: [...new Set([
        ...split(git(['diff', '--no-renames', '--name-only', '-z', `${commit}...HEAD`])),
        ...split(git(['diff', '--no-renames', '--name-only', '-z', 'HEAD'])),
        ...split(git(['ls-files', '--others', '--exclude-standard', '-z'])),
      ])].sort(),
      uncertainDiff: false,
    };
  } catch (error) {
    return { base: base ?? null, files: [], uncertainDiff: true, error: error.message.split('\n')[0] };
  }
}
