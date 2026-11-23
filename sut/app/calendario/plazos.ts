/**
 * Plazos tributarios nacionales calculados con las reglas del Decreto 2229 de
 * 2023 (DUR 1625 de 2016, libro 1, parte 6, título 1, capítulo 13), que fija
 * los plazos «para el año 2024 y en adelante para cada año subsiguiente».
 *
 * Cada plazo se expresa como el N-ésimo día hábil de un mes según el último
 * dígito del NIT (o los dos últimos, en renta de personas naturales). Aquí se
 * escribe la regla una vez y las fechas de cualquier año salen de ella; antes
 * se copiaban a mano de una tabla del año.
 *
 * Validación: `scripts/test-calendario.mjs` comprueba que estas reglas dan
 * exactamente las fechas de la tabla 2026 publicada por Actualícese
 * (`scripts/fixtures/calendario-2026-actualicese.ts`).
 *
 * Si la DIAN modifica el decreto o da un plazo especial, la excepción se
 * agrega aquí con su norma; las demás fechas no cambian.
 *
 * Sin dependencias ni servicios externos: corre igual en el navegador, en el
 * servidor y en una página prerenderizada.
 */

import { diaHabil } from './festivos';

export type TipoDigito = 'ultimo1' | 'ultimo2';

export interface Vencimiento {
	digito: string;
	fecha: string; // YYYY-MM-DD
}

export interface Periodo {
	/**
	 * Identificador estable del periodo dentro de su obligación: no cambia
	 * aunque cambie el nombre que se muestra. Es la llave con la que se
	 * guarda el estado (presentada, pagada…) en `obligacion_estado`.
	 *   2027-01 mes · 2027-B1 bimestre · 2027-C1 cuatrimestre ·
	 *   2027-A1 anticipo del Simple · AG2026, AG2026-C1, AG2026-IVA,
	 *   AG2026-DEC para las anuales (AG = año gravable).
	 */
	clave: string;
	nombre: string;
	vencimientos: Vencimiento[];
}

export interface Obligacion {
	id: string;
	nombre: string;
	nombreCorto: string;
	frecuencia: string;
	descripcion: string;
	color: string; // clases de Tailwind para la etiqueta
	tipoDigito: TipoDigito;
	norma: string; // artículo del DUR 1625 de 2016 (modificado por el Decreto 2229 de 2023)
	periodos: Periodo[];
}

/** Años que la interfaz ofrece. Las reglas sirven para cualquiera. */
export const ANIOS_CALENDARIO = [2026, 2027] as const;

// ---------------------------------------------------------------------------
// Escalas por dígito
// ---------------------------------------------------------------------------

/** Orden de los dígitos en las tablas del decreto. */
export const DIGITOS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;

/** Escala general: dígito 1 → 7.º día hábil … dígito 0 → 16.º. */
const ESCALA_GENERAL: Record<string, number> = {
	'1': 7,
	'2': 8,
	'3': 9,
	'4': 10,
	'5': 11,
	'6': 12,
	'7': 13,
	'8': 14,
	'9': 15,
	'0': 16
};

/** Escala por pares del Régimen Simple anual (arts. 1.6.1.13.2.50 y .51). */
const ESCALA_PARES_SIMPLE: Record<string, number> = {
	'1': 11,
	'2': 11,
	'3': 12,
	'4': 12,
	'5': 13,
	'6': 13,
	'7': 14,
	'8': 14,
	'9': 15,
	'0': 15
};

/**
 * Renta de personas naturales (art. 1.6.1.13.2.15): cada par de los dos
 * últimos dígitos tiene un mes y un día hábil. 01-02 → 7.º de agosto …
 * 25-26 → 19.º de agosto; 27-28 → 1.º de septiembre … 65-66 → 20.º;
 * 67-68 → 1.º de octubre … 99-00 → 17.º de octubre.
 */
function plazoPersonasNaturales(par: number): { mesRelativo: 8 | 9 | 10; n: number } {
	// par: 1 = «01-02», 2 = «03-04», … 50 = «99-00».
	if (par <= 13) return { mesRelativo: 8, n: par + 6 };
	if (par <= 33) return { mesRelativo: 9, n: par - 13 };
	return { mesRelativo: 10, n: par - 33 };
}

// ---------------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------------

