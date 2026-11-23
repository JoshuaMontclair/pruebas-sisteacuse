// Convierte los resultados JUnit de la última ejecución en tablas LaTeX para
// el reporte de ejecución (anexo del documento de la entrega).
//
//   npm test && node scripts/reporte-latex.mjs <carpeta-de-salida>
//
// Escribe:
//   resumen.tex          macros con los totales (\totalUnitarias, \totalEjecucionesEtoE, …)
//   tabla-unitarias.tex  una fila por prueba unitaria
//   tabla-e2e.tex        una fila por caso E2E, con el resultado en cada navegador
//   tabla-stryker.tex    puntaje de mutación de Stryker por archivo
//   tabla-mutantes.tex   mutantes dirigidos (scripts/mutantes.mjs)

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

// Un caso parametrizado lleva un sufijo por ejecución (CP-F2-24.3): para contar
// casos se usa el identificador sin el sufijo.
const ID = /\b(CP-F\d-E?\d+(?:\.\d+)?|DEF-\d+)\b/;
const base = (id) => id.replace(/\.\d+$/, '');

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
// Un defecto conocido «pasa» mientras exista; un caso pendiente (it.todo) no corre.
const celda = (id, r) =>
	r === 'Omitida' && id.startsWith('DEF-')
		? '\\textcolor{gris}{No aplica}'
		: id.startsWith('DEF-')
		? `\\textcolor{naranja}{${r === 'Pasó' ? 'Defecto confirmado' : 'Defecto corregido'}}`
		: r === 'Omitida'
			? '\\textcolor{gris}{Pendiente}'
			: marca(r);

