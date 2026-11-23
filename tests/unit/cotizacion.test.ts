// F3 · El cotizador completo: cotizar(), que arma el monto que se cobra en los
//      flujos de registro, compra, upgrade y empresas adicionales; la validez
//      de un cupón (evaluarCupon, normalizarCupon) y el control del monto que
//      llega de la pasarela (compararMonto).
// Código bajo prueba: sut/sitio-pagos/pagos.ts
//
// También la renovación anual: antes del 1-nov-2026 la regla es pura; desde
// esa fecha el precio lo calcula la base de datos y llega en el contexto, así
// que aquí se prueba qué hace cotizar() con cada respuesta posible de la base.
//
// Fuera del alcance: los flujos del plan mensual (producto lanzado en
// noviembre de 2026, con su propia lógica de ventanas y créditos) y el armado
// de referencias y firmas de la pasarela.
//
// Técnicas: tabla de decisión (TD) sobre flujo × licencia × datos, valores
// límite (VL) sobre el vencimiento y los usos del cupón y sobre la tolerancia
// del monto, y particiones de equivalencia (PE).

import { describe, expect, it } from 'vitest';
import {
	catalogoDeLicencia,
	codigoPlan,
	compararMonto,
	CORTE_PRECIOS_MS,
	cotizar,
	type CotizacionRenovacion,
	evaluarCupon,
	type FilaCupon,
	type LicenciaParaRenovar,
	normalizarCupon,
	reglaRenovacion,
	reglasEmpresas,
	CATALOGO_NOV_2026
} from '../../sut/sitio-pagos/pagos';

const HOY = new Date('2026-11-22T15:00:00Z');
const MITAD_DE_ANIO = new Date('2026-07-02T00:00:00Z');

/** Licencia anual comprada el 1-ene-2026 (catálogo base-2026). */
const licencia = (cambios: Partial<LicenciaParaRenovar> = {}): LicenciaParaRenovar => ({
	license_type: 'Plan Pyme',
	companies_number: 1,
	is_active: true,
	start_date: '2026-01-01',
	end_date: '2027-01-01',
	...cambios
});

describe('F3 · cotizar(): registro y compra', () => {
	it('CP-F3-60 registro Plan Pyme sin cupón: cobra el precio del catálogo vigente, exacto', () => {
		const r = cotizar({ flujo: 'registro', plan: 'PYME' }, { ahora: HOY });
		expect(r).toMatchObject({
			ok: true,
			montoCents: 20_000_000,
			toleranciaCents: 0,
			desglose: { plan: 'Plan Pyme', empresas: 1, subtotal: 200_000, descuento: 0, total: 200_000, catalogo: 'nov-2026' }
		});
	});

	it('CP-F3-61 VL · un registro cotizado 1 ms antes del corte usa el catálogo anterior', () => {
		const r = cotizar({ flujo: 'registro', plan: 'PYME' }, { ahora: HOY, instante: new Date(CORTE_PRECIOS_MS - 1) });
		expect(r).toMatchObject({ ok: true, montoCents: 15_000_000, desglose: { catalogo: 'base-2026' } });
	});

	it('CP-F3-62 registro Plan Contador con cupón del 10 %: descuento y total', () => {
		const r = cotizar({ flujo: 'registro', plan: 'CONT' }, { ahora: HOY, cuponPct: 10, cupon: 'PROMO10' });
		expect(r).toMatchObject({
			ok: true,
			montoCents: 31_500_000,
			desglose: { subtotal: 350_000, cupon: 'PROMO10', cuponPct: 10, descuento: 35_000, total: 315_000 }
		});
	});

	it('CP-F3-63 VL · cupón del 100 %: el monto es cero', () => {
		const r = cotizar({ flujo: 'registro', plan: 'PRO' }, { ahora: HOY, cuponPct: 100, cupon: 'GRATIS' });
		expect(r).toMatchObject({ ok: true, montoCents: 0, desglose: { descuento: 450_000, total: 0 } });
	});

	it('CP-F3-64 compra Plan Pyme con 2 empresas adicionales: precio del plan + adicionales', () => {
		const r = cotizar({ flujo: 'compra', plan: 'PYME', empresas: 3 }, { ahora: HOY });
		expect(r).toMatchObject({
			ok: true,
			montoCents: 35_000_000,
			desglose: { empresasAdicionales: 2, precioEmpresaAdicional: 75_000, precioAdicionales: 150_000, total: 350_000 }
		});
	});

	it('CP-F3-65 compra Plan Contador con más empresas que su cupo: rechazo 400', () => {
		expect(cotizar({ flujo: 'compra', plan: 'CONT', empresas: 6 }, { ahora: HOY })).toMatchObject({
			ok: false,
			status: 400,
			codigo: 'empresas_invalidas'
		});
	});
});

