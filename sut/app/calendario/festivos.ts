/**
 * Festivos de Colombia y días hábiles para los plazos tributarios.
 *
 * El Decreto 2229 de 2023 expresa los plazos como «N-ésimo día hábil» de un
 * mes. Día hábil = lunes a viernes que no sea festivo. Los festivos salen de:
 *
 *   - Fijos: 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic.
 *   - Ley 51 de 1983 (se corren al lunes siguiente si no caen en lunes):
 *     6 ene, 19 mar, 29 jun, 15 ago, 12 oct, 1 nov, 11 nov.
 *   - Dependientes de la Pascua: Jueves y Viernes Santo; Ascensión (+43 días,
 *     ya en lunes), Corpus Christi (+64) y Sagrado Corazón (+71).
 *
 * Todo trabaja con fechas ISO (YYYY-MM-DD) y aritmética en UTC, para que el
 * resultado no dependa de la zona horaria del navegador ni del servidor.
 */

const MS_DIA = 24 * 60 * 60 * 1000;

function utc(anio: number, mes: number, dia: number): number {
	return Date.UTC(anio, mes - 1, dia);
}

function aIso(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
function diaSemana(ms: number): number {
	return new Date(ms).getUTCDay();
}

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano). */
export function domingoDePascua(anio: number): string {
	const a = anio % 19;
	const b = Math.floor(anio / 100);
	const c = anio % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const mes = Math.floor((h + l - 7 * m + 114) / 31);
	const dia = ((h + l - 7 * m + 114) % 31) + 1;
	return aIso(utc(anio, mes, dia));
}

/** El mismo día si es lunes; si no, el lunes siguiente (Ley 51 de 1983). */
function alLunes(ms: number): number {
	const dias = (8 - diaSemana(ms)) % 7;
	return ms + dias * MS_DIA;
}

const cache = new Map<number, ReadonlySet<string>>();

/** Festivos de un año, como conjunto de fechas ISO. */
export function festivosDeColombia(anio: number): ReadonlySet<string> {
	const enCache = cache.get(anio);
	if (enCache) return enCache;

	const fijos: [number, number][] = [
		[1, 1],
		[5, 1],
		[7, 20],
		[8, 7],
		[12, 8],
		[12, 25]
	];
	const trasladables: [number, number][] = [
		[1, 6],
		[3, 19],
		[6, 29],
		[8, 15],
		[10, 12],
		[11, 1],
		[11, 11]
	];
	const pascua = Date.parse(`${domingoDePascua(anio)}T00:00:00Z`);
	const desdePascua = [-3, -2, 43, 64, 71];

	const festivos = new Set<string>();
	for (const [mes, dia] of fijos) festivos.add(aIso(utc(anio, mes, dia)));
	for (const [mes, dia] of trasladables) festivos.add(aIso(alLunes(utc(anio, mes, dia))));
	for (const dias of desdePascua) festivos.add(aIso(pascua + dias * MS_DIA));

	cache.set(anio, festivos);
	return festivos;
}

/** ¿Es día hábil? (lunes a viernes, no festivo). */
export function esDiaHabil(fechaIso: string): boolean {
	const ms = Date.parse(`${fechaIso}T00:00:00Z`);
	const dia = diaSemana(ms);
	if (dia === 0 || dia === 6) return false;
	return !festivosDeColombia(Number(fechaIso.slice(0, 4))).has(fechaIso);
}

/**
 * El n-ésimo día hábil de un mes (n empieza en 1). Lanza error si el mes no
 * tiene tantos días hábiles: una regla así está mal escrita y no debe
 * producir una fecha del mes siguiente en silencio.
 */
export function diaHabil(anio: number, mes: number, n: number): string {
	if (!Number.isInteger(n) || n < 1) throw new Error(`día hábil inválido: ${n}`);
	let ms = utc(anio, mes, 1);
	let cuenta = 0;
	while (new Date(ms).getUTCMonth() === mes - 1) {
		const iso = aIso(ms);
		if (esDiaHabil(iso)) {
			cuenta += 1;
			if (cuenta === n) return iso;
		}
		ms += MS_DIA;
	}
	throw new Error(`${anio}-${String(mes).padStart(2, '0')} no tiene ${n} días hábiles`);
}
