// Pruebas de mutación: ¿la suite detecta errores reales en el código?
//
// Cada mutante cambia UNA cosa del código bajo prueba (sut/), del tipo de error
// que comete una persona: un peso mal copiado, un < por un <=, un redondeo
// distinto, la hora de corte sin la zona horaria. Para cada uno se corren las
// pruebas unitarias (sin las de defectos conocidos); si alguna falla, el
// mutante quedó «eliminado», que es lo que se espera. Al final se restaura el
// código original.
//
//   node scripts/mutantes.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const MUTANTES = [
	// M01 es un mutante EQUIVALENTE: el peso 71 multiplica el dígito 15 y un NIT
	// válido tiene máximo 10 dígitos, así que ninguna prueba puede detectarlo.
	['M01', 'F1', 'sut/app/rut/nit.ts', '59, 67, 71]', '59, 67, 73]', 'Peso 15 del módulo 11 mal copiado (71 → 73)', 'equivalente'],
	['M15', 'F1', 'sut/app/rut/nit.ts', '37, 41, 43, 47, 53, 59, 67, 71] as const', '37, 41, 45, 47, 53, 59, 67, 71] as const', 'Peso 10 del módulo 11 mal copiado (43 → 45)'],
	['M02', 'F1', 'sut/app/rut/nit.ts', 'residuo > 1 ? 11 - residuo', 'residuo > 0 ? 11 - residuo', 'Residuo 1 tratado como los demás'],
	['M03', 'F1', 'sut/app/rut/nit.ts', '/^[1-9]\\d{5,9}$/', '/^[1-9]\\d{4,9}$/', 'NIT de 5 dígitos aceptado'],
	['M04', 'F2', 'sut/app/calendario/festivos.ts', '[-3, -2, 43, 64, 71]', '[-3, -2, 43, 64, 70]', 'Sagrado Corazón un día antes'],
	['M05', 'F2', 'sut/app/calendario/festivos.ts', '(8 - diaSemana(ms)) % 7', '(7 - diaSemana(ms)) % 7', 'Ley Emiliani corre al domingo'],
	['M06', 'F2', 'sut/app/calendario/festivos.ts', 'dia === 0 || dia === 6', 'dia === 0', 'Los sábados cuentan como hábiles'],
	['M07', 'F2', 'sut/app/calendario/plazos.ts', "'0': 16", "'0': 17", 'NIT terminado en 0 vence un día después'],
	['M08', 'F3', 'sut/sitio-pagos/pagos.ts', 'Date.UTC(2026, 10, 1, 5, 0, 0)', 'Date.UTC(2026, 10, 1, 0, 0, 0)', 'Corte de precios en UTC y no en hora de Colombia'],
	['M09', 'F3', 'sut/sitio-pagos/pagos.ts', 'monto - Math.round((monto * p) / 100)', 'monto - Math.floor((monto * p) / 100)', 'Descuento truncado en vez de redondeado'],
	['M10', 'F3', 'sut/sitio-pagos/pagos.ts', 'MAX_EXTRAS_PYME = 20', 'MAX_EXTRAS_PYME = 21', 'Tope de empresas adicionales en 21'],
	['M11', 'F3', 'sut/sitio-pagos/pagos.ts', 'Math.ceil((ahora.getTime() - inicio) / DIA_MS)', 'Math.floor((ahora.getTime() - inicio) / DIA_MS)', 'Un día empezado no cuenta en el prorrateo'],
	['M12', 'F3', 'sut/sitio-pagos/pagos.ts', 'recibidoCents < esperadoCents - toleranciaCents', 'recibidoCents <= esperadoCents - toleranciaCents', 'El borde de la tolerancia se rechaza'],
	['M13', 'F3', 'sut/sitio-pagos/pagos.ts', 'uso.usos >= c.max_usos', 'uso.usos > c.max_usos', 'Un cupón agotado admite un uso más'],
	['M14', 'F3', 'sut/sitio-pagos/pagos.ts', 'inicio >= FECHA_CORTE_PRECIOS', 'inicio > FECHA_CORTE_PRECIOS', 'Licencia del 1-nov con el catálogo anterior']
];

function correrPruebas() {
	try {
		execFileSync('npx', ['vitest', 'run', '--reporter=dot', '--exclude', 'tests/unit/defectos.test.ts'], {
			stdio: 'pipe',
			env: { ...process.env, CI: '1' }
		});
		return 'sobrevivió';
	} catch {
		return 'eliminado';
	}
}

const resultados = [];
for (const [id, func, archivo, original, mutado, descripcion, tipo] of MUTANTES) {
	const codigo = readFileSync(archivo, 'utf8');
	if (!codigo.includes(original)) throw new Error(`${id}: no se encontró «${original}» en ${archivo}`);
	writeFileSync(archivo, codigo.replace(original, mutado));
	let resultado;
	try {
		resultado = correrPruebas();
	} finally {
		writeFileSync(archivo, codigo);
	}
	const equivalente = tipo === 'equivalente';
	resultados.push({ id, func, archivo, descripcion, resultado, equivalente });
	console.log(`${id} ${func} ${resultado.padEnd(10)} ${descripcion}${equivalente ? ' (equivalente)' : ''}`);
}

const validos = resultados.filter((r) => !r.equivalente);
const eliminados = validos.filter((r) => r.resultado === 'eliminado').length;
const puntaje = (100 * eliminados) / validos.length;
console.log(`\n${eliminados} de ${validos.length} mutantes no equivalentes eliminados (${puntaje.toFixed(0)} %)`);
mkdirSync('reportes', { recursive: true });
writeFileSync('reportes/mutantes.json', JSON.stringify({ eliminados, total: validos.length, puntaje, resultados }, null, 2));
process.exitCode = eliminados === validos.length ? 0 : 1;
