// F4 · Registro de una cuenta nueva con compra del plan (sitio público, /registro)
//
// Flujo: datos de la persona → cupón opcional → pago en Wompi → /gracias.
// El backend y Wompi son dobles de prueba (ver entorno.ts): el doble cotiza
// con cotizar(), la función real del servidor. Técnicas: tabla de decisión
// sobre las validaciones del paso 1, valores límite sobre el celular y
// particiones de equivalencia sobre las respuestas del servidor de pagos.
//
// El reloj se fija en HOY (22-nov-2026) y los montos esperados salen del
// catálogo vigente ese día: si los precios cambian, las pruebas no se rompen.

import { errorDePagos, expect, HOY, servidorDePagos, test } from './entorno';
import type { Page } from '@playwright/test';
import { aplicarCupon as descuento, catalogoEn } from '../../sut/sitio-pagos/pagos';

const PYME = '/registro?plan=Plan%20Pyme';
const PRECIO = catalogoEn(HOY).planes.PYME.precio;
const CON_CUPON = descuento(PRECIO, 10);
const pesos = (n: number) => '$' + n.toLocaleString('es-CO');
const pagar = (page: Page, monto = PRECIO) => page.getByRole('button', { name: `Pagar ${pesos(monto)}` });

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
	await page.clock.setFixedTime(HOY);
	await page.goto(PYME);
	await page.getByLabel('Nombre', { exact: true }).fill(d.nombre);
	await page.getByLabel('Apellido', { exact: true }).fill(d.apellido);
	await page.getByLabel('Correo electrónico', { exact: true }).fill(d.correo);
	await page.getByLabel('Celular', { exact: true }).fill(d.celular);
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
			valor: PRECIO,
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
		const correo = page.getByLabel('Correo electrónico', { exact: true });
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

// Arreglo ortogonal L8 (2^7) sobre los cinco campos del paso 1, como en la
// Entrega I (CP-AO). Factores y columnas del L8: nombre (1), apellido (2),
// correo (4), celular (6) y términos (7). Nivel 1 = válido, 2 = inválido
// (vacío, celular de 9 dígitos o casilla sin marcar). Ocho corridas cubren
// todas las parejas de niveles de cualquier par de factores.
// El formulario valida en orden y muestra solo el primer error: el resultado
// esperado es el mensaje del primer factor inválido (RN-10, RN-11).
const L8: [string, number, number, number, number, number, string | null][] = [
	['CP-F4-26', 1, 1, 1, 1, 1, null],
	['CP-F4-27', 1, 1, 2, 2, 2, 'Ingresa tu correo electrónico.'],
	['CP-F4-28', 1, 2, 1, 2, 2, 'Ingresa tu apellido.'],
	['CP-F4-29', 1, 2, 2, 1, 1, 'Ingresa tu apellido.'],
	['CP-F4-30', 2, 1, 1, 1, 2, 'Ingresa tu nombre.'],
	['CP-F4-31', 2, 1, 2, 2, 1, 'Ingresa tu nombre.'],
	['CP-F4-32', 2, 2, 1, 2, 1, 'Ingresa tu nombre.'],
	['CP-F4-33', 2, 2, 2, 1, 2, 'Ingresa tu nombre.']
];

test.describe('F4 · paso 1: arreglo ortogonal L8', () => {
	for (const [id, nombre, apellido, correo, celular, terminos, mensaje] of L8) {
		const corrida = `${nombre}${apellido}${correo}${celular}${terminos}`;
		test(`${id} AO corrida ${corrida}: ${mensaje ?? 'pasa al pago'}`, async ({ page, backend }) => {
			await llenarPaso1(page, {
				nombre: nombre === 1 ? VALIDOS.nombre : '',
				apellido: apellido === 1 ? VALIDOS.apellido : '',
				correo: correo === 1 ? VALIDOS.correo : '',
				celular: celular === 1 ? VALIDOS.celular : '300123456',
				acepta: terminos === 1
			});
			if (mensaje === null) {
				await expect(paso2(page)).toBeVisible();
			} else {
				await expect(page.getByText(mensaje)).toBeVisible();
				await expect(paso2(page)).toBeHidden();
				expect(backend.llamadasA('/rest/v1/checkouts')).toHaveLength(0);
			}
		});
	}
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
		backend.prepararPago = servidorDePagos({ PROMO10: 10 });
		await llenarPaso1(page);
		await aplicarCupon(page, 'promo10');

		await expect(pagar(page, CON_CUPON)).toBeVisible();
		expect(backend.llamadasA('/preparar-pago')[0].cuerpo).toEqual({
			flujo: 'registro',
			plan: 'Plan Pyme',
			email: 'ana@prueba.local',
			cupon: 'PROMO10',
			solo_cotizar: true
		});
	});

	test('CP-F4-13 cupón vencido (lo rechaza evaluarCupon en el servidor): mensaje claro y el total no cambia', async ({ page, backend }) => {
		backend.prepararPago = servidorDePagos({
			PROMO10: 10,
			VENCIDO: { discount_percent: 20, vence_at: '2026-11-01T00:00:00-05:00' }
		});
		await llenarPaso1(page);
		await aplicarCupon(page, 'VENCIDO');

		await expect(page.getByRole('alert')).toHaveText('Cupón inválido o vencido.');
		await expect(pagar(page)).toBeVisible();
	});
});

