// F1 · Validación del NIT y cálculo del dígito de verificación (DV)
// Código bajo prueba: sut/app/rut/nit.ts
//
// Técnicas: particiones de equivalencia (PE), valores límite (VL) y tabla de
// decisión (TD). Los DV esperados de NIT reales son los publicados por cada
// entidad en su RUT; los de residuo 0 y 1 se calcularon a mano con los pesos
// de la DIAN para cubrir las dos ramas especiales del módulo 11.

import { describe, expect, it } from 'vitest';
import { calcularDV, dvCoincide, formatearNit, nitValido, soloDigitos } from '../../sut/app/rut/nit';

describe('F1 · nitValido: formato del NIT (sin DV)', () => {
	it.each([
		['CP-F1-01', 'PE válida · 9 dígitos', '800197268', true],
		['CP-F1-02', 'VL · 6 dígitos, el mínimo', '100000', true],
		['CP-F1-03', 'VL · 10 dígitos, el máximo', '9999999999', true],
		['CP-F1-04', 'VL · 5 dígitos, uno menos del mínimo', '99999', false],
		['CP-F1-05', 'VL · 11 dígitos, uno más del máximo', '10000000000', false],
		['CP-F1-06', 'PE inválida · empieza en 0', '0800197268', false],
		['CP-F1-07', 'PE inválida · con puntos', '800.197.268', false],
		['CP-F1-08', 'PE inválida · con DV pegado con guion', '800197268-4', false],
		['CP-F1-09', 'PE inválida · letras', '80019726A', false],
		['CP-F1-10', 'PE inválida · vacío', '', false]
	])('%s %s', (_id, _desc, nit, esperado) => {
		expect(nitValido(nit)).toBe(esperado);
	});

	it('CP-F1-11 PE inválida · null o undefined no revientan', () => {
		expect(nitValido(null as unknown as string)).toBe(false);
		expect(nitValido(undefined as unknown as string)).toBe(false);
	});
});

describe('F1 · calcularDV: módulo 11 de la DIAN', () => {
	it.each([
		['CP-F1-12', 'DIAN', '800197268', 4],
		['CP-F1-13', 'Banco Davivienda', '860034313', 7],
		['CP-F1-14', 'Bancolombia', '890903938', 8],
		['CP-F1-15', 'Ecopetrol (residuo 1 → DV 1)', '899999068', 1],
		['CP-F1-16', 'residuo 0 → DV 0', '900000009', 0],
		['CP-F1-17', 'residuo 1 → DV 1', '900000002', 1],
		['CP-F1-18', 'VL · NIT de 10 dígitos', '1020304050', 8],
		['CP-F1-19', 'VL · NIT de 6 dígitos', '100000', 1]
	])('%s %s: %s → %i', (_id, _desc, nit, dv) => {
		expect(calcularDV(nit)).toBe(dv);
	});

	it('CP-F1-20 un NIT con formato inválido no tiene DV (null)', () => {
		expect(calcularDV('12345')).toBeNull();
		expect(calcularDV('800.197.268')).toBeNull();
	});

	it('CP-F1-21 el DV siempre está entre 0 y 9 (10 000 NIT consecutivos)', () => {
		for (let n = 900_000_000; n < 900_010_000; n++) {
			const dv = calcularDV(String(n));
			expect(dv).not.toBeNull();
			expect(dv).toBeGreaterThanOrEqual(0);
			expect(dv).toBeLessThanOrEqual(9);
		}
	});
});

describe('F1 · dvCoincide: tabla de decisión del DV digitado', () => {
	it.each([
		['CP-F1-22', 'DV correcto como número', 4, true],
		['CP-F1-23', 'DV correcto como texto', '4', true],
		['CP-F1-24', 'DV correcto con espacios', ' 4 ', true],
		['CP-F1-25', 'DV incorrecto', 5, false],
		['CP-F1-26', 'VL · DV negativo', -1, false],
		['CP-F1-27', 'VL · DV de dos cifras', 10, false],
		['CP-F1-28', 'DV decimal', 4.5, false],
		['CP-F1-29', 'DV con letras', 'A', false],
		['CP-F1-30', 'DV vacío', '', false],
		['CP-F1-31', 'DV null', null, false],
		['CP-F1-32', 'DV undefined', undefined, false]
	])('%s %s', (_id, _desc, dv, esperado) => {
		expect(dvCoincide('800197268', dv as number | string | null | undefined)).toBe(esperado);
	});

	it('CP-F1-33 con un NIT inválido nunca coincide, aunque el DV "parezca" bueno', () => {
		expect(dvCoincide('0800197268', 4)).toBe(false);
	});
});

describe('F1 · formato de lectura', () => {
	it('CP-F1-34 soloDigitos quita puntos, guiones y espacios', () => {
		expect(soloDigitos(' 800.197.268-4 ')).toBe('8001972684');
	});

	it('CP-F1-35 formatearNit agrupa de a tres y agrega el DV si se da', () => {
		expect(formatearNit('800197268', 4)).toBe('800.197.268-4');
		expect(formatearNit('800197268')).toBe('800.197.268');
		expect(formatearNit('1020304050', 0)).toBe('1.020.304.050-0');
	});
});
