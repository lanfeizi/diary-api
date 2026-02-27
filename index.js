// Worker 入口文件
export default {
  async fetch(request, env) {
    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 路由分发
    if (path === '/api/entries' && request.method === 'GET') {
      return handleGetEntries(request, env);
    } else if (path === '/api/entries' && request.method === 'POST') {
      return handlePostEntries(request, env);
    } else if (path.startsWith('/api/entries/') && request.method === 'DELETE') {
      return handleDeleteEntry(request, env);
    } else if (path === '/api/sync' && request.method === 'POST') {
      return handleSync(request, env);
    } else {
      return new Response('Not Found', { status: 404 });
    }
  }
};

// 获取条目（支持分页）
async function handleGetEntries(request, env) {
  const url = new URL(request.url);
  const appId = url.searchParams.get('appId');
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  if (!appId) {
    return new Response(JSON.stringify({ error: 'Missing appId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM entries WHERE app_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  ).bind(appId, limit, offset).all();

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// 保存条目（支持单个或批量）
async function handlePostEntries(request, env) {
  const entries = await request.json();
  const list = Array.isArray(entries) ? entries : [entries];

  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO entries 
     (uuid, app_id, content, category, tags, date, date_iso, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const entry of list) {
    await stmt.bind(
      entry.id,
      entry.appId || 'daily',
      entry.content,
      entry.category || '',
      JSON.stringify(entry.tags || []),
      entry.date,
      entry.dateISO,
      entry.timestamp
    ).run();
  }

  return new Response(JSON.stringify({ success: true, count: list.length }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// 删除单条记录
async function handleDeleteEntry(request, env) {
  const id = request.url.split('/').pop();
  await env.DB.prepare('DELETE FROM entries WHERE uuid = ?').bind(id).run();
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// 同步：上传本地所有，下载缺失的
async function handleSync(request, env) {
  const { appId, localEntries } = await request.json();
  if (!appId) {
    return new Response(JSON.stringify({ error: 'Missing appId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // 获取云端所有条目
  const { results: cloudEntries } = await env.DB.prepare(
    'SELECT * FROM entries WHERE app_id = ?'
  ).bind(appId).all();

  // 找出云端有而本地没有的条目
  const localIds = new Set(localEntries.map(e => e.id));
  const missingFromLocal = cloudEntries.filter(e => !localIds.has(e.uuid)).map(e => ({
    id: e.uuid,
    date: e.date,
    dateISO: e.date_iso,
    category: e.category,
    content: e.content,
    tags: JSON.parse(e.tags || '[]'),
    timestamp: e.timestamp
  }));

  // 插入本地条目到云端
  const insertStmt = env.DB.prepare(
    `INSERT OR IGNORE INTO entries 
     (uuid, app_id, content, category, tags, date, date_iso, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const entry of localEntries) {
    await insertStmt.bind(
      entry.id,
      appId,
      entry.content,
      entry.category || '',
      JSON.stringify(entry.tags || []),
      entry.date,
      entry.dateISO,
      entry.timestamp
    ).run();
  }

  return new Response(JSON.stringify({
    downloaded: missingFromLocal,
    uploaded: localEntries.length
  }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}