describe('F3 · cotizar(): upgrade y empresas adicionales (tabla de decisión)', () => {
	it('CP-F3-66 sin licencia activa: 409, no hay nada que subir', () => {
		expect(cotizar({ flujo: 'upgrade', plan: 'CONT' }, { ahora: HOY, licencia: null })).toMatchObject({
			ok: false,
			status: 409,
			codigo: 'sin_licencia'
		});
	});

	it.each([
		['CP-F3-67', 'a un plan inferior', 'Plan Contador Pro', 'CONT'],
		['CP-F3-68', 'al mismo plan', 'Plan Contador Pro', 'PRO']
	] as const)('%s upgrade %s: 400, solo se sube', (_id, _desc, actual, objetivo) => {
		expect(
			cotizar({ flujo: 'upgrade', plan: objetivo }, { ahora: MITAD_DE_ANIO, licencia: licencia({ license_type: actual }) })
		).toMatchObject({ ok: false, status: 400, codigo: 'no_es_upgrade' });
	});

	it('CP-F3-69 upgrade Pyme → Contador a mitad de año: prorrateado con el catálogo del periodo pagado', () => {
		const r = cotizar({ flujo: 'upgrade', plan: 'CONT' }, { ahora: MITAD_DE_ANIO, licencia: licencia() });
		expect(r).toMatchObject({
			ok: true,
			montoCents: 5_013_700,
			toleranciaCents: 82_200,
			desglose: { catalogo: 'base-2026', diasRestantes: 183, credito: 75_205, proporcional: 125_342, cupoNuevo: 10, total: 50_137 }
		});
	});

	it('CP-F3-70 2 empresas adicionales sobre un Pyme a mitad de año', () => {
		const r = cotizar({ flujo: 'extras', cantidad: 2 }, { ahora: MITAD_DE_ANIO, licencia: licencia() });
		expect(r).toMatchObject({
			ok: true,
			montoCents: 5_013_700,
			// Tolerancia de 3 días: ⌈3 × 50.000 × 2 / 365⌉ = $822.
			toleranciaCents: 82_200,
			desglose: { flujo: 'extras', cantidad: 2, cupoNuevo: 3, total: 50_137 }
		});
	});

	it('CP-F3-71 empresas adicionales sobre un plan que no es Pyme: 400', () => {
		expect(
			cotizar({ flujo: 'extras', cantidad: 1 }, { ahora: MITAD_DE_ANIO, licencia: licencia({ license_type: 'Plan Contador' }) })
		).toMatchObject({ ok: false, status: 400, codigo: 'extras_solo_pyme' });
	});

	it('CP-F3-72 sobre una licencia mensual no hay upgrade ni adicionales: 409', () => {
		const mensual = licencia({ periodicidad: 'mensual' });
		expect(cotizar({ flujo: 'upgrade', plan: 'CONT' }, { ahora: HOY, licencia: mensual })).toMatchObject({
			ok: false,
			status: 409,
			codigo: 'no_aplica_mensual'
		});
		expect(cotizar({ flujo: 'extras', cantidad: 1 }, { ahora: HOY, licencia: mensual })).toMatchObject({
			codigo: 'no_aplica_mensual'
		});
	});
});

