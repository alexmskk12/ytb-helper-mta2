/**
 * FFS Radio - Helper Server
 * Versão Render - usa @distube/ytdl-core
 */
const http   = require('http');
const url    = require('url');
const fs     = require('fs');
const path   = require('path');
const ytdl   = require('@distube/ytdl-core');

const PORT         = process.env.PORT || 9876;
const HOST         = '0.0.0.0';
const CACHE        = new Map();
const CACHE_MARGIN = 300;

const COOKIES_FILE = path.join(__dirname, 'cookies.txt');

// ─── Carregar cookies do arquivo ──────────────────────────
function loadCookies() {
    try {
        if (!fs.existsSync(COOKIES_FILE)) return null;
        const lines = fs.readFileSync(COOKIES_FILE, 'utf8').split('\n');
        const cookies = [];
        for (const line of lines) {
            if (line.startsWith('#') || !line.trim()) continue;
            const parts = line.split('\t');
            if (parts.length >= 7) {
                cookies.push({ name: parts[5], value: parts[6].trim(), domain: parts[0] });
            }
        }
        console.log(`[Cookies] ${cookies.length} cookies carregados`);
        return cookies.length > 0 ? cookies : null;
    } catch(e) {
        console.error('[Cookies] Erro ao carregar:', e.message);
        return null;
    }
}

const cookies = loadCookies();
const agent = cookies ? ytdl.createAgent(cookies) : null;

// ─── Resolver URL de stream ───────────────────────────────
function resolveStreamUrl(videoId) {
    return new Promise((resolve, reject) => {
        const cached = CACHE.get(videoId);
        if (cached && cached.expires > Date.now() / 1000 + CACHE_MARGIN) {
            console.log(`[Cache HIT] ${videoId}`);
            return resolve(cached.url);
        }

        console.log(`[Resolvendo] ${videoId}`);

        const opts = { quality: 'highestaudio' };
        if (agent) opts.agent = agent;

        ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`, agent ? { agent } : {})
            .then(info => {
                const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' })
                    || ytdl.chooseFormat(info.formats, { quality: 'highest' });

                if (!format || !format.url) {
                    return reject(new Error('Nenhum formato encontrado'));
                }

                console.log(`[Resolvido] ${videoId} | codec: ${format.audioCodec} | bitrate: ${format.audioBitrate}`);

                const expireMatch = format.url.match(/expire=(\d+)/);
                const expires = expireMatch ? parseInt(expireMatch[1]) : (Date.now() / 1000 + 3600);
                CACHE.set(videoId, { url: format.url, expires });

                resolve(format.url);
            })
            .catch(err => {
                console.error(`[ERRO] ${videoId}:`, err.message);
                reject(err);
            });
    });
}

// ─── HTTP Server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const parsed  = url.parse(req.url, true);
    const videoId = parsed.query.v;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (parsed.pathname === '/ping') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', cookies: !!agent }));
        return;
    }

    if (parsed.pathname !== '/stream' || !videoId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Use /stream?v=VIDEO_ID' }));
        return;
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'videoId inválido' }));
        return;
    }

    try {
        const streamUrl = await resolveStreamUrl(videoId);
        res.writeHead(200);
        res.end(JSON.stringify({ url: streamUrl }));
    } catch (err) {
        console.error(`[ERRO] ${videoId}: ${err.message}`);
        const status = err.message.includes('429') ? 429
                     : err.message.includes('410') ? 410
                     : 500;
        res.writeHead(status);
        res.end(JSON.stringify({ error: err.message }));
    }
});

// ─── Init ─────────────────────────────────────────────────
console.log(`[FFS Radio Helper] Cookies: ${agent ? 'SIM ✓' : 'NÃO'}`);
server.listen(PORT, HOST, () => {
    console.log(`[FFS Radio Helper] Rodando em http://${HOST}:${PORT}`);
});

server.on('error', (e) => {
    console.error('[ERRO] Servidor:', e.message);
    process.exit(1);
});