test.describe('F4 · paso 2: pago', () => {
	test('CP-F4-14 pago aprobado: firma en el servidor, abre Wompi con el monto firmado y lleva a /gracias', async ({ page, backend }) => {
		await llenarPaso1(page);
		await pagar(page).click();

		await expect(page).toHaveURL(/\/gracias/);
		const pedido = backend.llamadasA('/preparar-pago').at(-1)!.cuerpo;
		expect(pedido).toMatchObject({ flujo: 'registro', plan: 'Plan Pyme', email: 'ana@prueba.local', cupon: null });
		expect(pedido.seguimiento).toMatchObject({ nombre: 'Ana Prueba', celular: '3001234567', consentimiento: true });

		const wompi = await page.evaluate(() => (window as any).__wompi.config);
		expect(wompi).toMatchObject({
			currency: 'COP',
			amountInCents: PRECIO * 100,
			reference: 'SA-REG3-PYME-0-1795398288-prueba',
			signature: { integrity: 'firma-de-prueba' },
			customerData: { email: 'ana@prueba.local', fullName: 'Ana Prueba', phoneNumber: '3001234567', phoneNumberPrefix: '+57' }
		});
	});

	test('CP-F4-25 pago con cupón: Wompi se abre con el monto con descuento que firmó el servidor', async ({ page, backend }) => {
		backend.prepararPago = servidorDePagos({ PROMO10: 10 });
		await llenarPaso1(page);
		await page.getByRole('button', { name: 'Tengo un cupón de descuento' }).click();
		await page.getByLabel('Código de cupón').fill('PROMO10');
		await page.getByRole('button', { name: 'Aplicar' }).click();
		await pagar(page, CON_CUPON).click();

		await expect(page).toHaveURL(/\/gracias/);
		expect(backend.llamadasA('/preparar-pago').at(-1)!.cuerpo).toMatchObject({ cupon: 'PROMO10' });
		const wompi = await page.evaluate(() => (window as any).__wompi.config);
		expect(wompi).toMatchObject({ amountInCents: CON_CUPON * 100, reference: 'SA-REG3-PYME-PROMO10-1795398288-prueba' });
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
			await pagar(page).click();
			await expect(page.getByText(mensaje)).toBeVisible();
			await expect(page).not.toHaveURL(/\/gracias/);
		});
	}

	test('CP-F4-19 la persona cierra Wompi sin pagar: puede volver a intentarlo y el pago se firma de nuevo', async ({ page, backend }) => {
		backend.resultadoWompi = null;
		await llenarPaso1(page);
		const boton = pagar(page);
		await boton.click();
		await expect(boton).toBeEnabled();
		await expect(page).not.toHaveURL(/\/gracias/);

		await boton.click();
		await expect.poll(() => page.evaluate(() => (window as any).__aperturasWompi)).toBe(2);
		expect(backend.llamadasA('/preparar-pago').filter((l) => !l.cuerpo?.solo_cotizar)).toHaveLength(2);
		await expect(page).not.toHaveURL(/\/gracias/);
	});

	test('CP-F4-20 pagos caídos (503): pide escribir por WhatsApp y no abre Wompi', async ({ page, backend }) => {
		backend.prepararPago = () => errorDePagos(503, 'no_disponible', 'x');
		await llenarPaso1(page);
		await pagar(page).click();
		await expect(
			page.getByText('Los pagos no están disponibles en este momento. Escríbenos por WhatsApp y te ayudamos.')
		).toBeVisible();
		expect(await page.evaluate(() => (window as any).__wompi?.abierto ?? false)).toBe(false);
	});

	test('CP-F4-21 el correo ya tiene cuenta (409): muestra el aviso del servidor', async ({ page, backend }) => {
		backend.prepararPago = () =>
			errorDePagos(409, 'ya_tiene_cuenta', 'Este correo ya tiene una cuenta con un plan activo.');
		await llenarPaso1(page);
		await pagar(page).click();
		await expect(page.getByText('Este correo ya tiene una cuenta con un plan activo.')).toBeVisible();
		expect(await page.evaluate(() => (window as any).__wompi?.abierto ?? false)).toBe(false);
	});

	test('CP-F4-34 el sitio cobra el monto que firma el servidor, no el que muestra (RN-12)', async ({ page, backend }) => {
		// El servidor firma $123.456 aunque la página muestre el precio del plan:
		// si el sitio usara su propio monto, Wompi se abriría con el precio.
		backend.prepararPago = servidorDePagos({}, { montoFirmadoCents: 12_345_600 });
		await llenarPaso1(page);
		await pagar(page).click();
		await expect(page).toHaveURL(/\/gracias/);
		const wompi = await page.evaluate(() => (window as any).__wompi.config);
		expect(wompi.amountInCents).toBe(12_345_600);
		expect(wompi.amountInCents).not.toBe(PRECIO * 100);
	});

	test('CP-F4-35 cupón con candado para otro plan: el servidor lo rechaza aunque exista', async ({ page, backend }) => {
		backend.prepararPago = servidorDePagos({ SOLOCONT: { discount_percent: 30, solo_plan: 'CONT' } });
		await llenarPaso1(page);
		await page.getByRole('button', { name: 'Tengo un cupón de descuento' }).click();
		await page.getByLabel('Código de cupón').fill('soloCont');
		await page.getByRole('button', { name: 'Aplicar' }).click();
		await expect(page.getByRole('alert')).toHaveText('Cupón inválido o vencido.');
		await expect(pagar(page)).toBeVisible();
	});
});

