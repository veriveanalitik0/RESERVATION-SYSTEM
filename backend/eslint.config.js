// Backend ESLint — odak: PROMISE GÜVENLİĞİ.
//
// Bu repo'daki en ciddi bug ailesi await edilmeyen async çağrılardı (sunucu
// çökmesi + sahte başarı yanıtları). Type-aware `no-floating-promises` bu
// sınıfı derleme zamanında yakalar. Bilinçli fire-and-forget için `void fn()`.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // tests/ tsconfig projesinde değil — tip-bilinçli kurallar yalnız src/'de;
  // testleri vitest + tsc zaten doğruluyor.
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'tests/**', 'scripts/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Asıl hedef: kaçan promise'ler. `void` öneki bilinçli fire-and-forget'i işaretler.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      // Gürültüyü düşük tut — tip hijyeni zaten iyi (3 any), uyarı yeterli.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
