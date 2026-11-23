// Convierte los resultados JUnit de la última ejecución en tablas LaTeX para
// el reporte de ejecución (anexo del documento de la entrega).
//
//   npm test && node scripts/reporte-latex.mjs <carpeta-de-salida>
//
// Escribe:
//   resumen.tex          macros con los totales (\totalUnitarias, \totalEjecucionesEtoE, …)
//   tabla-unitarias.tex  una fila por prueba unitaria
//   tabla-e2e.tex        una fila por caso E2E, con el resultado en cada navegador

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const salida = process.argv[2];
if (!salida) {
	console.error('uso: node scripts/reporte-latex.mjs <carpeta-de-salida>');
	process.exit(1);
}
mkdirSync(salida, { recursive: true });

const entidades = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const desescapar = (s) => s.replace(/&(lt|gt|quot|apos|amp);/g, (m) => entidades[m]);

/** Casos de un archivo JUnit: { suite, nombre, segundos, resultado }. */
function casos(ruta) {
	const xml = readFileSync(ruta, 'utf8');
	const lista = [];
	for (const suite of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
		const atributos = suite[1];
		const proyecto = /hostname="([^"]*)"/.exec(atributos)?.[1] ?? '';
		for (const caso of suite[2].matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
			const nombre = desescapar(/\sname="([^"]*)"/.exec(caso[1])[1]);
			const segundos = Number(/time="([^"]*)"/.exec(caso[1])?.[1] ?? 0);
			const cuerpo = caso[3] ?? '';
			const resultado = /<(failure|error)\b/.test(cuerpo) ? 'Falló' : /<skipped\b/.test(cuerpo) ? 'Omitida' : 'Pasó';
			lista.push({ proyecto, nombre, segundos, resultado });
		}
	}
	return lista;
}

