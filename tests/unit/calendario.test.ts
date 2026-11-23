// F2 · Calendario tributario: festivos de Colombia, días hábiles y vencimientos
//      por último dígito del NIT (Decreto 2229 de 2023)
// Código bajo prueba: sut/app/calendario/festivos.ts y plazos.ts
//
// Técnicas: valores límite (VL) sobre la Pascua y los días hábiles, particiones
// de equivalencia (PE) sobre el tipo de día, y prueba contra oráculo: la tabla
// 2026 de Actualícese copiada a mano del PDF (tests/fixtures/).

import { describe, expect, it } from 'vitest';
import { diaHabil, domingoDePascua, esDiaHabil, festivosDeColombia } from '../../sut/app/calendario/festivos';
import { calendarioDelAnio, DIGITOS, vencimientosDelAnio } from '../../sut/app/calendario/plazos';
import { OBLIGACIONES_2026 } from '../fixtures/calendario-2026-actualicese';

describe('F2 · domingoDePascua', () => {
	it.each([
		['CP-F2-01', 2024, '2024-03-31'],
		['CP-F2-02', 2025, '2025-04-20'],
		['CP-F2-03', 2026, '2026-04-05'],
		['CP-F2-04', 2027, '2027-03-28'],
		['CP-F2-05 VL · fecha más tardía posible (25 abr)', 2038, '2038-04-25'],
		['CP-F2-06 VL · fecha más temprana posible (22 mar)', 2285, '2285-03-22']
	])('%s · %i', (_id, anio, fecha) => {
		expect(domingoDePascua(anio)).toBe(fecha);
	});
});

describe('F2 · festivosDeColombia', () => {
	it('CP-F2-07 los 18 festivos oficiales de 2026', () => {
		expect([...festivosDeColombia(2026)].sort()).toEqual([
			'2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
			'2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
			'2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
			'2026-11-16', '2026-12-08', '2026-12-25'
		]);
	});

	it('CP-F2-08 Ley Emiliani: un festivo trasladable que ya cae en lunes no se mueve', () => {
		// 29 jun 2026 y 12 oct 2026 son lunes.
		const f = festivosDeColombia(2026);
		expect(f.has('2026-06-29')).toBe(true);
		expect(f.has('2026-10-12')).toBe(true);
	});

	it('CP-F2-09 Ley Emiliani: uno que cae en domingo pasa al lunes siguiente', () => {
		// 1 nov 2026 es domingo → festivo el lunes 2.
		const f = festivosDeColombia(2026);
		expect(f.has('2026-11-01')).toBe(false);
		expect(f.has('2026-11-02')).toBe(true);
	});

	it('CP-F2-10 VL · dos festivos el mismo día: en 2025 San Pedro y el Sagrado Corazón caen ambos el lunes 30 de junio', () => {
		// 29 jun 2025 es domingo → se corre al 30; Sagrado Corazón = Pascua (20 abr) + 71 = 30 jun.
		// El calendario tiene 18 celebraciones, pero ese año solo 17 fechas festivas distintas.
		const f = festivosDeColombia(2025);
		expect(f.has('2025-06-30')).toBe(true);
		expect(f.has('2025-06-29')).toBe(false);
		expect(f.size).toBe(17);
		for (const anio of [2024, 2026, 2027, 2028]) {
			expect(festivosDeColombia(anio).size, `año ${anio}`).toBe(18);
		}
	});
});

describe('F2 · esDiaHabil: particiones del tipo de día', () => {
	it.each([
		['CP-F2-11', 'PE · martes común', '2026-02-10', true],
		['CP-F2-12', 'PE · sábado', '2026-10-31', false],
		['CP-F2-13', 'PE · domingo', '2026-11-01', false],
		['CP-F2-14', 'PE · festivo en lunes', '2026-03-23', false],
		['CP-F2-15', 'PE · Jueves Santo', '2026-04-02', false],
		['CP-F2-16', 'VL · viernes antes de un festivo', '2026-01-02', true]
	])('%s %s (%s)', (_id, _desc, fecha, esperado) => {
		expect(esDiaHabil(fecha)).toBe(esperado);
	});
});

