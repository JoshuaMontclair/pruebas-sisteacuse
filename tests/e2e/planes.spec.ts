// F3 en la interfaz · /planes muestra exactamente lo que el servidor cobra
//
// Prueba de consistencia entre niveles: los precios esperados NO se escriben a
// mano, salen del cotizador del servidor (sut/sitio-pagos/pagos.ts, el mismo
// módulo de las pruebas unitarias de F3). Si alguien cambia un precio en el
// servidor y no en el sitio (o al revés), esta prueba falla.
//
// Valores límite sobre la fecha de corte de precios (1-nov-2026 00:00, hora
// de Colombia), controlando el reloj del navegador.

import { expect, rechazarCookies, test } from './entorno';
import { CATALOGO_BASE_2026, CATALOGO_NOV_2026, type Catalogo } from '../../sut/sitio-pagos/pagos';

const pesos = (n: number) => '$' + n.toLocaleString('es-CO');

const ESCENARIOS: [string, string, string, Catalogo, boolean][] = [
	['CP-F3-E01', 'VL · 31-oct 23:59 (un minuto antes del corte)', '2026-10-31T23:59:00-05:00', CATALOGO_BASE_2026, false],
	['CP-F3-E02', 'VL · 1-nov 00:00:30 (recién pasado el corte)', '2026-11-01T00:00:30-05:00', CATALOGO_NOV_2026, true],
	['CP-F3-E03', 'hoy (22-nov-2026)', '2026-11-22T10:00:00-05:00', CATALOGO_NOV_2026, true]
];

for (const [id, caso, instante, cat, conUltra] of ESCENARIOS) {
	test(`${id} ${caso}: precios y cupos del catálogo ${cat.id}`, async ({ page, backend: _ }) => {
		await page.clock.setFixedTime(new Date(instante));
		await page.goto('/planes');
		await rechazarCookies(page);

		for (const codigo of ['PYME', 'CONT', 'PRO', 'MAX'] as const) {
			const { nombre, precio, empresas } = cat.planes[codigo];
			const tarjeta = page
				.getByRole('heading', { name: nombre, exact: true })
				// La tarjeta: el ancestro más cercano que ya trae el precio anual y el cupo.
				.locator('xpath=ancestor::*[contains(., " al año") and (contains(., "Hasta ") or contains(., "1 empresa"))][1]');

			await expect(tarjeta, nombre).toContainText(`${pesos(precio)} al año`);
			await expect(tarjeta, nombre).toContainText(codigo === 'PYME' ? '1 empresa' : `Hasta ${empresas} empresas`);
			await expect(tarjeta, nombre).toContainText(pesos(Math.round(precio / empresas / 12)));
		}

		await expect(page.getByText(`Empresa adicional: ${pesos(cat.empresaAdicional)} al año`)).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Plan Contador Ultra', exact: true })).toHaveCount(conUltra ? 1 : 0);
	});
}

test('CP-F3-E04 el registro cobra el precio del catálogo vigente (Plan Contador antes y después del corte)', async ({ page, backend: _ }) => {
	await page.clock.setFixedTime(new Date('2026-10-31T23:59:00-05:00'));
	await page.goto('/registro?plan=Plan%20Contador');
	await rechazarCookies(page);
	await expect(page.getByText(`${pesos(CATALOGO_BASE_2026.planes.CONT.precio)}/año`).first()).toBeVisible();

	await page.clock.setFixedTime(new Date('2026-11-01T00:00:30-05:00'));
	await page.reload();
	await expect(page.getByText(`${pesos(CATALOGO_NOV_2026.planes.CONT.precio)}/año`).first()).toBeVisible();
});
