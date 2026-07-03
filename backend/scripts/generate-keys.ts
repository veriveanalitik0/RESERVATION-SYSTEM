/**
 * RSA Key Pair Generator
 *
 * User ve Admin JWT'leri için ayrı RSA 4096-bit key pair üretir.
 * app_security.md §4: HS256 yasak, sadece RS256/ES256 kullanılabilir.
 * data_security.md §1: Secret'lar koda gömülmez, runtime'da yüklenir.
 *
 * Kullanım: npm run keys:generate
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const KEYS_DIR = resolve(__dirname, '..', 'keys');

interface KeyPairTarget {
  name: string;
  privatePath: string;
  publicPath: string;
}

const targets: KeyPairTarget[] = [
  {
    name: 'USER',
    privatePath: resolve(KEYS_DIR, 'user_private.pem'),
    publicPath: resolve(KEYS_DIR, 'user_public.pem'),
  },
  {
    name: 'ADMIN',
    privatePath: resolve(KEYS_DIR, 'admin_private.pem'),
    publicPath: resolve(KEYS_DIR, 'admin_public.pem'),
  },
];

function ensureDirectory(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function generateRsaPair(target: KeyPairTarget): void {
  if (existsSync(target.privatePath) && existsSync(target.publicPath)) {
    console.log(`[${target.name}] Anahtar çifti zaten mevcut, atlanıyor.`);
    return;
  }

  console.log(`[${target.name}] RSA 4096-bit anahtar çifti üretiliyor...`);

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  ensureDirectory(target.privatePath);
  ensureDirectory(target.publicPath);

  writeFileSync(target.privatePath, privateKey, { mode: 0o600 });
  writeFileSync(target.publicPath, publicKey, { mode: 0o644 });

  chmodSync(target.privatePath, 0o600);

  console.log(`[${target.name}] OK -> ${target.privatePath}`);
  console.log(`[${target.name}] OK -> ${target.publicPath}`);
}

function main(): void {
  console.log('==============================================');
  console.log('  Kuveyt Türk AI Lab - JWT Key Generator');
  console.log('==============================================\n');

  for (const target of targets) {
    generateRsaPair(target);
  }

  console.log('\nTüm anahtarlar hazır.');
  console.log('UYARI: keys/ dizini .gitignore içinde — commit ETMEYİN.');
}

main();
