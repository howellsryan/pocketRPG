import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      // Full denominator: every shipped source file, not just the ones a test
      // imports — so the report shows real gaps (see docs/testing-strategy-review.md).
      include: ['src/**', 'functions/**'],
      exclude: ['src/assets/**', 'src/data/**', '**/vendor/**', '**/*.d.ts'],
      // 'json' (per-line) drives scripts/check-diff-coverage.cjs; 'json-summary'
      // drives scripts/check-coverage-ratchet.cjs; 'text-summary' prints in CI.
      reporter: ['text-summary', 'json', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
})
