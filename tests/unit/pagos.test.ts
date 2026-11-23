// F3 · Compra de planes: precio anual, empresas adicionales, cupón, prorrateo
//      del upgrade y cambio de catálogo en la fecha de corte (1-nov-2026)
// Código bajo prueba: sut/sitio-pagos/pagos.ts (cotizador del servidor, el que
// decide cuánto se cobra)
//
// Técnicas: tabla de decisión (TD) para las reglas de empresas, valores límite
// (VL) sobre el cupón, el tope de empresas adicionales, la fecha de corte y el
// prorrateo, y particiones de equivalencia (PE) sobre los datos de entrada.

import { describe, expect, it } from 'vitest';
import {
	aplicarCupon,
	CATALOGO_BASE_2026 as BASE,
	CATALOGO_NOV_2026 as NOV,
	catalogoDeLicencia,
	catalogoEn,
	codigoPlan,
	CORTE_PRECIOS_MS,
	montoExtras,
	montoUpgrade,
	precioAnual,
	prorrateo,
	RE_CUPON,
	reglaExtras,
	reglasEmpresas
} from '../../sut/sitio-pagos/pagos';

describe('F3 · catálogo vigente según la fecha (corte 1-nov-2026 00:00 Colombia)', () => {
	it.each([
		['CP-F3-01', 'VL · 1 ms antes del corte', CORTE_PRECIOS_MS - 1, 'base-2026'],
		['CP-F3-02', 'VL · justo en el corte', CORTE_PRECIOS_MS, 'nov-2026'],
		['CP-F3-03', '31-oct 23:59:59 en Colombia', Date.parse('2026-10-31T23:59:59-05:00'), 'base-2026'],
		['CP-F3-04', '1-nov 00:00 en Colombia', Date.parse('2026-11-01T00:00:00-05:00'), 'nov-2026'],
		['CP-F3-05', 'PE inválida · fecha NaN', Number.NaN, 'base-2026']
	])('%s %s', (_id, _desc, instante, id) => {
		expect(catalogoEn(instante).id).toBe(id);
	});

	it.each([
		['CP-F3-06', 'VL · periodo que empezó el 31-oct', { start_date: '2026-10-31' }, 'base-2026'],
		['CP-F3-07', 'VL · periodo que empezó el 1-nov', { start_date: '2026-11-01' }, 'nov-2026'],
		['CP-F3-08', 'renovada por anticipado: manda periodo_desde', { start_date: '2026-01-01', periodo_desde: '2026-11-15' }, 'nov-2026'],
		['CP-F3-09', 'PE inválida · fecha sin ceros', { start_date: '2026-11-1' }, 'base-2026'],
		['CP-F3-10', 'PE inválida · fecha vacía', { start_date: '' }, 'base-2026']
	])('%s catalogoDeLicencia · %s', (_id, _desc, lic, id) => {
		expect(catalogoDeLicencia(lic).id).toBe(id);
	});
});

describe('F3 · precioAnual', () => {
	it.each([
		['CP-F3-11', 'Pyme base (1 empresa)', BASE, 'PYME', 1, 150_000],
		['CP-F3-12', 'Pyme + 2 adicionales a 50 000', BASE, 'PYME', 3, 250_000],
		['CP-F3-13', 'VL · Pyme + 20 adicionales a 75 000 (catálogo nov.)', NOV, 'PYME', 21, 1_700_000],
		['CP-F3-14', 'Contador con su base exacta', NOV, 'CONT', 5, 350_000],
		['CP-F3-15', 'menos empresas que la base no rebaja el precio', NOV, 'CONT', 3, 350_000],
		['CP-F3-16', 'Ultra', NOV, 'ULTRA', 50, 1_400_000]
	] as const)('%s %s', (_id, _desc, cat, plan, empresas, precio) => {
		expect(precioAnual(cat, plan, empresas)).toBe(precio);
	});
});

describe('F3 · aplicarCupon (valores límite del porcentaje)', () => {
	it.each([
		['CP-F3-17', 'VL · 0 %', 200_000, 0, 200_000],
		['CP-F3-18', '10 %', 200_000, 10, 180_000],
		['CP-F3-19', 'VL · 100 %: no se cobra nada', 200_000, 100, 0],
		['CP-F3-20', 'VL · 101 % se limita a 100 %', 200_000, 101, 0],
		['CP-F3-21', 'VL · negativo se limita a 0 %', 200_000, -10, 200_000],
		['CP-F3-22', 'PE inválida · NaN equivale a 0 %', 200_000, Number.NaN, 200_000],
		['CP-F3-23', 'redondeo a peso entero (15 000,5 → 15 001)', 150_005, 10, 135_004]
	])('%s %s', (_id, _desc, monto, pct, esperado) => {
		expect(aplicarCupon(monto, pct)).toBe(esperado);
	});

	it.each([
		['CP-F3-24', 'VL · 4 caracteres, el mínimo', 'ABCD', true],
		['CP-F3-25', 'VL · 3 caracteres', 'ABC', false],
		['CP-F3-26', 'VL · 20 caracteres, el máximo', 'A'.repeat(20), true],
		['CP-F3-27', 'VL · 21 caracteres', 'A'.repeat(21), false],
		['CP-F3-28', 'PE inválida · minúsculas', 'promo10', false],
		['CP-F3-29', 'PE inválida · guion', 'PRO-10', false]
	])('%s formato de cupón · %s', (_id, _desc, cupon, valido) => {
		expect(RE_CUPON.test(cupon)).toBe(valido);
	});
});