describe('F3 · evaluarCupon (tabla de decisión: estado × candado × vencimiento × usos)', () => {
	const cupon = (cambios: Partial<FilaCupon> = {}): FilaCupon => ({
		id: 'c1',
		code: 'PROMO10',
		discount_percent: 10,
		is_active: true,
		...cambios
	});
	const libre = { usos: 0, yaUsadoPorCliente: false, plan: 'PYME' };
	const ahora = new Date('2026-11-22T12:00:00Z');

	it.each([
		['CP-F3-73', 'cupón activo sin restricciones', cupon(), libre, null],
		['CP-F3-74', 'inactivo', cupon({ is_active: false }), libre, 'inactivo'],
		['CP-F3-75', 'inactivo pesa más que vencido', cupon({ is_active: false, vence_at: '2026-01-01T00:00:00Z' }), libre, 'inactivo'],
		['CP-F3-76', 'solo para otro plan', cupon({ solo_plan: 'CONT' }), libre, 'otro_plan'],
		['CP-F3-77', 'con candado de plan y sin saber el plan', cupon({ solo_plan: 'PYME' }), { ...libre, plan: null }, 'otro_plan'],
		['CP-F3-78', 'VL · vence justo ahora', cupon({ vence_at: '2026-11-22T12:00:00Z' }), libre, 'vencido'],
		['CP-F3-79', 'VL · vence 1 ms después', cupon({ vence_at: '2026-11-22T12:00:00.001Z' }), libre, null],
		['CP-F3-80', 'VL · usos = máximo', cupon({ max_usos: 5 }), { ...libre, usos: 5 }, 'agotado'],
		['CP-F3-81', 'VL · usos = máximo − 1', cupon({ max_usos: 5 }), { ...libre, usos: 4 }, null],
		['CP-F3-82', 'ya lo usó el cliente (un uso por cliente por defecto)', cupon(), { ...libre, yaUsadoPorCliente: true }, 'ya_usado'],
		['CP-F3-83', 'ya lo usó, pero el cupón admite varios usos', cupon({ un_uso_por_cliente: false }), { ...libre, yaUsadoPorCliente: true }, null]
	] as const)('%s %s', (_id, _desc, c, uso, motivo) => {
		expect(evaluarCupon(c, uso, ahora)).toBe(motivo);
	});

	it.each([
		['CP-F3-84', 'espacios y minúsculas se normalizan', ' promo10 ', 'PROMO10'],
		['CP-F3-85', 'VL · 3 caracteres', 'abc', null],
		['CP-F3-86', 'con guion', 'PRO-10', null],
		['CP-F3-87', 'no es texto', 42, null]
	])('%s normalizarCupon · %s', (_id, _desc, entrada, esperado) => {
		expect(normalizarCupon(entrada)).toBe(esperado);
	});
});

describe('F3 · compararMonto: lo que llega de la pasarela contra lo cotizado', () => {
	it.each([
		['CP-F3-88', 'monto exacto', 20_000_000, 20_000_000, 0, 'exacto'],
		['CP-F3-89', 'más de lo cotizado', 20_000_100, 20_000_000, 0, 'mayor'],
		['CP-F3-90', 'VL · un centavo menos sin tolerancia', 19_999_999, 20_000_000, 0, 'insuficiente'],
		['CP-F3-91', 'VL · justo en el borde de la tolerancia', 4_931_500, 5_013_700, 82_200, 'exacto'],
		['CP-F3-92', 'VL · un centavo por debajo de la tolerancia', 4_931_499, 5_013_700, 82_200, 'insuficiente'],
		['CP-F3-93', 'PE inválida · monto con decimales', 20_000_000.5, 20_000_000, 0, 'insuficiente'],
		['CP-F3-94', 'PE inválida · NaN', Number.NaN, 20_000_000, 0, 'insuficiente']
	])('%s %s', (_id, _desc, recibido, esperado, tolerancia, resultado) => {
		expect(compararMonto(recibido, esperado, tolerancia)).toBe(resultado);
	});
});