describe('F2 · diaHabil(año, mes, n)', () => {
	it('CP-F2-17 VL · n = 1: el 1 de enero es festivo, el primer hábil es el 2', () => {
		expect(diaHabil(2026, 1, 1)).toBe('2026-01-02');
	});

	it('CP-F2-18 el 7.º día hábil de febrero de 2026 es el 10', () => {
		expect(diaHabil(2026, 2, 7)).toBe('2026-02-10');
	});

	it('CP-F2-19 VL · el último día hábil del mes sí existe; el siguiente es un error', () => {
		// Febrero de 2026 tiene 20 días hábiles (sin festivos).
		expect(diaHabil(2026, 2, 20)).toBe('2026-02-27');
		expect(() => diaHabil(2026, 2, 21)).toThrow('no tiene 21 días hábiles');
	});

	it.each([
		['CP-F2-20', 'VL · n = 0', 0],
		['CP-F2-21', 'n negativo', -3],
		['CP-F2-22', 'n decimal', 1.5]
	])('%s %s lanza error', (_id, _desc, n) => {
		expect(() => diaHabil(2026, 2, n)).toThrow('día hábil inválido');
	});
});

describe('F2 · vencimientos 2026 contra la tabla de Actualícese (oráculo)', () => {
	const motor = calendarioDelAnio(2026);

	it('CP-F2-23 las mismas obligaciones, en el mismo orden', () => {
		expect(motor.map((o) => o.id)).toEqual(OBLIGACIONES_2026.map((o) => o.id));
	});

	for (const esperada of OBLIGACIONES_2026) {
		it(`CP-F2-24 ${esperada.nombre}: todas las fechas coinciden`, () => {
			const calculada = motor.find((o) => o.id === esperada.id)!;
			expect(calculada.periodos).toHaveLength(esperada.periodos.length);
			esperada.periodos.forEach((pe, i) => {
				const fechas = Object.fromEntries(calculada.periodos[i].vencimientos.map((v) => [v.digito, v.fecha]));
				for (const v of pe.vencimientos) {
					expect(fechas[v.digito], `«${pe.nombre}» dígito ${v.digito}`).toBe(v.fecha);
				}
			});
		});
	}

	it('CP-F2-25 se comparan las 440 fechas publicadas', () => {
		const total = OBLIGACIONES_2026.flatMap((o) => o.periodos).flatMap((p) => p.vencimientos).length;
		expect(total).toBe(440);
	});
});

describe('F2 · «calendario 2027» = lo que vence dentro de 2027', () => {
	const vence2027 = vencimientosDelAnio(2027);
	const todas = vence2027.flatMap((o) => o.periodos.flatMap((p) => p.vencimientos.map((v) => v.fecha)));

	it('CP-F2-28 VL · ninguna fecha cae fuera de 2027', () => {
		expect(todas.length).toBeGreaterThan(0);
		expect(todas.every((f) => f.startsWith('2027-'))).toBe(true);
	});

	it('CP-F2-29 trae la retención de diciembre de 2026, que vence en enero de 2027', () => {
		const retencion = vence2027.find((o) => o.id === calendarioDelAnio(2027)[0].id)!;
		expect(retencion.periodos[0].clave).toBe('2026-12');
		expect(retencion.periodos[0].vencimientos.every((v) => v.fecha.startsWith('2027-01'))).toBe(true);
	});

	it('CP-F2-30 deja por fuera la retención de diciembre de 2027 (vence en enero de 2028)', () => {
		const claves = vence2027.flatMap((o) => o.periodos.map((p) => p.clave));
		expect(claves).not.toContain('2027-12');
	});
});

describe('F2 · propiedades del calendario de cualquier año', () => {
	for (const anio of [2026, 2027, 2028]) {
		it(`CP-F2-26 ${anio}: todo vence en día hábil`, () => {
			for (const ob of calendarioDelAnio(anio)) {
				for (const p of ob.periodos) {
					for (const v of p.vencimientos) {
						expect(esDiaHabil(v.fecha), `${ob.id} «${p.nombre}» dígito ${v.digito}: ${v.fecha}`).toBe(true);
					}
				}
			}
		});

		it(`CP-F2-27 ${anio}: con escala por último dígito, las fechas crecen del 1 al 0`, () => {
			for (const ob of calendarioDelAnio(anio).filter((o) => o.tipoDigito === 'ultimo1')) {
				for (const p of ob.periodos) {
					const fechas = p.vencimientos.map((v) => v.fecha);
					expect(fechas, `${ob.id} «${p.nombre}»`).toEqual([...fechas].sort());
					expect(p.vencimientos.map((v) => v.digito)).toEqual([...DIGITOS]);
				}
			}
		});
	}
});
