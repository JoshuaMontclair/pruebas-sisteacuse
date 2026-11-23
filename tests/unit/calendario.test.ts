// F2 · Calendario tributario: festivos de Colombia, días hábiles y vencimientos
//      por último dígito del NIT (Decreto 2229 de 2023)
// Código bajo prueba: sut/app/calendario/festivos.ts y plazos.ts
//
// Técnicas: valores límite (VL) sobre la Pascua y los días hábiles, particiones
// de equivalencia (PE) sobre el tipo de día, y prueba contra oráculo: la tabla
// 2026 de Actualícese copiada a mano del PDF (tests/fixtures/).

import { beforeAll, describe, expect, it } from 'vitest';
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
		['CP-F2-06 VL · fecha más temprana posible (22 mar)', 2285, '2285-03-22'],
		// Años con a = año mod 19 = 0 (2014, 2033) o con la corrección m = 1 del
		// algoritmo (2049, 2076): las ramas que los años anteriores no ejercitan.
		// Encontrados con pruebas de mutación; fechas de las tablas publicadas.
		['CP-F2-31 año con a = 0', 2014, '2014-04-20'],
		['CP-F2-32 año con a = 0', 2033, '2033-04-17'],
		['CP-F2-33 año con corrección m = 1', 2049, '2049-04-18'],
		['CP-F2-34 año con corrección m = 1', 2076, '2076-04-19'],
		['CP-F2-35 Pascua en marzo', 2005, '2005-03-27'],
		['CP-F2-36 Pascua el 1 de abril, en el borde entre marzo y abril', 2029, '2029-04-01']
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
		expect(() => diaHabil(2026, 2, 21)).toThrow('2026-02 no tiene 21 días hábiles');
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
	// La tabla viene de una fuente publicada, pero no es independiente del
	// código: plazos.ts se escribió y se ajustó contra esta misma tabla. Las
	// fechas de los anticipos bimestrales del Régimen Simple tienen los meses
	// inferidos de un encabezado mal extraído del PDF: no se usan como oráculo
	// y quedan como caso pendiente (CP-F2-25).
	// Se calcula en beforeAll y no al declarar las pruebas: si el código falla,
	// fallan las pruebas (y Stryker lo cuenta como detectado), no la carga.
	let motor: ReturnType<typeof calendarioDelAnio>;
	beforeAll(() => {
		motor = calendarioDelAnio(2026);
	});
	const esAnticipo = (nombre: string) => nombre.startsWith('Anticipo');

	it('CP-F2-23 las mismas obligaciones, en el mismo orden', () => {
		expect(motor.map((o) => o.id)).toEqual(OBLIGACIONES_2026.map((o) => o.id));
	});

	// Un caso con una ejecución por obligación: CP-F2-24.1 … CP-F2-24.7.
	OBLIGACIONES_2026.forEach((esperada, n) => {
		const sinAnticipos = esperada.id === 'regimen-simple' ? ' (sin los anticipos, pendientes)' : '';
		it(`CP-F2-24.${n + 1} ${esperada.nombre}${sinAnticipos}: todas las fechas coinciden`, () => {
			const calculada = motor.find((o) => o.id === esperada.id)!;
			expect(calculada.periodos).toHaveLength(esperada.periodos.length);
			esperada.periodos.forEach((pe, i) => {
				if (esAnticipo(pe.nombre)) return;
				const fechas = Object.fromEntries(calculada.periodos[i].vencimientos.map((v) => [v.digito, v.fecha]));
				for (const v of pe.vencimientos) {
					expect(fechas[v.digito], `«${pe.nombre}» dígito ${v.digito}`).toBe(v.fecha);
				}
			});
		});
	});

	it.todo('CP-F2-25 pendiente · las 60 fechas de los anticipos del Régimen Simple, contra el Decreto 2229 de 2023');
});

describe('F2 · «calendario 2027» = lo que vence dentro de 2027', () => {
	let vence2027: ReturnType<typeof vencimientosDelAnio>;
	let todas: string[];
	beforeAll(() => {
		vence2027 = vencimientosDelAnio(2027);
		todas = vence2027.flatMap((o) => o.periodos.flatMap((p) => p.vencimientos.map((v) => v.fecha)));
	});

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
	// Dos casos con una ejecución por año: CP-F2-26.1 … 26.3 y CP-F2-27.1 … 27.3.
	[2026, 2027, 2028].forEach((anio, n) => {
		it(`CP-F2-26.${n + 1} ${anio}: todo vence en día hábil`, () => {
			for (const ob of calendarioDelAnio(anio)) {
				for (const p of ob.periodos) {
					for (const v of p.vencimientos) {
						expect(esDiaHabil(v.fecha), `${ob.id} «${p.nombre}» dígito ${v.digito}: ${v.fecha}`).toBe(true);
					}
				}
			}
		});

		it(`CP-F2-27.${n + 1} ${anio}: con escala por último dígito, las fechas crecen del 1 al 0`, () => {
			for (const ob of calendarioDelAnio(anio).filter((o) => o.tipoDigito === 'ultimo1')) {
				for (const p of ob.periodos) {
					const fechas = p.vencimientos.map((v) => v.fecha);
					expect(fechas, `${ob.id} «${p.nombre}»`).toEqual([...fechas].sort());
					expect(p.vencimientos.map((v) => v.digito)).toEqual([...DIGITOS]);
				}
			}
		});
	});
});