function latex(s) {
	return s
		.replace(/\\/g, '\\textbackslash{}')
		.replace(/([&%$#_{}])/g, '\\$1')
		.replace(/~/g, '\\textasciitilde{}')
		.replace(/\^/g, '\\textasciicircum{}')
		.replace(/→/g, '$\\rightarrow$')
		.replace(/≤/g, '$\\leq$')
		.replace(/×/g, '$\\times$')
		.replace(/–/g, '--')
		.replace(/[“”]/g, '"');
}

const ID = /\b(CP-F\d-E?\d+|DEF-\d+)\b/;

function partir(nombre) {
	const partes = nombre.split(' > ');
	const caso = partes.at(-1);
	const id = ID.exec(caso)?.[1] ?? ID.exec(nombre)?.[1] ?? '';
	let descripcion = caso.replace(id, '').replace(/^\s*[·:]?\s*/, '').trim();
	// Se antepone el grupo (la función, el paso o el defecto) para que cada fila
	// se entienda sola.
	if (partes.length > 1) {
		const grupo = partes[0].replace(/^(F\d|DEF-\d+) · (F\d · )?/, '');
		descripcion = `${grupo}: ${descripcion}`;
	}
	return { id, descripcion };
}

const marca = (r) => (r === 'Pasó' ? '\\textcolor{verde}{Pasó}' : `\\textcolor{rojo}{${r}}`);

// ── Unitarias ───────────────────────────────────────────────────────────
const unitarias = casos('reportes/unitarias/junit.xml');
const ordenId = (a, b) => a.id.localeCompare(b.id, 'es', { numeric: true });
const filasU = unitarias
	.map((c) => ({ ...c, ...partir(c.nombre) }))
	.sort(ordenId)
	.map((c) => {
	const { id, descripcion } = c;
	const defecto = id.startsWith('DEF-');
	const resultado = defecto ? (c.resultado === 'Pasó' ? 'Defecto confirmado' : 'Defecto corregido') : c.resultado;
	const celda = defecto ? `\\textcolor{naranja}{${resultado}}` : marca(resultado);
	return `${latex(id)} & ${latex(descripcion)} & ${celda} & ${(c.segundos * 1000).toFixed(1)}\\\\`;
});
writeFileSync(join(salida, 'tabla-unitarias.tex'), filasU.join('\n') + '\n');

// ── E2E: un caso, dos navegadores ───────────────────────────────────────
const e2e = casos('reportes/e2e/junit.xml');
const porCaso = new Map();
for (const c of e2e) {
	const { id, descripcion } = partir(c.nombre);
	const fila = porCaso.get(c.nombre) ?? { id, descripcion, resultados: {}, segundos: 0 };
	fila.resultados[c.proyecto] = c.resultado;
	fila.segundos += c.segundos;
	porCaso.set(c.nombre, fila);
}
const filasE = [...porCaso.values()].sort(ordenId).map(
	(f) =>
		`${latex(f.id)} & ${latex(f.descripcion)} & ${marca(f.resultados['escritorio-chromium'] ?? '—')} & ${marca(
			f.resultados['movil-iphone'] ?? '—'
		)} & ${(f.segundos * 1000).toFixed(0)}\\\\`
);
writeFileSync(join(salida, 'tabla-e2e.tex'), filasE.join('\n') + '\n');

// ── Totales ─────────────────────────────────────────────────────────────
const cuenta = (lista, pred) => lista.filter(pred).length;
const esDefecto = (c) => partir(c.nombre).id.startsWith('DEF-');
const porFuncionalidad = (f) => cuenta(unitarias, (c) => partir(c.nombre).id.startsWith(`CP-${f}-`));
// Casos = identificadores distintos; ejecuciones = cada corrida (un caso
// parametrizado o en dos navegadores cuenta una vez como caso).
const casosDistintos = (lista, pred = () => true) => new Set(lista.map((c) => partir(c.nombre).id).filter((id) => id && pred(id))).size;
const esFuncional = (id) => !id.startsWith('DEF-');
const casosUnit = (f) => casosDistintos(unitarias, (id) => id.startsWith(`CP-${f}-`));
const etoEDe = (f) => casosDistintos(e2e, (id) => id.startsWith(`CP-${f}-`));
const macros = {
	casosFUno: casosUnit('F1'),
	casosFDos: casosUnit('F2'),
	casosFTres: casosUnit('F3'),
	casosFTresEtoE: etoEDe('F3'),
	casosFCuatro: etoEDe('F4'),
	casosFuncionales: casosDistintos(unitarias, esFuncional) + casosDistintos(e2e, esFuncional),
	ejecucionesFuncionales: cuenta(unitarias, (c) => !esDefecto(c)) + e2e.length,
	aprobadasFuncionales:
		cuenta(unitarias, (c) => !esDefecto(c) && c.resultado === 'Pasó') + cuenta(e2e, (c) => c.resultado === 'Pasó'),
	defectosDistintos: casosDistintos(unitarias, (id) => id.startsWith('DEF-')),
	totalUnitarias: unitarias.length,
	unitariasAprobadas: cuenta(unitarias, (c) => !esDefecto(c) && c.resultado === 'Pasó'),
	unitariasFallidas: cuenta(unitarias, (c) => !esDefecto(c) && c.resultado !== 'Pasó'),
	pruebasDefectos: cuenta(unitarias, esDefecto),
	unitariasFUno: porFuncionalidad('F1'),
	unitariasFDos: porFuncionalidad('F2'),
	unitariasFTres: porFuncionalidad('F3'),
	casosEtoE: porCaso.size,
	totalEjecucionesEtoE: e2e.length,
	etoEAprobadas: cuenta(e2e, (c) => c.resultado === 'Pasó'),
	etoEFallidas: cuenta(e2e, (c) => c.resultado !== 'Pasó'),
	tiempoUnitarias: unitarias.reduce((s, c) => s + c.segundos, 0).toFixed(2),
	tiempoEtoE: e2e.reduce((s, c) => s + c.segundos, 0).toFixed(1)
};
writeFileSync(
	join(salida, 'resumen.tex'),
	Object.entries(macros)
		.map(([k, v]) => `\\newcommand{\\${k}}{${v}}`)
		.join('\n') + '\n'
);
console.log(macros);

// ── Mutantes (si se corrió npm run test:mutantes) ───────────────────────
try {
	const m = JSON.parse(readFileSync('reportes/mutantes.json', 'utf8'));
	const estado = (r) =>
		r.equivalente
			? '\\textcolor{gris}{Equivalente}'
			: r.resultado === 'eliminado'
				? '\\textcolor{verde}{Detectado}'
				: '\\textcolor{rojo}{No detectado}';
	const filas = [...m.resultados]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((r) => `${r.id} & ${r.func} & \\texttt{${latex(r.archivo.replace('sut/', ''))}} & ${latex(r.descripcion)} & ${estado(r)}\\\\`);
	writeFileSync(join(salida, 'tabla-mutantes.tex'), filas.join('\n') + '\n');
	writeFileSync(
		join(salida, 'mutantes.tex'),
		`\\newcommand{\\mutantesDetectados}{${m.eliminados}}\n\\newcommand{\\mutantesTotal}{${m.total}}\n`
	);
} catch {
	console.warn('Sin reportes/mutantes.json: corre npm run test:mutantes para la tabla de mutantes.');
}
