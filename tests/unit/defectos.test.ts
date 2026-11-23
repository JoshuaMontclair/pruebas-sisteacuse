// Defectos encontrados durante la automatización (pruebas de caracterización).
//
// Cada prueba fija el comportamiento DEFECTUOSO exacto que tiene hoy el código
// (el valor que devuelve), y su nombre dice cuál sería el correcto. Así:
//   - pasa mientras el defecto exista, y la suite sigue en verde;
//   - solo pasa por el defecto, no por cualquier error: compara el valor exacto;
//   - el día que se corrija, falla y avisa que hay que convertirla en una
//     prueba normal con el resultado correcto.
// Los identificadores (DEF-xx) son los del reporte.

import { describe, expect, it } from 'vitest';
import { esDiaHabil } from '../../sut/app/calendario/festivos';
import { dvCoincide } from '../../sut/app/rut/nit';
import {
	CATALOGO_NOV_2026 as NOV,
	montoExtras,
	montoUpgrade,
	reglaExtras,
	reglasEmpresas
} from '../../sut/sitio-pagos/pagos';

describe('DEF-01 · F3 · el prorrateo no valida que la licencia termine después de empezar', () => {
	// Licencia con las fechas invertidas (dato corrupto): totalDias se fuerza a 1
	// y diasRestantes cuenta desde el inicio, así que el monto se multiplica.
	const invertida = { start_date: '2027-01-01', end_date: '2026-01-01' };
	const ahora = new Date('2026-06-01T00:00:00Z');

	it('1 empresa adicional cotiza $16.125.000 (correcto: rechazo o máximo $75.000)', () => {
		expect(montoExtras(NOV, invertida, 1, ahora)).toMatchObject({ totalDias: 1, diasRestantes: 215, monto: 16_125_000 });
	});

	it('un upgrade Pyme → Contador cotiza $32.250.000 (correcto: rechazo o máximo $150.000)', () => {
		expect(montoUpgrade(NOV, invertida, 'PYME', 'CONT', ahora).monto).toBe(32_250_000);
	});
});

describe('DEF-02 · F3 · las reglas de empresas aceptan valores que no son números enteros', () => {
	// Number() convierte true → 1, [3] → 3, "0x3" → 3 y "1e1" → 10. Lo correcto:
	// aceptar solo enteros o texto con dígitos decimales ("3", como CP-F3-38).
	for (const [valor, convertido] of [
		[true, 1],
		[[3], 3],
		['0x3', 3],
		['1e1', 10]
	] as const) {
		it(`reglasEmpresas acepta ${JSON.stringify(valor)} como ${convertido} (correcto: rechazo)`, () => {
			expect(reglasEmpresas(NOV, 'compra', 'PYME', valor)).toEqual({ ok: true, empresas: convertido });
		});
		it(`reglaExtras acepta ${JSON.stringify(valor)} como ${convertido} (correcto: rechazo)`, () => {
			expect(reglaExtras('Plan Pyme', valor)).toEqual({ ok: true, cantidad: convertido });
		});
	}
});

describe('DEF-03 · F2 · esDiaHabil da por hábiles fechas que no existen', () => {
	for (const fecha of ['2026-02-30', '2026-13-01', '2026-2-3']) {
		it(`«${fecha}» es hábil (correcto: false o error de fecha inválida)`, () => {
			expect(esDiaHabil(fecha)).toBe(true);
		});
	}
});

describe('DEF-04 · F1 · dvCoincide acepta un DV escrito en hexadecimal', () => {
	it('«0x4» coincide con el DV 4 de la DIAN (correcto: false)', () => {
		expect(dvCoincide('800197268', '0x4')).toBe(true);
	});
});
