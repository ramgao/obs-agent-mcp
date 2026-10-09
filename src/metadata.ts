import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string; repository: { url: string } };
export const VERSION = manifest.version;
const repositoryURL = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const filename = `${manifest.name.replace('@', '').replace('/', '-')}-${VERSION}.tgz`;
export const RELEASE_PACKAGE = `${repositoryURL}/releases/download/v${VERSION}/${filename}`;