describe('F3 · cotizar(): renovación anual (tabla de decisión: catálogo × ventana × respuesta de la base)', () => {
	const ANTES_DEL_CORTE = new Date('2026-10-20T15:00:00Z');
	const pyme = (cambios: Partial<LicenciaParaRenovar> = {}) => licencia({ end_date: '2026-12-31', ...cambios });
	const deLaBase = (cambios: Partial<CotizacionRenovacion> = {}): CotizacionRenovacion => ({
		resultado: 'ok',
		codigo: null,
		reglas: 'nov-2026',
		plan_anterior: 'Plan Pyme',
		cupo_anterior: 1,
		empresas_registradas: 4,
		fundador: false,
		paso: null,
		grupo: null,
		plan_codigo: 'CONT',
		plan: 'Plan Contador',
		cupo: 5,
		precio: 350_000,
		precio_plan: 350_000,
		empresas_adicionales: 0,
		precio_adicionales: 0,
		precio_lista: 350_000,
		precio_hoy: 350_000,
		...cambios
	});

	it('CP-F3-95 antes del corte, dentro de los 90 días: extiende la misma licencia desde el día siguiente al vencimiento', () => {
		const r = cotizar({ flujo: 'renovacion' }, { ahora: ANTES_DEL_CORTE, licencia: pyme() });
		expect(r).toMatchObject({
			ok: true,
			montoCents: 15_000_000,
			desglose: { catalogo: 'base-2026', modo: 'extendida', nuevaVigenciaDesde: '2027-01-01', nuevaVigenciaHasta: '2028-01-01', total: 150_000 }
		});
	});

	it('CP-F3-96 VL · faltan más de 90 días para el vencimiento: todavía no se puede renovar', () => {
		expect(cotizar({ flujo: 'renovacion' }, { ahora: ANTES_DEL_CORTE, licencia: pyme({ end_date: '2027-06-30' }) })).toMatchObject({
			ok: false,
			status: 409,
			codigo: 'fuera_de_ventana'
		});
	});

	it('CP-F3-97 licencia ya vencida: se crea una nueva desde hoy', () => {
		const r = cotizar({ flujo: 'renovacion' }, { ahora: ANTES_DEL_CORTE, licencia: pyme({ end_date: '2026-09-30' }) });
		expect(r).toMatchObject({ ok: true, desglose: { modo: 'nueva', nuevaVigenciaDesde: '2026-10-20' } });
	});

	it('CP-F3-98 la app muestra otro plan que el de la licencia: hay que recargar', () => {
		expect(cotizar({ flujo: 'renovacion', plan: 'CONT' }, { ahora: ANTES_DEL_CORTE, licencia: pyme() })).toMatchObject({
			ok: false,
			codigo: 'renovacion_desactualizada',
			mensaje: 'Tu plan cambió. Recarga la página.'
		});
	});

	it('CP-F3-99 antes del corte, un Contador con un cupo especial (7 empresas) se renueva a mano', () => {
		const especial = pyme({ license_type: 'Plan Contador', companies_number: 7 });
		expect(cotizar({ flujo: 'renovacion' }, { ahora: ANTES_DEL_CORTE, licencia: especial })).toMatchObject({
			ok: false,
			codigo: 'renovacion_manual'
		});
	});

	it('CP-F3-100 licencia desactivada con días por delante: a mano', () => {
		expect(cotizar({ flujo: 'renovacion' }, { ahora: ANTES_DEL_CORTE, licencia: pyme({ is_active: false }) })).toMatchObject({
			ok: false,
			codigo: 'renovacion_manual',
			mensaje: expect.stringContaining('desactivado')
		});
	});

	it('CP-F3-101 desde el corte, sin la cotización de la base: 503, nunca un precio inventado', () => {
		expect(cotizar({ flujo: 'renovacion' }, { ahora: HOY, licencia: pyme() })).toMatchObject({
			ok: false,
			status: 503,
			codigo: 'cotizacion_no_disponible',
			mensaje: expect.stringContaining('escríbenos por WhatsApp')
		});
	});

	it('CP-F3-102 desde el corte, la base cambia el plan según las empresas registradas: cobra lo que dice la base', () => {
		const r = cotizar({ flujo: 'renovacion' }, { ahora: HOY, licencia: pyme(), renovacion: deLaBase() });
		expect(r).toMatchObject({
			ok: true,
			montoCents: 35_000_000,
			desglose: { plan: 'Plan Contador', planAnterior: 'Plan Pyme', cambioDePlan: true, empresasRegistradas: 4, total: 350_000 }
		});
	});

	it('CP-F3-103 desde el corte, la base decide renovación manual por Ultra: mensaje de ventas', () => {
		const r = cotizar(
			{ flujo: 'renovacion' },
			{ ahora: HOY, licencia: pyme(), renovacion: deLaBase({ resultado: 'manual', codigo: 'ultra_ventas' }) }
		);
		expect(r).toMatchObject({ ok: false, codigo: 'renovacion_manual', mensaje: expect.stringContaining('Plan Contador Ultra') });
	});

	it('CP-F3-104 desde el corte, la app muestra un plan que no es ni el actual ni el destino: hay que recargar', () => {
		expect(
			cotizar({ flujo: 'renovacion', plan: 'MAX' }, { ahora: HOY, licencia: pyme(), renovacion: deLaBase() })
		).toMatchObject({ ok: false, codigo: 'renovacion_desactualizada', mensaje: 'Tu plan cambió. Recarga la página.' });
	});
});

