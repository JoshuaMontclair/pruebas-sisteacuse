// F4 · Registro de una cuenta nueva con compra del plan (sitio público, /registro)
//
// Flujo: datos de la persona → cupón opcional → pago en Wompi → /gracias.
// El backend y Wompi son dobles de prueba (ver entorno.ts). Técnicas: tabla de
// decisión sobre las validaciones del paso 1, valores límite sobre el celular
// y particiones de equivalencia sobre las respuestas del servidor de pagos.

import { expect, pagoFirmado, test } from './entorno';
import type { Page } from '@playwright/test';

const PYME = '/registro?plan=Plan%20Pyme';

type Datos = { nombre: string; apellido: string; correo: string; celular: string; acepta: boolean };
const VALIDOS: Datos = {
	nombre: 'Ana',
	apellido: 'Prueba',
	correo: 'ana@prueba.local',
	celular: '300 123 4567',
	acepta: true
};

async function llenarPaso1(page: Page, datos: Partial<Datos> = {}) {
	const d = { ...VALIDOS, ...datos };
	await page.goto(PYME);
	await page.locator('#firstName').fill(d.nombre);
	await page.locator('#lastName').fill(d.apellido);
	await page.locator('#reg-email').fill(d.correo);
	await page.locator('#phone').fill(d.celular);
	if (d.acepta) await page.getByRole('checkbox', { name: /Acepto los términos/ }).check();
	await page.getByRole('button', { name: 'Continuar al pago' }).click();
}

const paso2 = (page: Page) => page.getByRole('heading', { name: 'Confirma y paga.' });

test.describe('F4 · paso 1: datos de la persona', () => {
	test('CP-F4-01 datos válidos pasan al pago y registran el checkout con el celular normalizado', async ({ page, backend }) => {
		await llenarPaso1(page, { celular: '+57 300 123 4567' });
		await expect(paso2(page)).toBeVisible();
		await expect(page.getByText('Ana Prueba')).toBeVisible();

		await expect.poll(() => backend.llamadasA('/rest/v1/checkouts').length).toBe(1);
		expect(backend.llamadasA('/rest/v1/checkouts')[0].cuerpo).toMatchObject({
			flujo: 'registro',
			plan: 'Plan Pyme',
			valor: 200_000,
			email: 'ana@prueba.local',
			nombre: 'Ana Prueba',
			celular: '3001234567'
		});
	});

	const RECHAZOS: [string, string, Partial<Datos>, string][] = [
		['CP-F4-02', 'sin nombre', { nombre: '' }, 'Ingresa tu nombre.'],
		['CP-F4-03', 'nombre solo con espacios', { nombre: '   ' }, 'Ingresa tu nombre.'],
		['CP-F4-04', 'sin apellido', { apellido: '' }, 'Ingresa tu apellido.'],
		['CP-F4-05', 'sin celular', { celular: '' }, 'Ingresa tu número de celular.'],
		['CP-F4-06', 'VL · celular de 9 dígitos', { celular: '300123456' }, 'El celular debe ser un número colombiano'],
		['CP-F4-07', 'VL · celular de 11 dígitos', { celular: '30012345678' }, 'El celular debe ser un número colombiano'],
		['CP-F4-08', 'celular que no empieza por 3 (fijo)', { celular: '6021234567' }, 'El celular debe ser un número colombiano'],
		['CP-F4-09', 'sin aceptar términos y tratamiento de datos', { acepta: false }, 'Debes aceptar los términos']
	];

	for (const [id, caso, datos, mensaje] of RECHAZOS) {
		test(`${id} ${caso}: no avanza y explica por qué`, async ({ page, backend }) => {
			await llenarPaso1(page, datos);
			await expect(page.getByText(mensaje)).toBeVisible();
			await expect(paso2(page)).toBeHidden();
			expect(backend.llamadasA('/rest/v1/checkouts')).toHaveLength(0);
		});
	}

	test('CP-F4-23 sin correo: no avanza y lo pide', async ({ page, backend }) => {
		await llenarPaso1(page, { correo: '' });
		await expect(page.getByText('Ingresa tu correo electrónico.')).toBeVisible();
		await expect(paso2(page)).toBeHidden();
		expect(backend.llamadasA('/rest/v1/checkouts')).toHaveLength(0);
	});

	test('CP-F4-24 correo sin dominio: lo detiene la validación del navegador (type="email")', async ({ page, backend }) => {
		await llenarPaso1(page, { correo: 'juanperez' });
		const correo = page.locator('#reg-email');
		expect(await correo.evaluate((e: HTMLInputElement) => e.validity.typeMismatch)).toBe(true);
		await expect(paso2(page)).toBeHidden();
		expect(backend.llamadasA('/rest/v1/checkouts')).toHaveLength(0);
	});

	test('CP-F4-10 VL · celular con indicativo 057 (13 dígitos) se acepta', async ({ page, backend }) => {
		await llenarPaso1(page, { celular: '057 300 123 4567' });
		await expect(paso2(page)).toBeVisible();
		await expect.poll(() => backend.llamadasA('/rest/v1/checkouts')[0]?.cuerpo?.celular).toBe('3001234567');
	});
});