describe('F3 · reglasEmpresas (tabla de decisión: flujo × plan × cantidad)', () => {
	it.each([
		['CP-F3-30', 'registro', 'PYME', undefined, true, 1],
		['CP-F3-31', 'registro', 'PYME', 2, false, null],
		['CP-F3-32', 'registro', 'CONT', 5, true, 5],
		['CP-F3-33', 'compra', 'CONT', 6, false, null],
		['CP-F3-34', 'compra', 'PYME', 1, true, 1],
		['CP-F3-35', 'compra', 'PYME', 21, true, 21],
		['CP-F3-36', 'compra', 'PYME', 22, false, null],
		['CP-F3-37', 'compra', 'PYME', 0, false, null],
		['CP-F3-38', 'compra', 'PYME', '3', true, 3],
		['CP-F3-39', 'compra', 'PYME', 'tres', false, null],
		['CP-F3-40', 'compra', 'PYME', 2.5, false, null]
	] as const)('%s %s · %s · %s empresas', (_id, flujo, plan, empresas, ok, n) => {
		const r = reglasEmpresas(NOV, flujo, plan, empresas);
		expect(r.ok).toBe(ok);
		if (r.ok) expect(r.empresas).toBe(n);
		else expect(r.codigo).toBe('empresas_invalidas');
	});

	it('CP-F3-41 el mensaje de rechazo explica la regla al usuario', () => {
		expect(reglasEmpresas(NOV, 'registro', 'PYME', 2)).toMatchObject({
			mensaje: 'Las empresas adicionales se compran después de crear la cuenta.'
		});
		expect(reglasEmpresas(NOV, 'compra', 'CONT', 6)).toMatchObject({
			mensaje: 'El Plan Contador incluye 5 empresas; para más, sube de plan.'
		});
	});
});

describe('F3 · reglaExtras (empresas adicionales sobre una licencia)', () => {
	it.each([
		['CP-F3-42', 'VL · 0', 'Plan Pyme', 0, 'cantidad_invalida'],
		['CP-F3-43', 'VL · 1', 'Plan Pyme', 1, null],
		['CP-F3-44', 'VL · 20', 'Plan Pyme', 20, null],
		['CP-F3-45', 'VL · 21', 'Plan Pyme', 21, 'cantidad_invalida'],
		['CP-F3-46', 'solo aplica al Plan Pyme', 'Plan Contador', 1, 'extras_solo_pyme'],
		['CP-F3-47', 'sin licencia', null, 1, 'extras_solo_pyme']
	])('%s %s', (_id, _desc, licencia, cantidad, rechazo) => {
		const r = reglaExtras(licencia, cantidad);
		if (rechazo === null) expect(r).toEqual({ ok: true, cantidad });
		else expect(r).toMatchObject({ ok: false, codigo: rechazo });
	});

	it('CP-F3-48 codigoPlan acepta código o nombre y no confunde propiedades del objeto', () => {
		expect(codigoPlan('PYME')).toBe('PYME');
		expect(codigoPlan('Plan Contador Pro')).toBe('PRO');
		expect(codigoPlan('constructor')).toBeNull();
		expect(codigoPlan(42)).toBeNull();
	});
});

describe('F3 · prorrateo del upgrade y de las empresas adicionales', () => {
	const lic = { start_date: '2026-01-01', end_date: '2027-01-01' };
	const en = (iso: string) => new Date(iso);

	it.each([
		['CP-F3-49', 'VL · primer instante del periodo', '2026-01-01T00:00:00Z', 365],
		['CP-F3-50', 'mitad del año, a medianoche', '2026-07-02T00:00:00Z', 183],
		['CP-F3-51', 'un día empezado ya cuenta como transcurrido', '2026-07-02T12:00:00Z', 182],
		['CP-F3-52', 'VL · licencia vencida', '2027-02-01T00:00:00Z', 0]
	])('%s %s', (_id, _desc, ahora, restantes) => {
		expect(prorrateo(lic, en(ahora))).toEqual({ totalDias: 365, diasRestantes: restantes });
	});

	it('CP-F3-53 PE inválida · fechas mal formadas no cobran nada', () => {
		expect(prorrateo({ start_date: 'x', end_date: '2027-01-01' }, en('2026-06-01T00:00:00Z'))).toEqual({
			totalDias: 1,
			diasRestantes: 0
		});
	});

	it('CP-F3-54 upgrade Pyme → Contador a mitad de año: paga la diferencia proporcional', () => {
		expect(montoUpgrade(BASE, lic, 'PYME', 'CONT', en('2026-07-02T00:00:00Z'))).toEqual({
			totalDias: 365,
			diasRestantes: 183,
			credito: 75_205, // 183/365 × 150 000
			proporcional: 125_342, // 183/365 × 250 000
			monto: 50_137,
			tolerancia: 822 // 3 días de diferencia de precio
		});
	});

	it('CP-F3-55 VL · upgrade el primer día: paga la diferencia completa', () => {
		expect(montoUpgrade(BASE, lic, 'PYME', 'CONT', en('2026-01-01T00:00:00Z')).monto).toBe(100_000);
	});

	it('CP-F3-56 VL · upgrade con la licencia vencida: no cobra', () => {
		expect(montoUpgrade(BASE, lic, 'PYME', 'CONT', en('2027-02-01T00:00:00Z')).monto).toBe(0);
	});

	it('CP-F3-57 2 empresas adicionales a mitad de año', () => {
		expect(montoExtras(BASE, lic, 2, en('2026-07-02T00:00:00Z'))).toEqual({
			totalDias: 365,
			diasRestantes: 183,
			monto: 50_137, // 183/365 × 50 000 × 2
			tolerancia: 822
		});
	});
});
