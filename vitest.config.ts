import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['packages/**/*.test.ts','apps/web/tests/**/*.test.ts'],coverage:{provider:'v8',include:['packages/domain/src/**/*.ts'],reporter:['text','lcov'],reportsDirectory:'reports/domain'}}});