test.describe('F4 · paso 2: cupón de descuento', () => {
	async function aplicarCupon(page: Page, codigo: string) {
		await page.getByRole('button', { name: 'Tengo un cupón de descuento' }).click();
		await page.getByLabel('Código de cupón').fill(codigo);
		await page.getByRole('button', { name: 'Aplicar' }).click();
	}

	test('CP-F4-11 cupón vacío: pide el código sin llamar al servidor', async ({ page, backend }) => {
		await llenarPaso1(page);
		await aplicarCupon(page, '  ');
		await expect(page.getByRole('alert')).toHaveText('Ingresa un código de cupón.');
		expect(backend.llamadasA('/preparar-pago')).toHaveLength(0);
	});

	test('CP-F4-12 cupón válido: lo cotiza el servidor (en mayúsculas) y el total baja', async ({ page, backend }) => {
		backend.prepararPago = () => ({
			status: 200,
			cuerpo: { ok: true, gratis: false, desglose: { total: 180_000, cuponPct: 10, descuento: 20_000 } }
		});
		await llenarPaso1(page);
		await aplicarCupon(page, 'promo10');

		await expect(page.getByRole('button', { name: 'Pagar $180.000' })).toBeVisible();
		expect(backend.llamadasA('/preparar-pago')[0].cuerpo).toEqual({
			flujo: 'registro',
			plan: 'Plan Pyme',
			email: 'ana@prueba.local',
			cupon: 'PROMO10',
			solo_cotizar: true
		});
	});

	test('CP-F4-13 cupón rechazado por el servidor: mensaje claro y el total no cambia', async ({ page, backend }) => {
		backend.prepararPago = () => ({ status: 400, cuerpo: { ok: false, codigo: 'cupon', error: 'cupon_invalido' } });
		await llenarPaso1(page);
		await aplicarCupon(page, 'VENCIDO');

		await expect(page.getByRole('alert')).toHaveText('Cupón inválido o vencido.');
		await expect(page.getByRole('button', { name: 'Pagar $200.000' })).toBeVisible();
	});
});

test.describe('F4 · paso 2: pago', () => {
	test('CP-F4-14 pago aprobado: firma en el servidor, abre Wompi con el monto firmado y lleva a /gracias', async ({ page, backend }) => {
		backend.prepararPago = () => pagoFirmado(200_000);
		await llenarPaso1(page);
		await page.getByRole('button', { name: 'Pagar $200.000' }).click();

		await expect(page).toHaveURL(/\/gracias/);
		const pedido = backend.llamadasA('/preparar-pago').at(-1)!.cuerpo;
		expect(pedido).toMatchObject({ flujo: 'registro', plan: 'Plan Pyme', email: 'ana@prueba.local', cupon: null });
		expect(pedido.seguimiento).toMatchObject({ nombre: 'Ana Prueba', celular: '3001234567', consentimiento: true });

		const wompi = await page.evaluate(() => (window as any).__wompi.config);
		expect(wompi).toMatchObject({
			currency: 'COP',
			amountInCents: 20_000_000,
			reference: 'SA-REG3-PYME-0-1795398288-prueba',
			signature: { integrity: 'firma-de-prueba' },
			customerData: { email: 'ana@prueba.local', fullName: 'Ana Prueba', phoneNumber: '3001234567', phoneNumberPrefix: '+57' }
		});
	});

	const ESTADOS: [string, string, string][] = [
		['CP-F4-15', 'DECLINED', 'El pago fue rechazado. Puedes intentar de nuevo con otro método.'],
		['CP-F4-16', 'VOIDED', 'El pago fue cancelado. Puedes intentar de nuevo.'],
		['CP-F4-17', 'PENDING', 'El pago quedó pendiente (común en PSE). Si se aprueba, el plan se activa solo.'],
		['CP-F4-18', 'ERROR', 'Hubo un error con el pago. Puedes intentar de nuevo.']
	];
	for (const [id, estado, mensaje] of ESTADOS) {
		test(`${id} Wompi responde ${estado}: se queda en el pago con el mensaje correcto`, async ({ page, backend }) => {
			backend.resultadoWompi = estado;
			await llenarPaso1(page);
			await page.getByRole('button', { name: 'Pagar $200.000' }).click();
			await expect(page.getByText(mensaje)).toBeVisible();
			await expect(page).not.toHaveURL(/\/gracias/);
		});
	}

	test('CP-F4-19 la persona cierra Wompi sin pagar: puede volver a intentarlo', async ({ page, backend }) => {
		backend.resultadoWompi = null;
		await llenarPaso1(page);
		const pagar = page.getByRole('button', { name: 'Pagar $200.000' });
		await pagar.click();
		await expect(pagar).toBeEnabled();
		await expect(page).not.toHaveURL(/\/gracias/);
	});

	test('CP-F4-20 pagos caídos (503): pide escribir por WhatsApp y no abre Wompi', async ({ page, backend }) => {
		backend.prepararPago = () => ({ status: 503, cuerpo: { ok: false, codigo: 'no_disponible', error: 'x' } });
		await llenarPaso1(page);
		await page.getByRole('button', { name: 'Pagar $200.000' }).click();
		await expect(page.getByText('Los pagos no están disponibles en este momento.')).toBeVisible();
		expect(await page.evaluate(() => (window as any).__wompi?.abierto ?? false)).toBe(false);
	});

	test('CP-F4-21 el correo ya tiene cuenta (409): muestra el aviso del servidor', async ({ page, backend }) => {
		backend.prepararPago = () => ({
			status: 409,
			cuerpo: { ok: false, codigo: 'ya_tiene_cuenta', error: 'Este correo ya tiene una cuenta con un plan activo.' }
		});
		await llenarPaso1(page);
		await page.getByRole('button', { name: 'Pagar $200.000' }).click();
		await expect(page.getByText('Este correo ya tiene una cuenta con un plan activo.')).toBeVisible();
	});
});

test('CP-F4-22 un plan que no existe en la URL no abre el formulario de compra', async ({ page }) => {
	await page.goto('/registro?plan=Plan%20Inventado');
	await expect(page).toHaveTitle('Plan no disponible — SisteAcuse');
	await expect(page.locator('#firstName')).toHaveCount(0);
});