// Casos agregados a partir de las pruebas de mutación (Stryker). Cada bloque
// dice qué borde de la regla no estaba cubierto.
describe('F3 · renovación: bordes de la ventana y del cupo (mutación)', () => {
	const ANTES_DEL_CORTE = new Date('2026-10-20T15:00:00Z'); // hoy en Bogotá: 2026-10-20
	const renovar = (cambios: Partial<LicenciaParaRenovar>, plan?: 'PYME' | 'CONT') =>
		cotizar({ flujo: 'renovacion', plan }, { ahora: ANTES_DEL_CORTE, licencia: licencia({ end_date: '2026-12-31', ...cambios }) });

	it('CP-F3-105 VL · faltan exactamente 90 días: ya se puede renovar (RN-16)', () => {
		expect(renovar({ end_date: '2027-01-18' })).toMatchObject({
			ok: true,
			desglose: { modo: 'extendida', diasRestantes: 90, nuevaVigenciaDesde: '2027-01-19' }
		});
	});

	it('CP-F3-106 VL · faltan 91 días: todavía no, y dice desde qué fecha se puede', () => {
		expect(renovar({ end_date: '2027-01-19' })).toMatchObject({
			ok: false,
			codigo: 'fuera_de_ventana',
			mensaje: 'Tu plan vence el 19 de enero de 2027. Puedes renovarlo desde el 21 de octubre de 2026.'
		});
	});

	it('CP-F3-107 VL · licencia activa que vence hoy: se extiende desde mañana, no desde hoy', () => {
		expect(renovar({ end_date: '2026-10-20' })).toMatchObject({
			ok: true,
			desglose: { modo: 'extendida', diasRestantes: 0, nuevaVigenciaDesde: '2026-10-21', nuevaVigenciaHasta: '2027-10-21' }
		});
	});

	it('CP-F3-108 VL · licencia desactivada que vence hoy: a mano (no se crea otra)', () => {
		expect(renovar({ end_date: '2026-10-20', is_active: false })).toMatchObject({
			ok: false,
			codigo: 'renovacion_manual',
			mensaje: 'Tu plan está desactivado. Escríbenos por WhatsApp y te ayudamos a renovarlo.'
		});
	});

	it('CP-F3-109 licencia desactivada y ya vencida: se crea una nueva desde hoy', () => {
		expect(renovar({ end_date: '2026-09-30', is_active: false })).toMatchObject({
			ok: true,
			desglose: { modo: 'nueva', nuevaVigenciaDesde: '2026-10-20' }
		});
	});

	it.each([
		['CP-F3-110', 'VL · Pyme con 200 empresas, el tope', 200, true],
		['CP-F3-111', 'VL · Pyme con 201 empresas', 201, false],
		['CP-F3-112', 'VL · Pyme con 0 empresas', 0, false],
		['CP-F3-113', 'PE inválida · cupo que no es número', 'diez', false]
	] as const)('%s %s', (_id, _desc, empresas, ok) => {
		const r = renovar({ companies_number: empresas });
		if (ok) expect(r).toMatchObject({ ok: true, desglose: { empresas: 200 } });
		else expect(r).toMatchObject({ ok: false, codigo: 'renovacion_manual', mensaje: expect.stringContaining('renovación especial') });
	});

	it('CP-F3-114 Pyme con 3 empresas: plan + 2 adicionales al precio de entonces, sin precio de fundador', () => {
		expect(renovar({ companies_number: 3 }, 'PYME')).toMatchObject({
			ok: true,
			montoCents: 25_000_000,
			desglose: { flujo: 'renovacion', empresasAdicionales: 2, precioAdicionales: 100_000, precioLista: 250_000, fundador: false }
		});
	});

	it('CP-F3-115 Contador con su cupo de entonces (10 empresas): se renueva en línea sin adicionales', () => {
		expect(renovar({ license_type: 'Plan Contador', companies_number: 10 })).toMatchObject({
			ok: true,
			montoCents: 25_000_000,
			desglose: { plan: 'Plan Contador', empresasAdicionales: 0, precioAdicionales: 0 }
		});
	});

	it('CP-F3-116 plan que no existe o fecha de vencimiento ilegible: a mano', () => {
		expect(renovar({ license_type: 'Plan Inventado' })).toMatchObject({ ok: false, codigo: 'renovacion_manual' });
		expect(renovar({ end_date: '31/12/2026' })).toMatchObject({ ok: false, codigo: 'renovacion_manual' });
	});

	it('CP-F3-117 sin licencia: 409 y lleva a elegir un plan', () => {
		expect(cotizar({ flujo: 'renovacion' }, { ahora: ANTES_DEL_CORTE, licencia: null })).toMatchObject({
			ok: false,
			status: 409,
			codigo: 'sin_licencia',
			mensaje: expect.stringContaining('sisteacuse.com/planes')
		});
	});

	it('CP-F3-118 si no se dice qué reglas usar, reglaRenovacion aplica las de antes del corte', () => {
		const especial = licencia({ license_type: 'Plan Contador', companies_number: 7, end_date: '2026-12-31' });
		expect(reglaRenovacion(especial, '2026-10-20')).toMatchObject({ ok: false, codigo: 'renovacion_manual' });
		expect(reglaRenovacion(especial, '2026-10-20', true)).toMatchObject({ ok: true, modo: 'extendida' });
	});
});