const MESES = [
	'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
	'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mes de vencimiento, con el año solo si cambia. Ej.: «enero 2027». */
function venceEn(anioPeriodo: number, anio: number, mes: number): string {
	return anio === anioPeriodo ? MESES[mes - 1] : `${MESES[mes - 1]} ${anio}`;
}

/** Mes siguiente a `mes` (1-12) del año `anio`. */
function mesSiguiente(anio: number, mes: number): [number, number] {
	return mes === 12 ? [anio + 1, 1] : [anio, mes + 1];
}

function periodoGeneral(clave: string, nombre: string, anio: number, mes: number): Periodo {
	return {
		clave,
		nombre,
		vencimientos: DIGITOS.map((d) => ({ digito: d, fecha: diaHabil(anio, mes, ESCALA_GENERAL[d]) }))
	};
}

function periodoParesSimple(clave: string, nombre: string, anio: number, mes: number): Periodo {
	return {
		clave,
		nombre,
		vencimientos: DIGITOS.map((d) => ({
			digito: d,
			fecha: diaHabil(anio, mes, ESCALA_PARES_SIMPLE[d])
		}))
	};
}

// ---------------------------------------------------------------------------
// Datos que cambian por año (no son plazos)
// ---------------------------------------------------------------------------

/** UVT conocida por año; solo se usa para mostrar montos en pesos. */
const UVT: Record<number, number> = {
	2026: 52_374
};

function enPesos(uvt: number, anio: number): string {
	const valor = UVT[anio];
	if (!valor) return `${uvt} UVT`;
	const pesos = Math.round((uvt * valor) / 1000) * 1000;
	return `${uvt} UVT ($${pesos.toLocaleString('es-CO')})`;
}

/** Notas de un solo año (plazos especiales publicados aparte). */
const NOTA_RENTA_JURIDICAS: Record<number, string> = {
	2026: ' Quienes soliciten obras por impuestos tienen plazo hasta el 2026-05-29.'
};

// ---------------------------------------------------------------------------
// Reglas por obligación
// ---------------------------------------------------------------------------

/**
 * Obligaciones de un calendario anual, en la misma forma en que se publican
 * los calendarios (y la tabla de Actualícese con la que se valida):
 *
 *   - las periódicas (retención, IVA, anticipos del Simple) son los periodos
 *     del año `anio`; el último vence en enero de `anio + 1`;
 *   - las anuales (renta, Simple anual, IVA anual del Simple) son las del año
 *     gravable `anio - 1`, que se declaran en `anio`.
 */
export function calendarioDelAnio(anio: number): Obligacion[] {
	const gravable = anio - 1;

	const retencion: Periodo[] = Array.from({ length: 12 }, (_, i) => {
		const mes = i + 1;
		const [a, m] = mesSiguiente(anio, mes);
		const clave = `${anio}-${String(mes).padStart(2, '0')}`;
		return periodoGeneral(clave, `${mayuscula(MESES[i])} ${anio} (vence en ${venceEn(anio, a, m)})`, a, m);
	});

	const bimestres: Periodo[] = Array.from({ length: 6 }, (_, i) => {
		const ultimoMes = (i + 1) * 2;
		const [a, m] = mesSiguiente(anio, ultimoMes);
		const nombre = `${mayuscula(MESES[ultimoMes - 2])}-${mayuscula(MESES[ultimoMes - 1])} ${anio} (vence en ${venceEn(anio, a, m)})`;
		return periodoGeneral(`${anio}-B${i + 1}`, nombre, a, m);
	});

	const cuatrimestres: Periodo[] = Array.from({ length: 3 }, (_, i) => {
		const ultimoMes = (i + 1) * 4;
		const [a, m] = mesSiguiente(anio, ultimoMes);
		const nombre = `${mayuscula(MESES[ultimoMes - 4])}-${mayuscula(MESES[ultimoMes - 1])} ${anio} (vence en ${venceEn(anio, a, m)})`;
		return periodoGeneral(`${anio}-C${i + 1}`, nombre, a, m);
	});

	// Art. 1.6.1.13.2.52: los anticipos del Simple no vencen todos al mes
	// siguiente: ene-feb en mayo, mar-abr en junio, may-jun en julio,
	// jul-ago en septiembre, sep-oct en noviembre y nov-dic en enero.
	const MES_ANTICIPO_SIMPLE = [5, 6, 7, 9, 11, 13];
	const anticiposSimple: Periodo[] = MES_ANTICIPO_SIMPLE.map((mesVence, i) => {
		const [a, m] = mesVence === 13 ? [anio + 1, 1] : [anio, mesVence];
		const nombre = `Anticipo ${MESES[i * 2]}-${MESES[i * 2 + 1]} ${anio} (vence en ${venceEn(anio, a, m)})`;
		return periodoGeneral(`${anio}-A${i + 1}`, nombre, a, m);
	});

	const rentaNaturales: Periodo = {
		clave: `AG${gravable}`,
		nombre: `Declaración y pago año gravable ${gravable}`,
		vencimientos: Array.from({ length: 50 }, (_, i) => {
			const par = i + 1;
			const { mesRelativo, n } = plazoPersonasNaturales(par);
			const fecha = diaHabil(anio, mesRelativo, n);
			const primero = String((par * 2 - 1) % 100).padStart(2, '0');
			const segundo = String((par * 2) % 100).padStart(2, '0');
			return [
				{ digito: primero, fecha },
				{ digito: segundo, fecha }
			];
		}).flat()
	};

	return [
		{
			id: 'retencion',
			nombre: 'Retención en la fuente',
			nombreCorto: 'Retención',
			frecuencia: 'Mensual',
			descripcion:
				'Declaración y pago mensual de retención en la fuente. Aplica también para autorretención, impuesto de timbre e IVA retenido.',
			color: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
			tipoDigito: 'ultimo1',
			norma: '1.6.1.13.2.33',
			periodos: retencion
		},
		{
			id: 'iva-bimestral',
			nombre: 'IVA bimestral',
			nombreCorto: 'IVA bim.',
			frecuencia: 'Bimestral',
			descripcion: `Para grandes contribuyentes y responsables de IVA con ingresos brutos de ${gravable} iguales o superiores a 92.000 UVT. También aplica al impuesto nacional al consumo (INC).`,
			color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
			tipoDigito: 'ultimo1',
			norma: '1.6.1.13.2.30',
			periodos: bimestres
		},
		{
			id: 'iva-cuatrimestral',
			nombre: 'IVA cuatrimestral',
			nombreCorto: 'IVA cuatri.',
			frecuencia: 'Cuatrimestral',
			descripcion: `Para responsables de IVA con ingresos brutos de ${gravable} inferiores a 92.000 UVT.`,
			color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
			tipoDigito: 'ultimo1',
			norma: '1.6.1.13.2.31',
			periodos: cuatrimestres
		},
		{
			id: 'renta-juridicas',
			nombre: 'Renta personas jurídicas y demás',
			nombreCorto: 'Renta jurídicas',
			frecuencia: 'Anual (2 cuotas)',
			descripcion:
				`Año gravable ${gravable}. La cuota 1 es declaración y pago; la cuota 2 es solo pago. Si el saldo a pagar es menor a ${enPesos(41, anio)}, el pago vence en la fecha de la cuota 1.` +
				(NOTA_RENTA_JURIDICAS[anio] ?? ''),
			color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
			tipoDigito: 'ultimo1',
			norma: '1.6.1.13.2.12',
			periodos: [
				periodoGeneral(`AG${gravable}-C1`, 'Cuota 1 (declaración y pago)', anio, 5),
				periodoGeneral(`AG${gravable}-C2`, 'Cuota 2 (solo pago)', anio, 7)
			]
		},
		{
			id: 'renta-grandes',
			nombre: 'Renta grandes contribuyentes',
			nombreCorto: 'Renta grandes',
			frecuencia: 'Anual (3 cuotas)',
			descripcion: `Año gravable ${gravable}. Cuota 1 solo pago; cuota 2 declaración y pago (y anticipo cuota 1 de puntos adicionales); cuota 3 solo pago (y anticipo cuota 2 de puntos adicionales).`,
			color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
			tipoDigito: 'ultimo1',
			norma: '1.6.1.13.2.11',
			periodos: [
				periodoGeneral(`AG${gravable}-C1`, 'Cuota 1 (solo pago)', anio, 2),
				periodoGeneral(`AG${gravable}-C2`, 'Cuota 2 (declaración y pago)', anio, 4),
				periodoGeneral(`AG${gravable}-C3`, 'Cuota 3 (solo pago)', anio, 6)
			]
		},
		{
			id: 'renta-naturales',
			nombre: 'Renta personas naturales',
			nombreCorto: 'Renta naturales',
			frecuencia: 'Anual',
			descripcion: `Año gravable ${gravable}. La fecha depende de los dos últimos dígitos del NIT o cédula; cada par de números comparte fecha.`,
			color: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
			tipoDigito: 'ultimo2',
			norma: '1.6.1.13.2.15',
			periodos: [rentaNaturales]
		},
		{
			id: 'regimen-simple',
			nombre: 'Régimen Simple de Tributación',
			nombreCorto: 'Simple',
			frecuencia: 'Bimestral y anual',
			descripcion:
				'Anticipos bimestrales, declaración anual consolidada e IVA anual consolidado del Simple. Las personas naturales del Simple con ingresos de hasta 3.500 UVT no pagan anticipos, solo la declaración anual.',
			color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
			tipoDigito: 'ultimo1',
			norma: '1.6.1.13.2.50 a 1.6.1.13.2.52',
			periodos: [
				...anticiposSimple,
				periodoParesSimple(`AG${gravable}-IVA`, `IVA anual consolidado del Simple (año gravable ${gravable})`, anio, 2),
				periodoParesSimple(`AG${gravable}-DEC`, `Declaración anual del Simple (año gravable ${gravable})`, anio, 4)
			]
		}
	];
}

/**
 * Lo que vence DENTRO del año `anio`, que es lo que la gente espera de un
 * «calendario 2027»: incluye lo de enero que viene de periodos del año
 * anterior (retención de diciembre, último bimestre de IVA, etc.) y deja por
 * fuera lo que ya vence en enero del año siguiente.
 */
export function vencimientosDelAnio(anio: number): Obligacion[] {
	const previo = calendarioDelAnio(anio - 1);
	const actual = calendarioDelAnio(anio);
	const prefijo = `${anio}-`;

	return actual.map((ob, i) => {
		const deAntes = previo[i].periodos;
		const periodos = [...deAntes, ...ob.periodos]
			.map((p) => ({ ...p, vencimientos: p.vencimientos.filter((v) => v.fecha.startsWith(prefijo)) }))
			.filter((p) => p.vencimientos.length > 0);
		return { ...ob, periodos };
	});
}
