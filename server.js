/**
 * FFS Radio - Helper Server
 * Versão Render - usa yt-dlp-exec (npm)
 */

const http     = require('http');
const url      = require('url');
const fs       = require('fs');
const path     = require('path');
const ytDlpExec = require('yt-dlp-exec');

const PORT         = process.env.PORT || 9876;
const HOST         = '0.0.0.0';
const CACHE        = new Map();
const CACHE_MARGIN = 300;

const COOKIES    = path.join(__dirname, 'cookies.txt');
const hasCookies = fs.existsSync(COOKIES);

// ─── Resolver via yt-dlp-exec ─────────────────────────────
function resolveStreamUrl(videoId) {
    return new Promise((resolve, reject) => {
        const cached = CACHE.get(videoId);
        if (cached && cached.expires > Date.now() / 1000 + CACHE_MARGIN) {
            console.log(`[Cache HIT] ${videoId}`);
            return resolve(cached.url);
        }

        console.log(`[Resolvendo] ${videoId}`);

        const opts = {
            noWarnings: true,
            noPlaylist: true,
            format: 'bestaudio/best/worstaudio/worst',
            getUrl: true,
        };

        if (hasCookies) opts.cookies = COOKIES;

        ytDlpExec(`https://www.youtube.com/watch?v=${videoId}`, opts)
            .then((output) => {
                const streamUrl = output.trim().split('\n')[0];
                console.log('[yt-dlp] URL obtida:', streamUrl.substring(0, 80) + '...');

                if (!streamUrl || !streamUrl.startsWith('http')) {
                    return reject(new Error('URL inválida retornada pelo yt-dlp'));
                }

                const expireMatch = streamUrl.match(/expire=(\d+)/);
                const expires = expireMatch ? parseInt(expireMatch[1]) : (Date.now() / 1000 + 3600);

                CACHE.set(videoId, { url: streamUrl, expires });
                console.log(`[Resolvido] ${videoId} | expire=${new Date(expires * 1000).toISOString()}`);
                resolve(streamUrl);
            })
            .catch((err) => {
                console.error('[yt-dlp ERRO]', err.message);
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
        res.end(JSON.stringify({ status: 'ok', cookies: hasCookies }));
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
console.log(`[FFS Radio Helper] Cookies: ${hasCookies ? 'SIM ✓' : 'NÃO'}`);
server.listen(PORT, HOST, () => {
    console.log(`[FFS Radio Helper] Rodando em http://${HOST}:${PORT}`);
});

server.on('error', (e) => {
    console.error('[ERRO] Servidor:', e.message);
    process.exit(1);
});
