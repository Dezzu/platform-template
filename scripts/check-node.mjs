/**
 * Refuses to go further on the wrong Node.
 *
 * `.nvmrc` says 24 and `engines.node` says >=24, but neither is enforced where it
 * matters. `engine-strict` only applies while installing dependencies — `pnpm run`
 * ignores it — so a shell whose default is Node 22, which is the normal case on a
 * machine with nvm and no `nvm use`, runs every script in this repo anyway and fails
 * later, somewhere unrelated, with an error about something else entirely.
 *
 * Runs first in `pnpm verify` so the answer arrives in a second rather than eight
 * minutes in.
 */
import { readFileSync } from 'node:fs';
import { exit, version, versions } from 'node:process';

const REQUIRED_MAJOR = Number(readFileSync('.nvmrc', 'utf8').trim());

if (!Number.isInteger(REQUIRED_MAJOR)) {
  console.error('could not read a major version out of .nvmrc');
  exit(1);
}

const major = Number(versions.node.split('.')[0]);

if (major < REQUIRED_MAJOR) {
  console.error(
    [
      '',
      `This repository needs Node ${REQUIRED_MAJOR}; this shell is running ${version}.`,
      '',
      '  nvm use                     # reads .nvmrc',
      '',
      '  # or, in a non-interactive shell:',
      `  export PATH="$HOME/.nvm/versions/node/v${REQUIRED_MAJOR}.<minor>.<patch>/bin:$PATH"`,
      '',
    ].join('\n'),
  );
  exit(1);
}

console.warn(`node: ${version} (>= ${REQUIRED_MAJOR} required)`);