describe('F3 · renovación desde el corte: lo que decide la base (mutación)', () => {
	const pyme = licencia({ end_date: '2026-12-31' });
	const base = (cambios: Partial<CotizacionRenovacion> = {}): CotizacionRenovacion => ({
		resultado: 'ok', codigo: null, reglas: 'nov-2026', plan_anterior: 'Plan Pyme', cupo_anterior: 1,
		empresas_registradas: 1, fundador: true, paso: 1, grupo: null, plan_codigo: 'PYME', plan: 'Plan Pyme',
		cupo: 1, precio: 180_000, precio_plan: null, empresas_adicionales: 0, precio_adicionales: 0,
		precio_lista: 200_000, precio_hoy: 180_000, ...cambios
	});
	const renovar = (q: CotizacionRenovacion | undefined, lic = pyme, plan?: 'PYME' | 'CONT' | 'ULTRA') =>
		cotizar({ flujo: 'renovacion', plan } as never, { ahora: HOY, licencia: lic, renovacion: q });

	it('CP-F3-119 mismo plan: no hay cambio de plan y, sin precio_plan, el precio del plan es el total', () => {
		expect(renovar(base(), pyme, 'PYME')).toMatchObject({
			ok: true,
			montoCents: 18_000_000,
			desglose: { cambioDePlan: false, precioPlan: 180_000, fundador: true, flujo: 'renovacion' }
		});
	});

	it('CP-F3-120 la base sube el plan: la app puede seguir mostrando el plan actual o ya el nuevo', () => {
		const contador = base({ plan_codigo: 'CONT', plan: 'Plan Contador', cupo: 5, precio: 350_000 });
		expect(renovar(contador, pyme, 'PYME')).toMatchObject({ ok: true, desglose: { cambioDePlan: true } });
		expect(renovar(contador, pyme, 'CONT')).toMatchObject({ ok: true, montoCents: 35_000_000 });
	});

	it('CP-F3-121 una cotización con reglas de otra versión no se usa: 503', () => {
		expect(renovar(base({ reglas: 'otra' as 'nov-2026' }))).toMatchObject({ ok: false, status: 503, codigo: 'cotizacion_no_disponible' });
	});

	it('CP-F3-122 Ultra se renueva con lo que diga la base; un plan desconocido, a mano', () => {
		const ultra = licencia({ license_type: 'Plan Contador Ultra', companies_number: 50, end_date: '2026-12-31' });
		const q = base({ plan_codigo: 'ULTRA', plan: 'Plan Contador Ultra', cupo: 50, precio: 1_400_000 });
		expect(renovar(q, ultra)).toMatchObject({ ok: true, montoCents: 140_000_000 });
		expect(renovar(q, licencia({ license_type: 'Plan Inventado', end_date: '2026-12-31' }))).toMatchObject({
			ok: false,
			codigo: 'renovacion_manual'
		});
	});

	it('CP-F3-123 sobre un plan mensual no hay renovación anual: se compran más meses', () => {
		expect(renovar(base(), licencia({ periodicidad: 'mensual' }))).toMatchObject({
			ok: false,
			codigo: 'no_aplica_mensual',
			mensaje: expect.stringContaining('compra más meses')
		});
		expect(cotizar({ flujo: 'upgrade', plan: 'CONT' }, { ahora: HOY, licencia: licencia({ periodicidad: 'mensual' }) })).toMatchObject({
			mensaje: expect.stringContaining('para cambiar de plan o sumar empresas')
		});
	});
});