// ── Unitarias ───────────────────────────────────────────────────────────
const unitarias = casos('reportes/unitarias/junit.xml');
const ordenId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
const filasU = unitarias
	.map((c) => ({ ...c, ...partir(c.nombre) }))
	.sort(ordenId)
	.map((c) => {
	const { id, descripcion } = c;
	return `${latex(id)} & ${latex(descripcion)} & ${celda(id, c.resultado)} & ${(c.segundos * 1000).toFixed(1)}\\\\`;
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
		`${latex(f.id)} & ${latex(f.descripcion)} & ${celda(f.id, f.resultados['escritorio-chromium'] ?? '—')} & ${celda(
			f.id,
			f.resultados['movil-iphone'] ?? '—'
		)} & ${(f.segundos * 1000).toFixed(0)}\\\\`
);
writeFileSync(join(salida, 'tabla-e2e.tex'), filasE.join('\n') + '\n');

// ── Totales ─────────────────────────────────────────────────────────────
// Casos = identificadores distintos; ejecuciones = cada corrida (un caso
// parametrizado o en dos navegadores cuenta una vez como caso). Los defectos
// (DEF-xx) y los casos pendientes (it.todo) se cuentan aparte.
const cuenta = (lista, pred) => lista.filter(pred).length;
const idDe = (c) => partir(c.nombre).id;
const esDefecto = (c) => idDe(c).startsWith('DEF-');
const esPendiente = (c) => c.resultado === 'Omitida';
const funcional = (c) => !esDefecto(c) && !esPendiente(c);
const pasa = (c) => c.resultado === 'Pasó';
const distintos = (lista) => new Set(lista.map((c) => base(idDe(c))).filter(Boolean)).size;
const uF = unitarias.filter(funcional);
const eF = e2e.filter(funcional);
const de = (lista, f) => lista.filter((c) => idDe(c).startsWith(`CP-${f}-`));
const macros = {
	casosFUno: distintos(de(uF, 'F1')),
	casosFDos: distintos(de(uF, 'F2')),
	casosFTres: distintos(de(uF, 'F3')),
	casosFTresEtoE: distintos(de(eF, 'F3')),
	casosFCuatro: distintos(de(eF, 'F4')),
	casosFuncionales: distintos(uF) + distintos(eF),
	ejecucionesFuncionales: uF.length + eF.length,
	aprobadasFuncionales: cuenta(uF, pasa) + cuenta(eF, pasa),
	casosPendientes: distintos(unitarias.filter((c) => esPendiente(c) && !esDefecto(c))),
	defectosDistintos: distintos([...unitarias, ...e2e].filter(esDefecto)),
	pruebasDefectos: cuenta(unitarias, (c) => esDefecto(c) && !esPendiente(c)) + cuenta(e2e, (c) => esDefecto(c) && !esPendiente(c)),
	pruebasDefectosEtoE: cuenta(e2e, (c) => esDefecto(c) && !esPendiente(c)),
	totalUnitarias: unitarias.filter((c) => !esPendiente(c)).length,
	unitariasFuncionales: uF.length,
	unitariasAprobadas: cuenta(uF, pasa),
	unitariasFallidas: cuenta(uF, (c) => !pasa(c)),
	unitariasFUno: de(uF, 'F1').length,
	unitariasFDos: de(uF, 'F2').length,
	unitariasFTres: de(uF, 'F3').length,
	casosEtoE: distintos(eF),
	totalEjecucionesEtoE: eF.length,
	etoEAprobadas: cuenta(eF, pasa),
	etoEFallidas: cuenta(eF, (c) => !pasa(c)),
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

// ── Cobertura en alcance (npm run cobertura:f3) ──────────────────────────
const coma = (x, d = 1) => x.toFixed(d).replace('.', '{,}');
const extra = {};
try {
	const c = JSON.parse(readFileSync('reportes/cobertura/en-alcance.json', 'utf8'));
	Object.assign(extra, {
		coberturaFunciones: `${c.ejecutadas}/${c.funciones}`,
		coberturaSentencias: coma(c.sentencias),
		coberturaRamas: coma(c.ramas),
		coberturaMinFuncion: c.minimo.funcion,
		coberturaMinRamas: coma(c.minimo.ramas)
	});
} catch {
	console.warn('Sin reportes/cobertura/en-alcance.json: corre npm run cobertura:f3.');
}

// ── Stryker (npm run test:mutacion) ─────────────────────────────────────
try {
	const r = JSON.parse(readFileSync('reportes/mutacion/resumen.json', 'utf8'));
	Object.assign(extra, {
		mutGenerados: r.generados,
		mutInvalidos: r.invalidos,
		mutValidos: r.validos,
		mutDetectados: r.detectados,
		mutSobrevivientes: r.sobrevivientes,
		mutEquivalentes: r.equivalentes,
		mutPuntaje: coma(r.puntaje),
		mutPuntajeSinEq: coma(r.puntajeSinEquivalentes),
		mutMinimoArchivo: coma(r.minimoPorArchivo)
	});
	const filas = r.porArchivo.map(
		(f) =>
			`\\texttt{${latex(f.archivo.replace('sut/app/', '').replace('sut/', ''))}} & ${f.generados} & ${f.invalidos} & ${f.validos} & ${f.detectados} & ${f.sobrevivientes} & ${f.equivalentes} & ${coma(f.puntaje)}\\,\\% & ${coma(f.puntajeSinEquivalentes)}\\,\\%\\\\`
	);
	writeFileSync(join(salida, 'tabla-stryker.tex'), filas.join('\n') + '\n');
} catch {
	console.warn('Sin reportes/mutacion/resumen.json: corre npm run test:mutacion.');
}

// ── Mutantes dirigidos (npm run test:mutantes) ──────────────────────────
try {
	const m = JSON.parse(readFileSync('reportes/mutantes.json', 'utf8'));
	const estado = (r) =>
		r.equivalente
			? '\\textcolor{gris}{Equivalente}'
			: r.resultado === 'eliminado'
				? '\\textcolor{verde}{Detectado}'
				: '\\textcolor{rojo}{No detectado}';
	const filas = [...m.resultados]
		.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
		.map((r) => `${r.id} & ${r.func} & \\texttt{${latex(r.archivo.replace('sut/app/', '').replace('sut/', ''))}} & ${latex(r.descripcion)} & ${estado(r)}\\\\`);
	writeFileSync(join(salida, 'tabla-mutantes.tex'), filas.join('\n') + '\n');
	Object.assign(extra, { mutantesDetectados: m.eliminados, mutantesTotal: m.total });
} catch {
	console.warn('Sin reportes/mutantes.json: corre npm run test:mutantes para la tabla de mutantes dirigidos.');
}

writeFileSync(
	join(salida, 'mutantes.tex'),
	Object.entries(extra)
		.map(([k, v]) => `\\newcommand{\\${k}}{${v}}`)
		.join('\n') + '\n'
);
console.log(extra);
