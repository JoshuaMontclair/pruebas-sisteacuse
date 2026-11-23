import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/unit/**/*.test.ts'],
		reporters: ['default', 'junit', 'html'],
		outputFile: {
			junit: 'reportes/unitarias/junit.xml',
			html: 'reportes/unitarias/index.html'
		},
		coverage: {
			provider: 'v8',
			include: ['sut/**/*.ts'],
			reporter: ['text', 'html', 'json-summary'],
			reportsDirectory: 'reportes/cobertura'
		}
	}
});