describe('F3 · cotizar(): detalles del registro, la compra y el upgrade (mutación)', () => {
	it('CP-F3-124 un cupón que no descuenta nada no aparece en el desglose', () => {
		expect(cotizar({ flujo: 'registro', plan: 'PYME' }, { ahora: HOY, cuponPct: 0, cupon: 'CERO' })).toMatchObject({
			ok: true,
			desglose: { cupon: null, descuento: 0 }
		});
	});

	it('CP-F3-125 en el registro se ignoran las empresas que mande el navegador: solo las del plan', () => {
		expect(cotizar({ flujo: 'registro', plan: 'PYME', empresas: 5 } as never, { ahora: HOY })).toMatchObject({
			ok: true,
			montoCents: 20_000_000,
			desglose: { flujo: 'registro', empresas: 1 }
		});
	});

	it('CP-F3-126 tener un plan mensual no impide registrarse o comprar el anual', () => {
		const mensual = licencia({ periodicidad: 'mensual' });
		expect(cotizar({ flujo: 'compra', plan: 'PYME', empresas: 1 }, { ahora: HOY, licencia: mensual })).toMatchObject({ ok: true });
	});

	it('CP-F3-127 upgrade de un Pyme con 12 empresas a Contador: conserva su cupo si es mayor al del plan', () => {
		const r = cotizar({ flujo: 'upgrade', plan: 'CONT' }, { ahora: MITAD_DE_ANIO, licencia: licencia({ companies_number: 12 }) });
		expect(r).toMatchObject({ ok: true, desglose: { flujo: 'upgrade', cupoNuevo: 12 } });
	});

	it('CP-F3-128 los mensajes de rechazo del upgrade dicen qué hacer', () => {
		expect(cotizar({ flujo: 'upgrade', plan: 'CONT' }, { ahora: HOY, licencia: null })).toMatchObject({
			mensaje: 'No tienes un plan activo.'
		});
		expect(
			cotizar({ flujo: 'upgrade', plan: 'PYME' }, { ahora: MITAD_DE_ANIO, licencia: licencia({ license_type: 'Plan Contador' }) })
		).toMatchObject({ mensaje: 'Solo puedes subir a un plan superior.' });
	});

	it('CP-F3-129 los flujos del plan mensual se delegan a su propio cotizador (fuera del alcance)', () => {
		const ctx = { ahora: HOY, licencia: null };
		expect(cotizar({ flujo: 'mensual', plan: 'PYME', empresas: 1, meses: 1 } as never, ctx)).toMatchObject({ desglose: { flujo: 'mensual' } });
		expect(cotizar({ flujo: 'registro_mensual', plan: 'PYME', meses: 1 } as never, ctx)).toMatchObject({
			desglose: { flujo: 'registro_mensual' }
		});
		expect(cotizar({ flujo: 'al_dia' } as never, ctx)).toMatchObject({ codigo: 'sin_mensual' });
		expect(cotizar({ flujo: 'anualizar', plan: 'PYME', empresas: 1 } as never, ctx)).toMatchObject({ codigo: 'sin_mensual' });
	});
});

