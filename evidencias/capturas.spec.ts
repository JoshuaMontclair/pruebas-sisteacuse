// Capturas para el documento de la entrega (no son casos de prueba).
//
//   npx playwright test -c playwright.evidencias.config.ts
//
// Recorren los mismos flujos que las pruebas E2E, con el mismo entorno
// controlado, y guardan imágenes con nombre fijo en reportes/evidencias/.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { HOY, servidorDePagos, test } from '../tests/e2e/entorno';

const SALIDA = process.env.EVIDENCIAS_DIR ?? 'reportes/evidencias';

// Solo en las capturas: sin el aviso de cookies ni el botón flotante de WhatsApp,
// que tapan el contenido.
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		document.addEventListener('DOMContentLoaded', () => {
			const estilo = document.createElement('style');
			estilo.textContent = '.cc-banner, .cc-dialog, *:has(> .wa-etiqueta) { display: none !important; }';
			document.head.appendChild(estilo);
		});
	});
});
const ruta = (nombre: string) => `${SALIDA}/${nombre}.png`;

async function paso1(page: Page, acepta = true) {
	await page.clock.setFixedTime(HOY);
	await page.goto('/registro?plan=Plan%20Pyme');
	await page.locator('#firstName').fill('Ana');
	await page.locator('#lastName').fill('Prueba');
	await page.locator('#reg-email').fill('ana@prueba.local');
	await page.locator('#phone').fill('+57 300 123 4567');
	if (acepta) await page.getByRole('checkbox', { name: /Acepto los términos/ }).check();
	await page.getByRole('button', { name: 'Continuar al pago' }).click();
}

test('registro: error por no aceptar términos', async ({ page, backend: _ }) => {
	await paso1(page, false);
	const error = page.getByText('Debes aceptar los términos');
	await error.scrollIntoViewIfNeeded();
	await page.screenshot({ path: ruta('registro-error-terminos') });
});

test('registro: cupón aplicado', async ({ page, backend }) => {
	backend.prepararPago = servidorDePagos({ PROMO10: 10 });
	await paso1(page);
	await page.getByRole('button', { name: 'Tengo un cupón de descuento' }).click();
	await page.getByLabel('Código de cupón').fill('promo10');
	await page.getByRole('button', { name: 'Aplicar' }).click();
	await page.getByRole('button', { name: 'Pagar $180.000' }).waitFor();
	await page.screenshot({ path: ruta('registro-cupon-aplicado'), fullPage: true });
});

test('registro: cupón rechazado', async ({ page, backend }) => {
	backend.prepararPago = servidorDePagos({ PROMO10: 10 });
	await paso1(page);
	await page.getByRole('button', { name: 'Tengo un cupón de descuento' }).click();
	await page.getByLabel('Código de cupón').fill('VENCIDO');
	await page.getByRole('button', { name: 'Aplicar' }).click();
	await page.getByText('Cupón inválido o vencido.').waitFor();
	await page.screenshot({ path: ruta('registro-cupon-rechazado') });
});

test('registro: pago rechazado por Wompi', async ({ page, backend }) => {
	backend.resultadoWompi = 'DECLINED';
	await paso1(page);
	await page.getByRole('button', { name: 'Pagar $200.000' }).click();
	await page.getByText('El pago fue rechazado.').waitFor();
	await page.screenshot({ path: ruta('registro-pago-rechazado') });
});

test('registro: pago aprobado llega a /gracias', async ({ page, backend }) => {
	await paso1(page);
	await page.getByRole('button', { name: 'Pagar $200.000' }).click();
	await page.waitForURL(/\/gracias/);
	await page.waitForLoadState('networkidle');
	await page.screenshot({ path: ruta('registro-gracias') });
});

for (const [nombre, instante] of [
	['planes-antes-del-corte', '2026-10-31T23:59:00-05:00'],
	['planes-despues-del-corte', '2026-11-01T00:00:30-05:00']
]) {
	test(`planes: ${nombre}`, async ({ page, backend: _ }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.clock.setFixedTime(new Date(instante));
		await page.goto('/planes');
		// La rejilla de tarjetas: el ancestro más cercano que contiene el Pyme y el Max.
		const rejilla = page
			.getByRole('heading', { name: 'Plan Pyme', exact: true })
			.locator('xpath=ancestor::*[.//*[normalize-space()="Plan Contador Max"]][1]');
		await rejilla.scrollIntoViewIfNeeded();
		await rejilla.screenshot({ path: ruta(nombre) });
	});
}

test.describe('móvil', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
	test('registro en iPhone: paso de pago', async ({ page, backend: _ }) => {
		await paso1(page);
		await page.getByRole('heading', { name: 'Confirma y paga.' }).waitFor();
		await page.screenshot({ path: ruta('registro-iphone-pago') });
	});
});

for (const [nombre, archivo] of [
	['reporte-playwright', 'reportes/e2e/index.html'],
	['reporte-cobertura', 'reportes/cobertura/index.html'],
	['reporte-stryker', 'reportes/mutacion/index.html']
]) {
	test(`reporte: ${nombre}`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 860 });
		await page.goto(pathToFileURL(resolve(archivo)).href);
		await page.waitForLoadState('networkidle');
		await page.screenshot({ path: ruta(nombre) });
	});
}

