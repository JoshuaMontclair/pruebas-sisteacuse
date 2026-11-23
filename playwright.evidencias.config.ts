// Configuración para generar las capturas del documento (evidencias/), aparte
// de la suite de pruebas para que no cuenten como casos.

import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
	...base,
	testDir: 'evidencias',
	reporter: 'list',
	retries: 0,
	outputDir: 'reportes/evidencias-artefactos',
	use: { ...base.use, ...devices['Desktop Chrome'], deviceScaleFactor: 2, screenshot: 'off', trace: 'off', video: 'off' },
	projects: undefined
});
