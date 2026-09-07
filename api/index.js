/**
 * Vercel Serverless API - 理想海岸报名管理
 * 数据存储在内存中（冷启动后重置，热状态下持续保存）
 */
var crypto = require('crypto');

var ADMIN_PASSWORD = 'admin888';

// 内存数据存储（Vercel 热状态下持续保留）
global._records = global._records || [];
global._tokens = global._tokens || {};

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function validToken(token) {
  return token && global._tokens[token];
}

function sendJSON(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.end(JSON.stringify(data));
}

function toCSV(records) {
  var headers = ['序号', '合作方向', '机构/个人名称', '联系人', '联系电话', '意向合作项目', '自有资源简述', '备注', '提交时间'];
  var rows = records.map(function (r, i) {
    return [i + 1, r.direction || '', r.org_name, r.contact_person, r.contact_phone, r.project, r.resources, r.remarks, r.time]
      .map(function (v) {
        v = (v || '').toString().replace(/"/g, '""');
        return '"' + v + '"';
      }).join(',');
  });
  return '\uFEFF' + headers.map(function (h) { return '"' + h + '"'; }).join(',') + '\n' + rows.join('\n');
}

module.exports = function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.end();
    return;
  }

  // 解析路由
  var url = (req.url || '').split('?')[0];
  var apiMatch = url.match(/^\/api\/(.*)$/);
  if (!apiMatch) {
    sendJSON(res, 404, { error: '接口不存在' });
    return;
  }
  var route = apiMatch[1];
  var method = req.method;

  // 解析请求体
  function getBody(callback) {
    if (req.body && typeof req.body === 'object') {
      callback(null, req.body);
      return;
    }
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      try {
        var raw = Buffer.concat(chunks).toString('utf-8');
        callback(null, raw ? JSON.parse(raw) : {});
      } catch (e) {
        callback(e);
      }
    });
  }

  // POST /api/signup — 报名提交（无需认证）
  if (route === 'signup' && method === 'POST') {
    getBody(function (err, body) {
      if (err) return sendJSON(res, 400, { error: '数据格式错误' });
      var record = {
        id: Date.now(),
        direction: body.direction || '',
        org_name: body.org_name || '',
        contact_person: body.contact_person || '',
        contact_phone: body.contact_phone || '',
        resources: body.resources || '',
        project: body.project || '',
        remarks: body.remarks || '',
        time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      };
      global._records.push(record);
      sendJSON(res, 200, { success: true, id: record.id });
    });
    return;
  }

  // POST /api/auth — 管理员登录
  if (route === 'auth' && method === 'POST') {
    getBody(function (err, body) {
      if (err) return sendJSON(res, 400, { error: '数据格式错误' });
      if (body.password === ADMIN_PASSWORD) {
        var token = makeToken();
        global._tokens[token] = Date.now() + 24 * 3600 * 1000;
        sendJSON(res, 200, { token: token });
      } else {
        sendJSON(res, 401, { error: '密码错误' });
      }
    });
    return;
  }

  // 以下路由需要认证
  var authHeader = req.headers['authorization'] || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!validToken(token)) {
    sendJSON(res, 401, { error: '未授权或登录已过期' });
    return;
  }

  // GET /api/records — 获取全部报名记录
  if (route === 'records' && method === 'GET') {
    sendJSON(res, 200, global._records);
    return;
  }

  // DELETE /api/records — 清空全部
  if (route === 'records' && method === 'DELETE') {
    global._records = [];
    sendJSON(res, 200, { success: true });
    return;
  }

  // GET /api/export — 导出 CSV
  if (route === 'export' && method === 'GET') {
    var csv = toCSV(global._records);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=signups_' + new Date().toISOString().slice(0, 10) + '.csv');
    res.end(csv);
    return;
  }

  // PUT /api/records/:id — 编辑记录
  var editMatch = route.match(/^records\/(\d+)$/);
  if (editMatch && method === 'PUT') {
    getBody(function (err, body) {
      if (err) return sendJSON(res, 400, { error: '数据格式错误' });
      var id = parseInt(editMatch[1]);
      var idx = global._records.findIndex(function (r) { return r.id === id; });
      if (idx === -1) return sendJSON(res, 404, { error: '记录不存在' });
      if (body.direction !== undefined) global._records[idx].direction = body.direction;
      if (body.org_name !== undefined) global._records[idx].org_name = body.org_name;
      if (body.contact_person !== undefined) global._records[idx].contact_person = body.contact_person;
      if (body.contact_phone !== undefined) global._records[idx].contact_phone = body.contact_phone;
      if (body.project !== undefined) global._records[idx].project = body.project;
      if (body.resources !== undefined) global._records[idx].resources = body.resources;
      if (body.remarks !== undefined) global._records[idx].remarks = body.remarks;
      sendJSON(res, 200, { success: true });
    });
    return;
  }

  // DELETE /api/records/:id — 删除单条
  if (editMatch && method === 'DELETE') {
    var id = parseInt(editMatch[1]);
    global._records = global._records.filter(function (r) { return r.id !== id; });
    sendJSON(res, 200, { success: true });
    return;
  }

  sendJSON(res, 404, { error: '接口不存在' });
};