// Defecto encontrado por las E2E (prueba de caracterización, como las de
// tests/unit/defectos.test.ts): fija el comportamiento de hoy y avisará cuando
// se corrija.
test.describe('DEF-06 · F4 · un pago pendiente se puede pagar otra vez', () => {
	test('tras PENDING el sitio firma un segundo pago y vuelve a abrir Wompi (correcto: bloquear o advertir)', async ({ page, backend }) => {
		backend.resultadoWompi = 'PENDING';
		await llenarPaso1(page);
		const boton = pagar(page);
		await boton.click();
		await expect(page.getByText('El pago quedó pendiente (común en PSE). Si se aprueba, el plan se activa solo.')).toBeVisible();

		// El mensaje dice que el plan se activará solo, pero el botón sigue activo.
		await expect(boton).toBeEnabled();
		await boton.click();
		await expect.poll(() => page.evaluate(() => (window as any).__aperturasWompi)).toBe(2);
		const firmas = backend.llamadasA('/preparar-pago').filter((l) => !l.cuerpo?.solo_cotizar);
		expect(firmas).toHaveLength(2);
	});
});

test.describe('DEF-07 · F4 · el botón de WhatsApp tapa el total a pagar en escritorio', () => {
	test('a 1280 × 720, el centro del monto total queda debajo del botón «¿Dudas? Escríbenos» (correcto: monto visible)', async ({
		page,
		backend: _
	}, info) => {
		test.skip(info.project.name !== 'escritorio-chromium', 'En el iPhone el resumen del pedido se ubica de otra forma.');
		await llenarPaso1(page);
		await expect(paso2(page)).toBeVisible();
		const monto = page.getByText('Total a pagar').locator('xpath=..').getByText(pesos(PRECIO), { exact: true });
		const caja = (await monto.boundingBox())!;
		const encima = await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.textContent?.trim() ?? null,
			{ x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 }
		);
		expect(encima).toBe('¿Dudas? Escríbenos');
	});
});

test('CP-F4-22 un plan que no existe en la URL no abre el formulario de compra', async ({ page }) => {
	await page.clock.setFixedTime(HOY);
	await page.goto('/registro?plan=Plan%20Inventado');
	await expect(page).toHaveTitle('Plan no disponible — SisteAcuse');
	await expect(page.getByLabel('Nombre', { exact: true })).toHaveCount(0);
});
