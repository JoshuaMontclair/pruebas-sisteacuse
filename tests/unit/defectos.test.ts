// Defectos encontrados durante la automatización.
//
// Cada prueba escribe el comportamiento CORRECTO y está marcada con `it.fails`:
// hoy falla porque el defecto existe, y la suite sigue en verde. El día que se
// corrija el defecto, `it.fails` empieza a fallar y avisa que hay que pasarla
// a una prueba normal. Los identificadores (DEF-xx) son los del reporte.

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

	it.fails('una empresa adicional no puede costar más que un año de empresa adicional (hoy cotiza $16.125.000)', () => {
		expect(montoExtras(NOV, invertida, 1, ahora).monto).toBeLessThanOrEqual(NOV.empresaAdicional);
	});

	it.fails('un upgrade no puede costar más que la diferencia anual entre planes (hoy cotiza $32.250.000)', () => {
		const diferencia = NOV.planes.CONT.precio - NOV.planes.PYME.precio;
		expect(montoUpgrade(NOV, invertida, 'PYME', 'CONT', ahora).monto).toBeLessThanOrEqual(diferencia);
	});
});

describe('DEF-02 · F3 · las reglas de empresas aceptan valores que no son números enteros', () => {
	// Number() convierte true → 1, [3] → 3, "0x3" → 3 y "1e1" → 10.
	for (const valor of [true, [3], '0x3', '1e1']) {
		it.fails(`reglasEmpresas rechaza ${JSON.stringify(valor)}`, () => {
			expect(reglasEmpresas(NOV, 'compra', 'PYME', valor).ok).toBe(false);
		});
		it.fails(`reglaExtras rechaza ${JSON.stringify(valor)}`, () => {
			expect(reglaExtras('Plan Pyme', valor).ok).toBe(false);
		});
	}
});

describe('DEF-03 · F2 · esDiaHabil da por hábiles fechas que no existen', () => {
	for (const fecha of ['2026-02-30', '2026-13-01', '2026-2-3']) {
		it.fails(`«${fecha}» no es un día hábil`, () => {
			expect(esDiaHabil(fecha)).toBe(false);
		});
	}
});

describe('DEF-04 · F1 · dvCoincide acepta un DV escrito en hexadecimal', () => {
	it.fails('«0x4» no es un dígito de verificación', () => {
		expect(dvCoincide('800197268', '0x4')).toBe(false);
	});
});
