// Resumen de las pruebas de mutación de Stryker (reportes/mutacion/mutation.json).
//
// Stryker genera los mutantes solo, sin que el equipo los escoja. Este script
// cuenta los resultados y cruza los sobrevivientes con la revisión manual de
// tests/mutacion/clasificacion.json (mutantes equivalentes).
//
// Criterio de salida S5 (termina con error si no se cumple):
//   - puntaje de Stryker de todo el código en alcance ≥ 90 %, y
//   - en cada archivo, puntaje sin los equivalentes ≥ 90 %, y
//   - ningún sobreviviente sin prueba ni justificación.
//
//   npx stryker run && node scripts/mutacion-resumen.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const reporte = JSON.parse(readFileSync('reportes/mutacion/mutation.json', 'utf8'));
const { reglas } = JSON.parse(readFileSync('tests/mutacion/clasificacion.json', 'utf8'));

const DETECTADO = new Set(['Killed', 'Timeout']);
const SOBREVIVE = new Set(['Survived', 'NoCoverage']);
const INVALIDO = new Set(['RuntimeError', 'CompileError']);

const porArchivo = [];
const sinClasificar = [];
const total = { generados: 0, invalidos: 0, validos: 0, detectados: 0, sobrevivientes: 0, equivalentes: 0, presentacion: 0 };

for (const [archivo, datos] of Object.entries(reporte.files)) {
	const lineas = datos.source.split('\n');
	const f = { archivo, generados: 0, invalidos: 0, validos: 0, detectados: 0, sobrevivientes: 0, equivalentes: 0, presentacion: 0 };
	for (const m of datos.mutants) {
		f.generados += 1;
		if (INVALIDO.has(m.status)) { f.invalidos += 1; continue; }
		f.validos += 1;
		if (DETECTADO.has(m.status)) { f.detectados += 1; continue; }
		if (!SOBREVIVE.has(m.status)) continue;
		f.sobrevivientes += 1;
		const linea = m.location.start.line;
		const regla = reglas.find(
			(r) =>
				r.archivo === archivo &&
				(!r.lineas || r.lineas.includes(linea)) &&
				(!r.mutador || r.mutador === m.mutatorName) &&
				(!r.patron || new RegExp(r.patron).test(lineas[linea - 1]))
		);
		if (regla) f[regla.tipo === 'equivalente' ? 'equivalentes' : 'presentacion'] += 1;
		else sinClasificar.push(`${archivo}:${linea} ${m.mutatorName} → ${m.replacement}`);
	}
	for (const k of Object.keys(total)) total[k] += f[k];
	porArchivo.push(f);
}

const UMBRAL = 90;
const pct = (a, b) => (b === 0 ? 100 : (100 * a) / b);
const resumen = {
	...total,
	puntaje: pct(total.detectados, total.validos),
	puntajeSinEquivalentes: pct(total.detectados, total.validos - total.equivalentes),
	porArchivo: porArchivo.map((f) => ({
		...f,
		puntaje: pct(f.detectados, f.validos),
		puntajeSinEquivalentes: pct(f.detectados, f.validos - f.equivalentes)
	})),
	sinClasificar
};
resumen.minimoPorArchivo = Math.min(...resumen.porArchivo.map((f) => f.puntajeSinEquivalentes));
mkdirSync('reportes/mutacion', { recursive: true });
writeFileSync('reportes/mutacion/resumen.json', JSON.stringify(resumen, null, 2));

console.log(`Mutantes generados por Stryker: ${total.generados} (${total.invalidos} no compilan o no corren: no cuentan)`);
console.log(`Válidos: ${total.validos} · detectados: ${total.detectados} · sobreviven: ${total.sobrevivientes}`);
console.log(`Puntaje de mutación (Stryker): ${resumen.puntaje.toFixed(1)} %`);
console.log(`Sobrevivientes revisados: ${total.equivalentes} equivalentes`);
console.log('Por archivo (puntaje · sin equivalentes):');
for (const f of resumen.porArchivo)
	console.log(`  ${f.archivo.padEnd(34)} ${f.puntaje.toFixed(1).padStart(5)} % · ${f.puntajeSinEquivalentes.toFixed(1).padStart(5)} %  (${f.detectados}/${f.validos})`);
const cumple = resumen.puntaje >= UMBRAL && resumen.minimoPorArchivo >= UMBRAL && !sinClasificar.length;
console.log(`\nS5 (≥ ${UMBRAL} % en total y, sin equivalentes, en cada archivo): ${cumple ? 'cumple' : 'NO cumple'}`);
if (!cumple) process.exitCode = 1;
if (sinClasificar.length) {
	console.error(`\n${sinClasificar.length} sobreviviente(s) sin prueba ni justificación:`);
	for (const s of sinClasificar) console.error('  ' + s);
	process.exitCode = 1;
}
