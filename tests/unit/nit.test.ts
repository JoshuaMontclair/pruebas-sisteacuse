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

	it('CP-F1-21 coincide con una segunda implementación del módulo 11 en 2 000 NIT de 6 a 10 dígitos', () => {
		// Segunda implementación, escrita a partir de la regla publicada por la DIAN
		// (RN-02) por el mismo equipo. No es independiente por su autor, sino por el
		// camino de cálculo: pesos como texto, recorrido de izquierda a derecha y
		// residuo calculado aparte, así que un error de índice o de peso en el
		// código no se repetiría aquí.
		const PESOS_DIAN = '71 67 59 53 47 43 41 37 29 23 19 17 13 7 3'.split(' ').map(Number);
		const oraculo = (nit: string) => {
			const pesos = PESOS_DIAN.slice(PESOS_DIAN.length - nit.length);
			const suma = [...nit].reduce((s, d, i) => s + Number(d) * pesos[i], 0);
			const residuo = suma - 11 * Math.floor(suma / 11);
			return residuo === 0 || residuo === 1 ? residuo : 11 - residuo;
		};
		// NIT reproducibles repartidos en todas las longitudes válidas.
		let semilla = 20261127;
		const aleatorio = () => (semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
		for (let i = 0; i < 2000; i++) {
			const largo = 6 + (i % 5);
			const nit = String(1 + Math.floor(aleatorio() * 9)) + String(Math.floor(aleatorio() * 10 ** (largo - 1))).padStart(largo - 1, '0');
			expect(calcularDV(nit), nit).toBe(oraculo(nit));
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

// Casos agregados a partir de las pruebas de mutación (Stryker): cada uno
// cubre un borde que la suite no distinguía.
describe('F1 · bordes del DV (encontrados con pruebas de mutación)', () => {
	it('CP-F1-36 VL · DV 9, el mayor posible: 800000005 → 9 y se acepta', () => {
		// 5×3 + 8×41 = 343; 343 mod 11 = 2; DV = 11 − 2 = 9.
		expect(calcularDV('800000005')).toBe(9);
		expect(dvCoincide('800000005', 9)).toBe(true);
		expect(dvCoincide('800000005', '9')).toBe(true);
	});

	it('CP-F1-37 un DV vacío no coincide aunque el DV real sea 0 (Number("") vale 0)', () => {
		expect(calcularDV('900000009')).toBe(0);
		expect(dvCoincide('900000009', '')).toBe(false);
		expect(dvCoincide('900000009', 0)).toBe(true);
	});

	it('CP-F1-38 soloDigitos y formatearNit con valores nulos', () => {
		expect(soloDigitos(null as unknown as string)).toBe('');
		expect(formatearNit('800197268', null)).toBe('800.197.268');
	});
});
