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
	'reglasEmpresas', 'reglaExtras', 'precioAnual', 'aplicarCupon', 'prorrateo', 'montoUpgrade', 'montoExtras',
	'cotizar', 'compararMonto', 'evaluarCupon', 'normalizarCupon', 'reglaRenovacion', 'montoRenovacionCents'
];

const cobertura = JSON.parse(readFileSync('reportes/cobertura/coverage-final.json', 'utf8'));
const archivo = cobertura[Object.keys(cobertura).find((ruta) => ruta.endsWith('sut/sitio-pagos/pagos.ts'))];

const funciones = Object.entries(archivo.fnMap).filter(([, fn]) => EN_ALCANCE.includes(fn.name));
let sentencias = 0, sentenciasCubiertas = 0, ramas = 0, ramasCubiertas = 0;
const detalle = [];
for (const [fid, fn] of funciones) {
	const dentro = (loc) => loc.start.line >= fn.loc.start.line && loc.end.line <= fn.loc.end.line;
	let s = 0, sc = 0, b = 0, bc = 0;
	for (const [id, st] of Object.entries(archivo.statementMap)) {
		if (!dentro(st)) continue;
		s += 1;
		if (archivo.s[id] > 0) sc += 1;
	}
	for (const [id, br] of Object.entries(archivo.branchMap)) {
		if (!dentro(br.loc)) continue;
		for (const veces of archivo.b[id]) {
			b += 1;
			if (veces > 0) bc += 1;
		}
	}
	sentencias += s; sentenciasCubiertas += sc; ramas += b; ramasCubiertas += bc;
	detalle.push({ funcion: fn.name, llamadas: archivo.f[fid], sentencias: `${sc}/${s}`, ramas: `${bc}/${b}` });
}

const ejecutadas = funciones.filter(([id]) => archivo.f[id] > 0).length;
const pct = (a, b) => `${((100 * a) / b).toFixed(1)} %`;
console.log('pagos.ts · funciones del cotizador (F3)');
console.log(`  funciones   ${ejecutadas}/${funciones.length}  ${pct(ejecutadas, funciones.length)}`);
console.log(`  sentencias  ${sentenciasCubiertas}/${sentencias}  ${pct(sentenciasCubiertas, sentencias)}`);
console.log(`  ramas       ${ramasCubiertas}/${ramas}  ${pct(ramasCubiertas, ramas)}`);
console.log('\n  por función:');
for (const d of detalle) console.log(`    ${d.funcion.padEnd(22)} llamadas ${String(d.llamadas).padStart(4)}  sentencias ${d.sentencias.padStart(7)}  ramas ${d.ramas.padStart(7)}`);
