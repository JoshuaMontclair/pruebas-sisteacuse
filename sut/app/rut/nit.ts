/**
 * Dígito de verificación (DV) del NIT colombiano, con los pesos oficiales de la
 * DIAN (módulo 11): se multiplican los dígitos del NIT, de derecha a izquierda,
 * por 3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67 y 71; el residuo de
 * la suma entre 11 da el DV (si el residuo es 0 o 1, el DV es ese residuo; si
 * no, 11 - residuo).
 *
 * Módulo puro (sin dependencias): lo usan el formulario, el lector del RUT y las
 * pruebas. La Edge Function `solicitar-factura` tiene su propia copia en
 * `validar.ts`: si se cambia algo aquí, se cambia allá.
 */

const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/** Deja solo los dígitos (quita puntos, espacios y guiones). */
export function soloDigitos(s: string): string {
	return (s ?? '').replace(/\D/g, '');
}

/**
 * NIT con formato válido: de 6 a 10 dígitos y sin 0 inicial. No incluye el DV.
 */
export function nitValido(nit: string): boolean {
	return /^[1-9]\d{5,9}$/.test(nit ?? '');
}

/**
 * Calcula el DV. Devuelve null si el NIT no tiene formato válido.
 * Vectores: 1020304050 → 8 (inventado), 800197268 → 4.
 */
export function calcularDV(nit: string): number | null {
	if (!nitValido(nit)) return null;
	let suma = 0;
	for (let i = 0; i < nit.length; i++) {
		const digito = nit.charCodeAt(nit.length - 1 - i) - 48;
		suma += digito * PESOS[i];
	}
	const residuo = suma % 11;
	return residuo > 1 ? 11 - residuo : residuo;
}

/** true si el DV corresponde al NIT. */
export function dvCoincide(nit: string, dv: number | string | null | undefined): boolean {
	if (dv === null || dv === undefined || dv === '') return false;
	const n = typeof dv === 'number' ? dv : Number(String(dv).trim());
	if (!Number.isInteger(n) || n < 0 || n > 9) return false;
	return calcularDV(nit) === n;
}

/** Formato de lectura: 900.123.456-8 (solo para mostrar). */
export function formatearNit(nit: string, dv?: number | null): string {
	const d = soloDigitos(nit);
	const conPuntos = d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return dv === null || dv === undefined ? conPuntos : `${conPuntos}-${dv}`;
}
