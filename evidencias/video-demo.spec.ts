// Video de respaldo para la demostración en vivo: registro con cupón y pago
// aprobado, despacio para que se pueda seguir en la presentación.
//
//   npx playwright test -c playwright.evidencias.config.ts video-demo

import { HOY, servidorDePagos, test } from '../tests/e2e/entorno';

test.use({
	video: { mode: 'on', size: { width: 1280, height: 720 } },
	viewport: { width: 1280, height: 720 },
	deviceScaleFactor: 1,
	launchOptions: { slowMo: 350 }
});

test('demo: registro con cupón y pago aprobado', async ({ page, backend }) => {
	backend.prepararPago = servidorDePagos({ PROMO10: 10 });
	await page.clock.setFixedTime(HOY);
	await page.goto('/registro?plan=Plan%20Pyme');
	await page.getByLabel('Nombre', { exact: true }).pressSequentially('Ana', { delay: 80 });
	await page.getByLabel('Apellido', { exact: true }).pressSequentially('Prueba', { delay: 80 });
	await page.getByLabel('Correo electrónico', { exact: true }).pressSequentially('ana@prueba.local', { delay: 40 });
	await page.getByLabel('Celular', { exact: true }).pressSequentially('300 123 4567', { delay: 60 });
	await page.getByRole('checkbox', { name: /Acepto los términos/ }).check();
	await page.getByRole('button', { name: 'Continuar al pago' }).click();
	await page.getByRole('button', { name: 'Tengo un cupón de descuento' }).click();
	await page.getByLabel('Código de cupón').pressSequentially('promo10', { delay: 120 });
	await page.getByRole('button', { name: 'Aplicar' }).click();
	await page.getByRole('button', { name: 'Pagar $180.000' }).click();
	await page.waitForURL(/\/gracias/);
	await page.waitForTimeout(2500);
});
