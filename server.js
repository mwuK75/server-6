// シンプルな Deno KV サンプルサーバー
// 実行: deno run -A --unstable-kv server.js

const kv = await Deno.openKv();

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...CORS_HEADERS },
	});
}

// 連番IDを生成する (pokemon コレクション用)
async function getNextId() {
	const key = ['counter', 'pokemon'];

	// atomic でカウンターを 1 増やす
	const res = await kv.atomic().sum(key, 1n).commit();
	if (!res.ok) {
		console.error('ID の生成に失敗しました', res);
		return null;
	}

	const counter = await kv.get(key);
	// もし何らかの理由で null なら 1 を返す
	return counter && counter.value != null ? Number(counter.value) : 1;
}

// シンプルなルーティング（パスベース）
console.log('Starting server on http://localhost:8000');
await Deno.serve(async (req) => {
	try {
		const url = new URL(req.url);
		const pathname = url.pathname;

		// CORS preflight
		if (req.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		// POST /pokemon  -> 作成
		if (pathname === '/pokemon' && req.method === 'POST') {
			const body = await req.json().catch(() => null);
			if (!body || typeof body !== 'object') return jsonResponse({ error: 'invalid body' }, 400);

			const id = await getNextId();
			if (id == null) return jsonResponse({ error: 'failed to generate id' }, 500);

			const record = { ...body, id };
			await kv.set(['pokemon', id], record);
			return jsonResponse(record, 201);
		}

		// GET /pokemon  -> 一覧
		if (pathname === '/pokemon' && req.method === 'GET') {
			const iter = await kv.list({ prefix: ['pokemon'] });
			const arr = [];
			for await (const e of iter) {
				// e.key = ['pokemon', id]
				const id = e.key[1];
				// e.value は保存したオブジェクト
				arr.push(e.value && typeof e.value === 'object' ? { ...e.value } : { value: e.value });
			}
			return jsonResponse(arr);
		}

		// GET /pokemon/:id  -> 単体取得
		if (pathname.startsWith('/pokemon/') && req.method === 'GET') {
			const idStr = pathname.split('/')[2];
			const id = /^\d+$/.test(idStr) ? Number(idStr) : idStr;
			const res = await kv.get(['pokemon', id]);
			if (!res || res.value == null) return jsonResponse({ error: 'not found' }, 404);
			return jsonResponse(res.value);
		}

		// DELETE /pokemon/:id  -> 削除
		if (pathname.startsWith('/pokemon/') && req.method === 'DELETE') {
			const idStr = pathname.split('/')[2];
			const id = /^\d+$/.test(idStr) ? Number(idStr) : idStr;
			await kv.delete(['pokemon', id]);
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// デフォルト: 404
		return jsonResponse({ error: 'not found' }, 404);
	} catch (err) {
		console.error(err);
		return jsonResponse({ error: 'internal server error' }, 500);
	}
});