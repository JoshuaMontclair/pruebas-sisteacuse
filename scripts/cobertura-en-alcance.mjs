// Cobertura de las funciones de pagos.ts que están en el alcance de F3.
//
// pagos.ts también trae las referencias de pago y la firma de Wompi, que
// quedan fuera del alcance; por eso la cobertura del archivo completo es baja
// y no dice nada de F3. Este script la calcula solo sobre las funciones del
// cotizador, a partir de reportes/cobertura/coverage-final.json.
//
//   npm run test:cobertura && node scripts/cobertura-en-alcance.mjs

import { readFileSync } from 'node:fs';

const EN_ALCANCE = [
	'rigePrecioNuevo', 'catalogoEn', 'catalogoDeLicencia', 'codigoPlan', 'codigoPlanRenovacion',
	'reglasEmpresas', 'reglaExtras', 'precioAnual', 'aplicarCupon', 'prorrateo', 'montoUpgrade', 'montoExtras'
];

const cobertura = JSON.parse(readFileSync('reportes/cobertura/coverage-final.json', 'utf8'));
const archivo = cobertura[Object.keys(cobertura).find((ruta) => ruta.endsWith('sut/sitio-pagos/pagos.ts'))];

const funciones = Object.entries(archivo.fnMap).filter(([, fn]) => EN_ALCANCE.includes(fn.name));
let sentencias = 0, sentenciasCubiertas = 0, ramas = 0, ramasCubiertas = 0;
for (const [, fn] of funciones) {
	const dentro = (loc) => loc.start.line >= fn.loc.start.line && loc.end.line <= fn.loc.end.line;
	for (const [id, st] of Object.entries(archivo.statementMap)) {
		if (!dentro(st)) continue;
		sentencias += 1;
		if (archivo.s[id] > 0) sentenciasCubiertas += 1;
	}
	for (const [id, br] of Object.entries(archivo.branchMap)) {
		if (!dentro(br.loc)) continue;
		for (const veces of archivo.b[id]) {
			ramas += 1;
			if (veces > 0) ramasCubiertas += 1;
		}
	}
}

const ejecutadas = funciones.filter(([id]) => archivo.f[id] > 0).length;
const pct = (a, b) => `${((100 * a) / b).toFixed(1)} %`;
console.log('pagos.ts · funciones del cotizador (F3)');
console.log(`  funciones   ${ejecutadas}/${funciones.length}  ${pct(ejecutadas, funciones.length)}`);
console.log(`  sentencias  ${sentenciasCubiertas}/${sentencias}  ${pct(sentenciasCubiertas, sentencias)}`);
console.log(`  ramas       ${ramasCubiertas}/${ramas}  ${pct(ramasCubiertas, ramas)}`);
