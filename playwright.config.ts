import { defineConfig, devices } from '@playwright/test';

const PUERTO = 4173;

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	// Sin reintentos: una prueba inestable debe fallar y verse, no pasar al segundo intento.
	retries: 0,
	reporter: [
		['list'],
		['html', { outputFolder: 'reportes/e2e', open: 'never' }],
		['junit', { outputFile: 'reportes/e2e/junit.xml' }]
	],
	outputDir: 'reportes/e2e-artefactos',
	use: {
		baseURL: `http://localhost:${PUERTO}`,
		locale: 'es-CO',
		timezoneId: 'America/Bogota',
		screenshot: 'on',
		trace: 'retain-on-failure',
		video: 'retain-on-failure'
	},
	projects: [
		{ name: 'escritorio-chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'movil-iphone', use: { ...devices['iPhone 13'] } }
	],
	webServer: {
		command: `node scripts/servir-sitio.mjs ${PUERTO}`,
		url: `http://localhost:${PUERTO}/planes`,
		reuseExistingServer: !process.env.CI
	}
});
