/**
 * 理想海岸 · 报名管理后端服务
 * 纯 Node.js 内置模块，无需 npm install
 * 启动: node server.js
 * 访问: http://localhost:3000
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

// ==================== 配置 ====================
var PORT = process.env.PORT || 3000;
var ADMIN_PASSWORD = 'admin888';   // 管理后台密码，可自行修改
var DATA_FILE = path.join(__dirname, 'data.json');

// ==================== 数据存储 ====================
function loadData() {
  try {
    var raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveData(records) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

// ==================== Token 管理 ====================
var tokens = {};

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function validToken(token) {
  return token && tokens[token];
}

// ==================== 路由处理 ====================
function parseBody(req, callback) {
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

function sendJSON(res, code, data) {
  var body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    res.end(data);
  });
}

// ==================== CSV 导出 ====================
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

// ==================== MIME 类型 ====================
var MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ==================== HTTP 服务器 ====================
var server = http.createServer(function (req, res) {
  var url = req.url.split('?')[0];
  var method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    res.end();
    return;
  }

  // ---------- 静态页面 ----------
  if (url === '/' || url === '/index.html') {
    sendFile(res, path.join(__dirname, 'outdoor-partner-recruit.html'), 'text/html');
    return;
  }
  if (url === '/performance' || url === '/performance.html') {
    sendFile(res, path.join(__dirname, 'performance-recruit.html'), 'text/html');
    return;
  }
  if (url === '/admin' || url === '/admin.html') {
    sendFile(res, path.join(__dirname, 'admin.html'), 'text/html');
    return;
  }

  // ---------- API 路由 ----------
  var apiMatch = url.match(/^\/api\/(.*)$/);
  if (!apiMatch) {
    // 尝试作为静态文件
    var staticPath = path.join(__dirname, decodeURIComponent(url));
    var ext = path.extname(staticPath);
    if (MIME[ext]) {
      sendFile(res, staticPath, MIME[ext]);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
    return;
  }

  var route = apiMatch[1];

  // POST /api/signup — 报名提交（无需认证）
  if (route === 'signup' && method === 'POST') {
    parseBody(req, function (err, body) {
      if (err) return sendJSON(res, 400, { error: '数据格式错误' });
      var records = loadData();
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
      records.push(record);
      saveData(records);
      sendJSON(res, 200, { success: true, id: record.id });
    });
    return;
  }

  // POST /api/auth — 管理员登录
  if (route === 'auth' && method === 'POST') {
    parseBody(req, function (err, body) {
      if (err) return sendJSON(res, 400, { error: '数据格式错误' });
      if (body.password === ADMIN_PASSWORD) {
        var token = makeToken();
        tokens[token] = Date.now() + 24 * 3600 * 1000; // 24小时有效
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
    sendJSON(res, 200, loadData());
    return;
  }

  // DELETE /api/records — 清空全部
  if (route === 'records' && method === 'DELETE') {
    saveData([]);
    sendJSON(res, 200, { success: true });
    return;
  }

  // GET /api/export — 导出 CSV
  if (route === 'export' && method === 'GET') {
    var csv = toCSV(loadData());
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename=signups_' + new Date().toISOString().slice(0, 10) + '.csv'
    });
    res.end(csv);
    return;
  }

  // PUT /api/records/:id — 编辑记录
  var editMatch = route.match(/^records\/(\d+)$/);
  if (editMatch && method === 'PUT') {
    parseBody(req, function (err, body) {
      if (err) return sendJSON(res, 400, { error: '数据格式错误' });
      var id = parseInt(editMatch[1]);
      var records = loadData();
      var idx = records.findIndex(function (r) { return r.id === id; });
      if (idx === -1) return sendJSON(res, 404, { error: '记录不存在' });
      records[idx].direction = body.direction !== undefined ? body.direction : records[idx].direction;
      records[idx].org_name = body.org_name !== undefined ? body.org_name : records[idx].org_name;
      records[idx].contact_person = body.contact_person !== undefined ? body.contact_person : records[idx].contact_person;
      records[idx].contact_phone = body.contact_phone !== undefined ? body.contact_phone : records[idx].contact_phone;
      records[idx].project = body.project !== undefined ? body.project : records[idx].project;
      records[idx].resources = body.resources !== undefined ? body.resources : records[idx].resources;
      records[idx].remarks = body.remarks !== undefined ? body.remarks : records[idx].remarks;
      saveData(records);
      sendJSON(res, 200, { success: true });
    });
    return;
  }

  // DELETE /api/records/:id — 删除单条
  if (editMatch && method === 'DELETE') {
    var id = parseInt(editMatch[1]);
    var records = loadData();
    var filtered = records.filter(function (r) { return r.id !== id; });
    saveData(filtered);
    sendJSON(res, 200, { success: true });
    return;
  }

  sendJSON(res, 404, { error: '接口不存在' });
});

// 获取本机局域网 IP
function getLocalIPs() {
  var os = require('os');
  var ifaces = os.networkInterfaces();
  var ips = [];
  for (var name in ifaces) {
    for (var i = 0; i < ifaces[name].length; i++) {
      var addr = ifaces[name][i];
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

server.listen(PORT, '0.0.0.0', function () {
  var ips = getLocalIPs();
  console.log('========================================');
  console.log('  理想海岸 · 报名管理服务已启动');
  console.log('========================================');
  console.log('');
  console.log('  本机访问:    http://localhost:' + PORT + '/');
  console.log('  管理后台:    http://localhost:' + PORT + '/admin');
  if (ips.length > 0) {
    console.log('');
    console.log('  局域网访问（手机/其他设备用）:');
    ips.forEach(function (ip) {
      console.log('    报名页面: http://' + ip + ':' + PORT + '/');
      console.log('    管理后台: http://' + ip + ':' + PORT + '/admin');
    });
  }
  console.log('');
  console.log('  管理密码:    ' + ADMIN_PASSWORD);
  console.log('');
  console.log('  数据文件:    ' + DATA_FILE);
  console.log('');
  console.log('  按 Ctrl+C 停止服务');
  console.log('========================================');
});