describe('F3 · reglas de apoyo del cotizador (mutación)', () => {
	it('CP-F3-130 null en las empresas de una compra vale como «las del plan»', () => {
		expect(reglasEmpresas(CATALOGO_NOV_2026, 'compra', 'PYME', null)).toEqual({ ok: true, empresas: 1 });
	});

	it('CP-F3-131 los mensajes de rechazo de empresas dicen el límite', () => {
		expect(reglasEmpresas(CATALOGO_NOV_2026, 'compra', 'PYME', 'x')).toMatchObject({ mensaje: 'Cantidad de empresas inválida.' });
		expect(reglasEmpresas(CATALOGO_NOV_2026, 'compra', 'PYME', 22)).toMatchObject({
			mensaje: 'El Plan Pyme admite hasta 20 empresas adicionales por compra.'
		});
		expect(cotizar({ flujo: 'extras', cantidad: 21 }, { ahora: MITAD_DE_ANIO, licencia: licencia() })).toMatchObject({
			mensaje: 'Puedes agregar de 1 a 20 empresas por compra.'
		});
		expect(
			cotizar({ flujo: 'extras', cantidad: 1 }, { ahora: MITAD_DE_ANIO, licencia: licencia({ license_type: 'Plan Contador' }) })
		).toMatchObject({ mensaje: expect.stringContaining('solo aplica al Plan Pyme') });
	});

	it('CP-F3-132 codigoPlan no acepta un arreglo aunque su texto sea el nombre de un plan', () => {
		expect(codigoPlan(['Plan Pyme'])).toBeNull();
		expect(codigoPlan('Plan Pyme')).toBe('PYME');
	});

	it('CP-F3-133 el catálogo de una licencia exige una fecha de calendario (AAAA-MM-DD) exacta', () => {
		expect(catalogoDeLicencia({ start_date: '2026-11-05' }).id).toBe('nov-2026');
		expect(catalogoDeLicencia({ start_date: '2026-11-05T00:00:00Z' }).id).toBe('base-2026');
		expect(catalogoDeLicencia({ start_date: 'X2026-11-05' }).id).toBe('base-2026');
	});

	it('CP-F3-134 cupón con candado de plan: vale para ese plan; un máximo de usos nulo es «sin límite»', () => {
		const ahora = new Date('2026-11-22T12:00:00Z');
		const fila: FilaCupon = { id: 'c1', code: 'PYME10', discount_percent: 10, is_active: true, solo_plan: 'PYME', max_usos: null };
		expect(evaluarCupon(fila, { usos: 3, yaUsadoPorCliente: false, plan: 'PYME' }, ahora)).toBeNull();
	});
});