// Lo que la persona ve y lo que la app guarda de cada periodo: la clave es la
// llave con la que se registra si ya se presentó o pagó (no puede cambiar), y
// el tipo de dígito decide si la fecha se busca con el último o los dos últimos
// dígitos del NIT. Agregados a partir de las pruebas de mutación.
describe('F2 · claves, nombres y tipo de dígito de cada periodo (2026)', () => {
	let cal: ReturnType<typeof calendarioDelAnio>;
	beforeAll(() => {
		cal = calendarioDelAnio(2026);
	});
	const ob = (id: string) => cal.find((o) => o.id === id)!;
	const claves = (id: string) => ob(id).periodos.map((p) => p.clave);
	const nombres = (id: string) => ob(id).periodos.map((p) => p.nombre);

	it('CP-F2-37 renta de personas naturales usa los dos últimos dígitos; las demás, el último (Decreto 2229 de 2023)', () => {
		expect(Object.fromEntries(cal.map((o) => [o.id, o.tipoDigito]))).toEqual({
			retencion: 'ultimo1',
			'iva-bimestral': 'ultimo1',
			'iva-cuatrimestral': 'ultimo1',
			'renta-juridicas': 'ultimo1',
			'renta-grandes': 'ultimo1',
			'renta-naturales': 'ultimo2',
			'regimen-simple': 'ultimo1'
		});
	});

	it('CP-F2-38 claves estables: mes, bimestre, cuatrimestre, anticipo y año gravable', () => {
		expect(claves('retencion')).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`));
		expect(claves('iva-bimestral')).toEqual(['2026-B1', '2026-B2', '2026-B3', '2026-B4', '2026-B5', '2026-B6']);
		expect(claves('iva-cuatrimestral')).toEqual(['2026-C1', '2026-C2', '2026-C3']);
		expect(claves('renta-juridicas')).toEqual(['AG2025-C1', 'AG2025-C2']);
		expect(claves('renta-grandes')).toEqual(['AG2025-C1', 'AG2025-C2', 'AG2025-C3']);
		expect(claves('renta-naturales')).toEqual(['AG2025']);
		expect(claves('regimen-simple')).toEqual([
			'2026-A1', '2026-A2', '2026-A3', '2026-A4', '2026-A5', '2026-A6', 'AG2025-IVA', 'AG2025-DEC'
		]);
	});

	it('CP-F2-39 cada periodo dice qué mes cubre y en qué mes vence, con el año solo si cambia', () => {
		const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
		const vence = (i: number) => (i === 11 ? 'enero 2027' : MESES[i + 1].toLowerCase());
		expect(nombres('retencion')).toEqual(MESES.map((m, i) => `${m} 2026 (vence en ${vence(i)})`));
		expect(nombres('iva-bimestral')).toEqual([
			'Enero-Febrero 2026 (vence en marzo)',
			'Marzo-Abril 2026 (vence en mayo)',
			'Mayo-Junio 2026 (vence en julio)',
			'Julio-Agosto 2026 (vence en septiembre)',
			'Septiembre-Octubre 2026 (vence en noviembre)',
			'Noviembre-Diciembre 2026 (vence en enero 2027)'
		]);
		expect(nombres('iva-cuatrimestral')).toEqual([
			'Enero-Abril 2026 (vence en mayo)',
			'Mayo-Agosto 2026 (vence en septiembre)',
			'Septiembre-Diciembre 2026 (vence en enero 2027)'
		]);
		// Art. 1.6.1.13.2.52: los anticipos del Simple no vencen al mes siguiente.
		expect(nombres('regimen-simple').slice(0, 6)).toEqual([
			'Anticipo enero-febrero 2026 (vence en mayo)',
			'Anticipo marzo-abril 2026 (vence en junio)',
			'Anticipo mayo-junio 2026 (vence en julio)',
			'Anticipo julio-agosto 2026 (vence en septiembre)',
			'Anticipo septiembre-octubre 2026 (vence en noviembre)',
			'Anticipo noviembre-diciembre 2026 (vence en enero 2027)'
		]);
		expect(nombres('renta-naturales')).toEqual(['Declaración y pago año gravable 2025']);
	});

	it('CP-F2-40 el tope de 41 UVT de renta jurídicas se muestra en pesos solo si se conoce la UVT del año', () => {
		// UVT 2026 = $52.374: 41 × 52.374 = 2.147.334, redondeado a miles.
		expect(ob('renta-juridicas').descripcion).toContain('menor a 41 UVT ($2.147.000)');
		expect(ob('renta-juridicas').descripcion).toContain('obras por impuestos tienen plazo hasta el 2026-05-29');
		const de2027 = calendarioDelAnio(2027).find((o) => o.id === 'renta-juridicas')!.descripcion;
		expect(de2027).toContain('menor a 41 UVT, el pago');
		expect(de2027).not.toContain('obras por impuestos');
		expect(de2027.endsWith('vence en la fecha de la cuota 1.')).toBe(true);
	});

	it('CP-F2-41 nombres de las obligaciones y de sus cuotas, como en el calendario publicado', () => {
		expect(cal.map((o) => o.nombre)).toEqual([
			'Retención en la fuente',
			'IVA bimestral',
			'IVA cuatrimestral',
			'Renta personas jurídicas y demás',
			'Renta grandes contribuyentes',
			'Renta personas naturales',
			'Régimen Simple de Tributación'
		]);
		expect(nombres('renta-juridicas')).toEqual(['Cuota 1 (declaración y pago)', 'Cuota 2 (solo pago)']);
		expect(nombres('renta-grandes')).toEqual(['Cuota 1 (solo pago)', 'Cuota 2 (declaración y pago)', 'Cuota 3 (solo pago)']);
		expect(nombres('regimen-simple').slice(6)).toEqual([
			'IVA anual consolidado del Simple (año gravable 2025)',
			'Declaración anual del Simple (año gravable 2025)'
		]);
	});
});

// Instantánea (golden master) de los textos de cada obligación: etiqueta corta,
// frecuencia, artículo citado, color y descripción. No sale de una fuente
// externa: es lo que muestra hoy la app, revisado a mano por el equipo, y sirve
// para detectar cualquier cambio no intencional en lo que ve el contador.
// Se agregó porque Stryker mostró que ninguna prueba protegía estos textos.
describe('F2 · textos que ve la persona (instantánea revisada)', () => {
	it('CP-F2-42 etiqueta, frecuencia, artículo, color y descripción de cada obligación de 2026', () => {
		const textos = calendarioDelAnio(2026).map(({ id, nombreCorto, frecuencia, norma, color, descripcion }) => ({
			id, nombreCorto, frecuencia, norma, color, descripcion
		}));
		expect(textos).toEqual([
			{ id: 'retencion', nombreCorto: 'Retención', frecuencia: 'Mensual', norma: '1.6.1.13.2.33', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300', descripcion: 'Declaración y pago mensual de retención en la fuente. Aplica también para autorretención, impuesto de timbre e IVA retenido.' },
			{ id: 'iva-bimestral', nombreCorto: 'IVA bim.', frecuencia: 'Bimestral', norma: '1.6.1.13.2.30', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300', descripcion: 'Para grandes contribuyentes y responsables de IVA con ingresos brutos de 2025 iguales o superiores a 92.000 UVT. También aplica al impuesto nacional al consumo (INC).' },
			{ id: 'iva-cuatrimestral', nombreCorto: 'IVA cuatri.', frecuencia: 'Cuatrimestral', norma: '1.6.1.13.2.31', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300', descripcion: 'Para responsables de IVA con ingresos brutos de 2025 inferiores a 92.000 UVT.' },
			{ id: 'renta-juridicas', nombreCorto: 'Renta jurídicas', frecuencia: 'Anual (2 cuotas)', norma: '1.6.1.13.2.12', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300', descripcion: 'Año gravable 2025. La cuota 1 es declaración y pago; la cuota 2 es solo pago. Si el saldo a pagar es menor a 41 UVT ($2.147.000), el pago vence en la fecha de la cuota 1. Quienes soliciten obras por impuestos tienen plazo hasta el 2026-05-29.' },
			{ id: 'renta-grandes', nombreCorto: 'Renta grandes', frecuencia: 'Anual (3 cuotas)', norma: '1.6.1.13.2.11', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300', descripcion: 'Año gravable 2025. Cuota 1 solo pago; cuota 2 declaración y pago (y anticipo cuota 1 de puntos adicionales); cuota 3 solo pago (y anticipo cuota 2 de puntos adicionales).' },
			{ id: 'renta-naturales', nombreCorto: 'Renta naturales', frecuencia: 'Anual', norma: '1.6.1.13.2.15', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300', descripcion: 'Año gravable 2025. La fecha depende de los dos últimos dígitos del NIT o cédula; cada par de números comparte fecha.' },
			{ id: 'regimen-simple', nombreCorto: 'Simple', frecuencia: 'Bimestral y anual', norma: '1.6.1.13.2.50 a 1.6.1.13.2.52', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300', descripcion: 'Anticipos bimestrales, declaración anual consolidada e IVA anual consolidado del Simple. Las personas naturales del Simple con ingresos de hasta 3.500 UVT no pagan anticipos, solo la declaración anual.' },
		]);
	});
});
